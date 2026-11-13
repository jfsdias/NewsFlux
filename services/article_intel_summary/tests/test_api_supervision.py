from __future__ import annotations

import asyncio
import sqlite3
from contextlib import closing
import threading
import time
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

import httpx

from services.article_intel_summary.app import create_app
from services.article_intel_summary.service import SummaryService
from services.article_intel_summary.litellm_adapter import LiteLLMInferenceAdapter
from services.article_intel_summary.tests.test_litellm_adapter import S5_ALIAS, completion_response, make_settings
from services.article_intel_summary.tests.support import (
    ENTRY_ID, WEB_ORIGIN, SyntheticFixtureAdapter, make_snapshot, make_test_client,
    request_headers, valid_request,
)


class SupervisedAPITests(unittest.IsolatedAsyncioTestCase):
    async def test_late_inference_is_settled_and_never_revalidated(self):
        started, release = threading.Event(), threading.Event()
        with tempfile.TemporaryDirectory() as directory:
            database = str(Path(directory) / "usage.sqlite3")
            def handler(_request):
                started.set()
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
                self.assertLess(time.monotonic() - begin, 0.8)
                busy = await http.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request())
                self.assertEqual(busy.status_code, 429)
        finally:
            release.set()
            await app.state.supervisor.drain()

    async def test_timeout_keeps_capacity_until_worker_finishes(self):
        started, release = threading.Event(), threading.Event()

        class BlockingAdapter(SyntheticFixtureAdapter):
            def summarize(self, request, *, timeout_seconds):
                started.set()
                release.wait(2)
                return super().summarize(request, timeout_seconds=timeout_seconds)

        adapter = BlockingAdapter(make_snapshot())
        client, _, _, _ = make_test_client(adapter=adapter)
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
