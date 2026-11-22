"""Background worker: ``SELECT ... FOR UPDATE SKIP LOCKED`` poller (ADR-004).

* polls every ``WORKER_POLL_INTERVAL_MS`` (500 ms)
* runs at most ``WORKER_MAX_CONCURRENCY`` (4) jobs in a threadpool
* retries with 15 / 30 / 60 / 120 s backoff, ``DEAD`` after 5 attempts
* writes ``worker_heartbeats`` every 10 s so ``/health`` can detect a dead worker
* can run inside the API process with ``RUN_EMBEDDED_WORKER=true``

A handler whose module is not merged yet fails as ``FAILED_RETRY`` with a clear
error - the worker never crashes and the API never notices.
"""

from __future__ import annotations

import logging
import os
import signal
import socket
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import settings
from app.db import SessionLocal
from app.jobs.handlers import HandlerUnavailable, run_handler
from app.jobs.queue import claim_job, mark_completed, mark_failed
from app.models.jobs import Job, WorkerHeartbeat
from app.security.context import configure_logging, log_event

logger = logging.getLogger("app.jobs.worker")

#: Why the last heartbeat write failed, or ``None`` after a clean one.
#: ``/health`` reports this so a worker that is alive but cannot write is
#: distinguishable from one that never started - the two look identical from
#: the outside, and both leave every case stuck in ``PROCESSING``.
_last_heartbeat_error: str | None = None


def last_heartbeat_error() -> str | None:
    return _last_heartbeat_error


def _now() -> datetime:
    return datetime.now(UTC)


def default_worker_id() -> str:
    return f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"


class Worker:
    def __init__(
        self,
        *,
        worker_id: str | None = None,
        poll_interval_ms: int | None = None,
        max_concurrency: int | None = None,
    ) -> None:
        self.worker_id = worker_id or default_worker_id()
        self.poll_interval = (poll_interval_ms or settings.worker_poll_interval_ms) / 1000.0
        self.max_concurrency = max_concurrency or settings.worker_max_concurrency
        self._stop = threading.Event()
        self._pool = ThreadPoolExecutor(
            max_workers=self.max_concurrency, thread_name_prefix=f"job-{self.worker_id}"
        )
        self._in_flight = 0
        self._in_flight_lock = threading.Lock()
        self._last_heartbeat = 0.0

    # -- lifecycle -------------------------------------------------------
    def stop(self) -> None:
        self._stop.set()

    def heartbeat(self, *, force: bool = False) -> None:
        global _last_heartbeat_error
        now_monotonic = time.monotonic()
        if not force and now_monotonic - self._last_heartbeat < settings.worker_heartbeat_seconds:
            return
        self._last_heartbeat = now_monotonic
        db = SessionLocal()
        try:
            stmt = (
                pg_insert(WorkerHeartbeat)
                .values(
                    worker_id=self.worker_id,
                    last_seen_at=_now(),
                    active_jobs=self._active_jobs(),
                )
                .on_conflict_do_update(
                    index_elements=[WorkerHeartbeat.worker_id],
                    set_={"last_seen_at": _now(), "active_jobs": self._active_jobs()},
                )
            )
            db.execute(stmt)
            db.commit()
            _last_heartbeat_error = None
        except Exception as exc:  # noqa: BLE001 - a missed heartbeat must not kill the worker
            _last_heartbeat_error = f"{type(exc).__name__}: {exc}"[:300]
            try:
                db.rollback()
            except Exception:  # noqa: BLE001 - a dead connection must not kill the thread
                logger.exception("worker heartbeat rollback failed")
            logger.exception("worker heartbeat failed")
        finally:
            db.close()

    def _active_jobs(self) -> int:
        with self._in_flight_lock:
            return self._in_flight

    # -- execution -------------------------------------------------------
    def _execute(self, job_id: uuid.UUID) -> None:
        db = SessionLocal()
        job: Job | None = None
        try:
            job = db.get(Job, job_id)
            if job is None:
                return
            payload = dict(job.payload_json or {})
            payload.pop("_result", None)
            log_event(logger, "job.started", job_id=str(job.id), job_type=job.job_type)
            result = run_handler(db, job.job_type, payload)
            mark_completed(db, job, result=result if isinstance(result, dict) else None)
            log_event(logger, "job.completed", job_id=str(job.id), job_type=job.job_type)
        except HandlerUnavailable as exc:
            db.rollback()
            if job is not None:
                mark_failed(db, job, f"HandlerUnavailable: {exc}")
            log_event(logger, "job.handler_unavailable", level=logging.WARNING, error=str(exc))
        except Exception as exc:  # noqa: BLE001 - every failure becomes a retry
            db.rollback()
            if job is not None:
                try:
                    from app.security.masking import scrub_text

                    mark_failed(db, job, scrub_text(f"{type(exc).__name__}: {exc}"))
                except Exception:  # noqa: BLE001
                    db.rollback()
                    logger.exception("could not record job failure")
            log_event(
                logger,
                "job.failed",
                level=logging.ERROR,
                job_id=str(job_id),
                error=f"{type(exc).__name__}: {exc}",
            )
        finally:
            with self._in_flight_lock:
                self._in_flight -= 1
            db.close()

    def run_once(self) -> int:
        """Claim and dispatch as many due jobs as there are free slots."""
        dispatched = 0
        while not self._stop.is_set() and self._active_jobs() < self.max_concurrency:
            db = SessionLocal()
            try:
                job = claim_job(db)
            finally:
                db.close()
            if job is None:
                break
            with self._in_flight_lock:
                self._in_flight += 1
            self._pool.submit(self._execute, job.id)
            dispatched += 1
        return dispatched

    def run_forever(self) -> None:
        log_event(
            logger,
            "worker.started",
            worker_id=self.worker_id,
            max_concurrency=self.max_concurrency,
            poll_interval_ms=int(self.poll_interval * 1000),
        )
        self.heartbeat(force=True)
        try:
            while not self._stop.is_set():
                self.heartbeat()
                try:
                    dispatched = self.run_once()
                except Exception:  # noqa: BLE001 - keep polling through transient DB errors
                    logger.exception("worker poll failed")
                    dispatched = 0
                if dispatched == 0:
                    self._stop.wait(self.poll_interval)
        finally:
            self._pool.shutdown(wait=True)
            log_event(logger, "worker.stopped", worker_id=self.worker_id)


# --- embedded mode ----------------------------------------------------------

_embedded: Worker | None = None
_embedded_thread: threading.Thread | None = None


def start_embedded_worker() -> Worker | None:
    """Start the worker in a daemon thread inside the API process."""
    global _embedded, _embedded_thread
    if _embedded is not None:
        return _embedded
    _embedded = Worker(worker_id=f"embedded-{default_worker_id()}")
    _embedded_thread = threading.Thread(
        target=_embedded.run_forever, name="embedded-worker", daemon=True
    )
    _embedded_thread.start()
    log_event(logger, "worker.embedded_started", worker_id=_embedded.worker_id)
    return _embedded


def stop_embedded_worker() -> None:
    global _embedded, _embedded_thread
    if _embedded is not None:
        _embedded.stop()
        if _embedded_thread is not None:
            _embedded_thread.join(timeout=10)
    _embedded = None
    _embedded_thread = None


def embedded_worker_alive() -> bool:
    """True while the embedded worker thread is running.

    A thread that died on startup and a thread that is polling but cannot write
    a heartbeat both leave ``worker_heartbeats`` empty. ``/health`` needs to
    tell them apart, because the fixes are different.
    """
    return _embedded_thread is not None and _embedded_thread.is_alive()


def worker_is_stale(db) -> bool:
    """True when no heartbeat is recent enough (docs/03 §6.4)."""
    latest = db.execute(
        select(WorkerHeartbeat.last_seen_at).order_by(WorkerHeartbeat.last_seen_at.desc()).limit(1)
    ).scalar_one_or_none()
    if latest is None:
        return True
    return (_now() - latest).total_seconds() > settings.worker_heartbeat_stale_seconds


def main() -> None:
    configure_logging(settings.log_level)
    worker = Worker()

    def _handle_signal(signum, _frame):  # noqa: ANN001
        log_event(logger, "worker.signal", signal=signum)
        worker.stop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _handle_signal)
        except (ValueError, OSError):  # pragma: no cover - not on the main thread
            pass

    worker.run_forever()


if __name__ == "__main__":
    main()
