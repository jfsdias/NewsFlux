from __future__ import annotations

import asyncio
import threading
import unittest

from services.article_intel_summary.supervision import Deadline, OperationBusy, OperationDeadline, Supervisor


class SupervisorTests(unittest.IsolatedAsyncioTestCase):
    async def test_inference_is_rejected_without_revalidation_time(self):
        deadline = Deadline(1)
        with self.assertRaises(OperationDeadline):
            deadline.begin_inference(0.8, reserve_seconds=0.3)

    async def test_inference_phase_expiry_is_observed_by_worker(self):
        deadline = Deadline(1)
        deadline.begin_inference(0.001)
        await asyncio.sleep(0.01)
        with self.assertRaises(OperationDeadline):
            deadline.remaining()
    async def test_expired_http_wait_retains_capacity_until_worker_finishes(self):
        supervisor = Supervisor(limit=1)
        started, release, finished = threading.Event(), threading.Event(), threading.Event()

        def work(deadline):
            started.set()
            try:
                release.wait(3)
                return "late"
            finally:
                finished.set()

        try:
            task = asyncio.create_task(supervisor.run(work, timeout=0.05))
            self.assertTrue(await asyncio.to_thread(started.wait, 1))
            with self.assertRaises(OperationDeadline):
                await task
            with self.assertRaises(OperationBusy):
                await supervisor.run(lambda deadline: "unexpected", timeout=1)
            release.set()
            self.assertTrue(await asyncio.to_thread(finished.wait, 1))
            await supervisor.drain()
            self.assertEqual(await supervisor.run(lambda deadline: "new", timeout=1), "new")
        finally:
            release.set()
            await supervisor.drain()

    async def test_cancelled_client_stops_later_stage_and_retains_capacity(self):
        supervisor = Supervisor(limit=1)
        started, release = threading.Event(), threading.Event()
        dispatched = threading.Event()

        def work(deadline):
            started.set()
            release.wait(3)
            deadline.remaining()
            dispatched.set()

        task = asyncio.create_task(supervisor.run(work, timeout=1))
        self.assertTrue(await asyncio.to_thread(started.wait, 1))
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        with self.assertRaises(OperationBusy):
            await supervisor.run(lambda deadline: None, timeout=1)
        release.set()
        await supervisor.drain()
        self.assertFalse(dispatched.is_set())
