from __future__ import annotations

import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor


class OperationBusy(Exception):
    pass


class OperationDeadline(Exception):
    pass


class Deadline:
    def __init__(self, timeout: float, loop=None, changed=None) -> None:
        self.end = time.monotonic() + timeout
        self.cancelled = threading.Event()
        self._loop = loop
        self._changed = changed
        self._lock = threading.Lock()
        self._inference_end = None

    def _notify(self):
        if self._loop is not None:
            try:
                self._loop.call_soon_threadsafe(self._changed.set)
            except RuntimeError:
                pass

    def begin_inference(self, timeout: float, *, reserve_seconds: float = 0):
        if self.remaining() < timeout + reserve_seconds:
            raise OperationDeadline()
        with self._lock:
            self._inference_end = time.monotonic() + timeout
        self._notify()

    def end_inference(self):
        with self._lock:
            expired = self._inference_end is not None and time.monotonic() >= self._inference_end
            self._inference_end = None
        self._notify()
        if expired:
            self.cancelled.set()
            raise OperationDeadline()

    def wait_remaining(self):
        with self._lock:
            end = min(self.end, self._inference_end) if self._inference_end is not None else self.end
        return max(0.0, end - time.monotonic())

    def remaining(self) -> float:
        if self.cancelled.is_set():
            raise OperationDeadline()
        with self._lock:
            end = min(self.end, self._inference_end) if self._inference_end is not None else self.end
        remaining = end - time.monotonic()
        if remaining <= 0:
            raise OperationDeadline()
        return remaining


class Supervisor:
    def __init__(self, limit: int) -> None:
        self._slots = threading.BoundedSemaphore(limit)
        self._executor = ThreadPoolExecutor(max_workers=limit, thread_name_prefix="summary")
        self._lock = threading.Lock()
        self._pending = set()
        self._closing = False

    async def run(self, work, *, timeout: float):
        if not self._slots.acquire(blocking=False):
            raise OperationBusy()
        loop = asyncio.get_running_loop()
        changed = asyncio.Event()
        deadline = Deadline(timeout, loop, changed)
        with self._lock:
            if self._closing:
                self._slots.release()
                raise OperationBusy()
            try:
                future = self._executor.submit(work, deadline)
            except BaseException:
                self._slots.release()
                raise
            self._pending.add(future)

        def finished(done):
            with self._lock:
                self._pending.discard(done)
            self._slots.release()

        future.add_done_callback(finished)
        wrapped = asyncio.wrap_future(future)
        signal = None
        try:
            while True:
                changed.clear()
                remaining = deadline.wait_remaining()
                if remaining <= 0:
                    deadline.cancelled.set()
                    wrapped.add_done_callback(lambda f: f.exception() if not f.cancelled() else None)
                    raise OperationDeadline()
                signal = asyncio.create_task(changed.wait())
                done, _ = await asyncio.wait({wrapped, signal}, timeout=remaining, return_when=asyncio.FIRST_COMPLETED)
                if not signal.done():
                    signal.cancel()
                if wrapped in done:
                    break
            deadline.remaining()
            return wrapped.result()
        except asyncio.CancelledError:
            deadline.cancelled.set()
            if signal is not None and not signal.done():
                signal.cancel()
            wrapped.add_done_callback(lambda f: f.exception() if not f.cancelled() else None)
            raise

    async def drain(self):
        with self._lock:
            pending = list(self._pending)
        if pending:
            await asyncio.gather(*(asyncio.wrap_future(f) for f in pending), return_exceptions=True)

    async def shutdown(self):
        with self._lock:
            self._closing = True
        await self.drain()
        self._executor.shutdown(wait=True)
