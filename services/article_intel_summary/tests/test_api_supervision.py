from __future__ import annotations

import asyncio
import contextlib
import sqlite3
from contextlib import closing
import threading
import time
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from unittest import mock

import httpx

from services.article_intel_summary import app as summary_app, budget, supervision
from services.article_intel_summary.app import create_app
from services.article_intel_summary.service import SummaryService
from services.article_intel_summary.litellm_adapter import LiteLLMInferenceAdapter
from services.article_intel_summary.tests.test_litellm_adapter import S5_ALIAS, completion_response, make_settings
from services.article_intel_summary.tests.support import (
    ENTRY_ID, WEB_ORIGIN, SyntheticFixtureAdapter, make_snapshot, make_test_client,
    request_headers, valid_request,
)


class ControlledClock:
    """Monotonic clock for the request (app) and supervisor deadlines that only moves when a test advances it.

    The inference deadline then expires at a point the test chooses (e.g. only after the gateway
    request has started), independent of runner speed, SQLite I/O or thread scheduling.
    """

    def __init__(self):
        self.now = time.monotonic()
        self._lock = threading.Lock()

    def monotonic(self):
        with self._lock:
            return self.now

    def advance(self, seconds):
        with self._lock:
            self.now += seconds


def slow_reservation(delay):
    """Pre-dispatch latency stand-in (slow disk/scheduler): delays the worker after its SQLite reservation."""
    real = budget.BudgetLedger.reserve

    def reserve(self, *args, **kwargs):
        result = real(self, *args, **kwargs)
        time.sleep(delay)
        return result

    return mock.patch.object(budget.BudgetLedger, "reserve", reserve)


class SupervisedAPITests(unittest.IsolatedAsyncioTestCase):
    async def late_inference_scenario(self, *, pre_dispatch_delay):
        started, release = threading.Event(), threading.Event()
        clock = ControlledClock()
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.object(supervision, "time", clock), mock.patch.object(summary_app, "time", clock), slow_reservation(pre_dispatch_delay):
            database = str(Path(directory) / "usage.sqlite3")
            def handler(_request):
                started.set()
                # The gateway is now in flight; only now does the inference deadline (0.05 s) pass.
                clock.advance(0.5)
                release.wait(2)
                return completion_response(model=S5_ALIAS, completion_tokens=805)
            settings = make_settings(database, model_choice="s5-free", model_id=S5_ALIAS,
                                     input_price_usd_per_million=Decimal("0"), output_price_usd_per_million=Decimal("0"),
                                     max_output_tokens=2048, timeout_seconds=0.05)
            adapter = LiteLLMInferenceAdapter(settings, client=httpx.Client(transport=httpx.MockTransport(handler)))
            client, miniflux, _, _ = make_test_client(adapter=adapter)
            app = create_app(auth_service=client.app.state.auth_service,
                             summary_service=SummaryService(adapter, timeout_seconds=0.05),
                             request_timeout_seconds=1, max_in_flight=1, revalidation_reserve_seconds=0)
            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=WEB_ORIGIN) as http:
                    response = await http.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request())
                    self.assertTrue(started.is_set())
                    self.assertEqual(response.status_code, 504)
                    release.set()
                    await app.state.supervisor.drain()
                    self.assertEqual(len(miniflux.calls), 2)
                    with closing(sqlite3.connect(database)) as db:
                        self.assertEqual(db.execute("SELECT state FROM inference_usage").fetchall(), [("settled",)])
            finally:
                release.set()
                await app.state.supervisor.drain()
                adapter.client.close()

    async def test_late_inference_is_settled_and_never_revalidated(self):
        await self.late_inference_scenario(pre_dispatch_delay=0)

    async def test_late_inference_contract_holds_with_slow_pre_dispatch_work(self):
        # Regression for Quality run 44308842491: a slow runner delayed the worker between
        # begin_inference and the gateway request beyond the 0.05 s budget, so the test's own
        # precondition (dispatch started) was not met. The contract must not depend on that timing.
        await self.late_inference_scenario(pre_dispatch_delay=0.1)

    async def test_deadline_before_dispatch_never_calls_gateway_and_keeps_conservative_cost(self):
        calls = []
        clock = ControlledClock()
        real = budget.BudgetLedger.reserve

        def reserve_then_expire(self, *args, **kwargs):
            result = real(self, *args, **kwargs)
            clock.advance(0.5)  # inference budget exhausted after admission, before the gateway request
            return result

        with tempfile.TemporaryDirectory() as directory, mock.patch.object(supervision, "time", clock), mock.patch.object(summary_app, "time", clock), \
                mock.patch.object(budget.BudgetLedger, "reserve", reserve_then_expire):
            database = str(Path(directory) / "usage.sqlite3")
            def handler(_request):
                calls.append(1)
                return completion_response(model=S5_ALIAS, completion_tokens=5)
            settings = make_settings(database, model_choice="s5-free", model_id=S5_ALIAS,
                                     input_price_usd_per_million=Decimal("0"), output_price_usd_per_million=Decimal("0"),
                                     max_output_tokens=2048, timeout_seconds=0.05)
            adapter = LiteLLMInferenceAdapter(settings, client=httpx.Client(transport=httpx.MockTransport(handler)))
            client, miniflux, _, _ = make_test_client(adapter=adapter)
            app = create_app(auth_service=client.app.state.auth_service,
                             summary_service=SummaryService(adapter, timeout_seconds=0.05),
                             request_timeout_seconds=1, max_in_flight=1, revalidation_reserve_seconds=0)
            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=WEB_ORIGIN) as http:
                    response = await http.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request())
                    await app.state.supervisor.drain()
                self.assertEqual(response.status_code, 504)
                self.assertEqual(calls, [])  # nothing is sent after the deadline
                self.assertEqual(len(miniflux.calls), 2)  # no revalidation
                with closing(sqlite3.connect(database)) as db:
                    self.assertEqual(db.execute("SELECT state FROM inference_usage").fetchall(), [("uncertain",)])
            finally:
                await app.state.supervisor.drain()
                adapter.client.close()

    async def test_client_cancellation_does_not_release_worker_or_revalidate_late_result(self):
        started, release = threading.Event(), threading.Event()

        class BlockingAdapter(SyntheticFixtureAdapter):
            def summarize(self, request, *, timeout_seconds):
                started.set()
                release.wait(2)
                return super().summarize(request, timeout_seconds=timeout_seconds)

        adapter = BlockingAdapter(make_snapshot())
        client, miniflux, _, _ = make_test_client(adapter=adapter)
        app = create_app(auth_service=client.app.state.auth_service,
                         summary_service=SummaryService(adapter, timeout_seconds=1),
                         request_timeout_seconds=2, max_in_flight=1, revalidation_reserve_seconds=0)
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=WEB_ORIGIN) as http:
                task = asyncio.create_task(http.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request()))
                self.assertTrue(await asyncio.to_thread(started.wait, 1))
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                busy = await http.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request())
                self.assertEqual(busy.status_code, 429)
                release.set()
                await app.state.supervisor.drain()
                self.assertEqual(len(miniflux.calls), 2)
        finally:
            release.set()
            await app.state.supervisor.drain()

    async def test_inference_deadline_bounds_http_wait_and_worker_retains_capacity(self):
        started, release = threading.Event(), threading.Event()

        class BlockingAdapter(SyntheticFixtureAdapter):
            def summarize(self, request, *, timeout_seconds):
                started.set()
                release.wait(2)
                return super().summarize(request, timeout_seconds=timeout_seconds)

        adapter = BlockingAdapter(make_snapshot())
        client, _, _, _ = make_test_client(adapter=adapter)
        app = create_app(auth_service=client.app.state.auth_service,
                         summary_service=SummaryService(adapter, timeout_seconds=0.05),
                         request_timeout_seconds=1, max_in_flight=1, revalidation_reserve_seconds=0)
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=WEB_ORIGIN) as http:
                begin = time.monotonic()
                response = await http.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request())
                self.assertTrue(started.is_set())
                self.assertEqual(response.status_code, 504)
                self.assertEqual(response.json()["error"], {"code": "SUMMARY_BUSY", "retryable": False})
                self.assertLess(time.monotonic() - begin, 0.8)
                busy = await http.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request())
                self.assertEqual(busy.status_code, 429)
        finally:
            release.set()
            await app.state.supervisor.drain()

    async def request_deadline_capacity_scenario(self, *, pre_adapter_delay, pre_supervisor_stall=0):
        started, release = threading.Event(), threading.Event()
        clock = ControlledClock()

        class BlockingAdapter(SyntheticFixtureAdapter):
            def summarize(self, request, *, timeout_seconds):
                started.set()
                # The worker holds its slot; only now does the request deadline (0.05 s) pass.
                clock.advance(1.0)
                release.wait(2)
                return super().summarize(request, timeout_seconds=timeout_seconds)

        adapter = BlockingAdapter(make_snapshot())
        client, miniflux, _, _ = make_test_client(adapter=adapter)
        if pre_adapter_delay:
            real_get = miniflux.get

            def slow_get(url, **options):
                time.sleep(pre_adapter_delay)  # slow Miniflux/scheduler before the adapter is reached
                return real_get(url, **options)

            miniflux.get = slow_get
        stall = contextlib.nullcontext()
        if pre_supervisor_stall:
            real_read = summary_app._read_request_json

            async def stalled_read(request):
                document = await real_read(request)
                time.sleep(pre_supervisor_stall)  # event loop starved before the supervisor starts
                return document

            stall = mock.patch.object(summary_app, "_read_request_json", stalled_read)
        with mock.patch.object(supervision, "time", clock), mock.patch.object(summary_app, "time", clock), stall:
            app = create_app(auth_service=client.app.state.auth_service,
                             summary_service=SummaryService(adapter, timeout_seconds=0.03), request_timeout_seconds=0.05,
                             max_in_flight=1, revalidation_reserve_seconds=0)
            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=WEB_ORIGIN) as http:
                    response = await http.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request())
                    self.assertTrue(started.is_set())
                    self.assertEqual(response.status_code, 504)
                    busy = await http.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request())
                    self.assertEqual(busy.status_code, 429)
            finally:
                release.set()
                await app.state.supervisor.drain()

    async def test_timeout_keeps_capacity_until_worker_finishes(self):
        await self.request_deadline_capacity_scenario(pre_adapter_delay=0)

    async def test_timeout_capacity_contract_holds_with_stalled_event_loop_before_supervision(self):
        # R4.2 regression (1/1164 under 8xCPU + dsync I/O): the app enforces the request deadline with
        # its own monotonic clock before the supervisor runs; a stalled event loop there must not
        # decide the test's precondition either.
        await self.request_deadline_capacity_scenario(pre_adapter_delay=0, pre_supervisor_stall=0.1)

    async def test_timeout_capacity_contract_holds_with_slow_pre_adapter_work(self):
        # Same race family as the Quality failure: the 0.05 s request deadline must not be able to
        # expire before the adapter is reached merely because the runner is slow.
        await self.request_deadline_capacity_scenario(pre_adapter_delay=0.1)
