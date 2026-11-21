"""PostgreSQL job queue — transactional enqueue + ``SKIP LOCKED`` claim (ADR-004).

No Redis, no Celery: a job is enqueued in the *same* transaction as the mutation
that needs it, so a committed case submit can never lose its ``PROCESS_CASE`` job.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.enums import JobStatus, JobType
from app.models.jobs import Job

CLAIMABLE_STATUSES = (JobStatus.PENDING.value, JobStatus.FAILED_RETRY.value)


def _now() -> datetime:
    return datetime.now(UTC)


def enqueue_job(
    db: Session,
    job_type: JobType | str,
    payload: dict[str, Any] | None = None,
    *,
    dedup_key: str | None = None,
    run_after: datetime | None = None,
    max_attempts: int | None = None,
) -> Job:
    """Enqueue a job, or return the live job already queued under ``dedup_key``."""
    if dedup_key:
        existing = db.execute(
            select(Job)
            .where(
                Job.dedup_key == dedup_key,
                Job.status.in_(
                    [
                        JobStatus.PENDING.value,
                        JobStatus.RUNNING.value,
                        JobStatus.FAILED_RETRY.value,
                    ]
                ),
            )
            .order_by(Job.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if existing is not None:
            return existing

    job = Job(
        job_type=str(job_type),
        dedup_key=dedup_key,
        payload_json=payload or {},
        status=JobStatus.PENDING.value,
        attempts=0,
        max_attempts=max_attempts or settings.worker_max_attempts,
        run_after=run_after or _now(),
    )
    db.add(job)
    db.flush()
    return job


#: Jobs left RUNNING longer than this without finishing are assumed crashed and reclaimed.
STALE_LOCK_SECONDS = 300


def reclaim_stale_jobs(db: Session, *, stale_seconds: int = STALE_LOCK_SECONDS) -> int:
    """Release RUNNING jobs whose worker died mid-flight back to FAILED_RETRY."""
    cutoff = _now() - timedelta(seconds=stale_seconds)
    stale = (
        db.execute(
            select(Job).where(
                Job.status == JobStatus.RUNNING.value,
                Job.locked_at.is_not(None),
                Job.locked_at < cutoff,
            )
        )
        .scalars()
        .all()
    )
    if not stale:
        return 0
    for job in stale:
        job.locked_at = None
        if int(job.attempts or 0) >= int(job.max_attempts or settings.worker_max_attempts):
            job.status = JobStatus.DEAD.value
            job.last_error = "Worker lock expired after max attempts"
        else:
            job.status = JobStatus.FAILED_RETRY.value
            job.run_after = _now()
            job.last_error = "Reclaimed after stale worker lock"
    db.commit()
    return len(stale)


def claim_job(db: Session) -> Job | None:
    """Atomically claim one due job. Safe with any number of concurrent workers."""
    reclaim_stale_jobs(db)
    stmt = (
        select(Job.id)
        .where(Job.status.in_(CLAIMABLE_STATUSES), Job.run_after <= _now())
        .order_by(Job.run_after.asc(), Job.created_at.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    job_id = db.execute(stmt).scalar_one_or_none()
    if job_id is None:
        db.rollback()
        return None

    job = db.get(Job, job_id)
    if job is None:  # pragma: no cover - row vanished between select and get
        db.rollback()
        return None

    job.status = JobStatus.RUNNING.value
    job.locked_at = _now()
    job.attempts = int(job.attempts or 0) + 1
    db.commit()
    db.refresh(job)
    return job


def backoff_for_attempt(attempts: int) -> int:
    """15 / 30 / 60 / 120 s, then the last value repeats."""
    schedule = settings.backoff_schedule or [15, 30, 60, 120]
    index = max(0, min(attempts - 1, len(schedule) - 1))
    return schedule[index]


def mark_completed(db: Session, job: Job, *, result: dict[str, Any] | None = None) -> Job:
    job.status = JobStatus.COMPLETED.value
    job.locked_at = None
    job.last_error = None
    if result is not None:
        payload = dict(job.payload_json or {})
        payload["_result"] = result
        job.payload_json = payload
    db.commit()
    return job


def mark_failed(db: Session, job: Job, error: str) -> Job:
    """Retry with backoff, or park the job as ``DEAD`` once attempts are exhausted."""
    job.last_error = (error or "")[:2000]
    job.locked_at = None
    if int(job.attempts or 0) >= int(job.max_attempts or settings.worker_max_attempts):
        job.status = JobStatus.DEAD.value
    else:
        job.status = JobStatus.FAILED_RETRY.value
        job.run_after = _now() + timedelta(seconds=backoff_for_attempt(int(job.attempts or 1)))
    db.commit()
    return job


def retry_dead_job(db: Session, job_id: uuid.UUID) -> Job | None:
    """Admin action: put a ``DEAD`` job back on the queue with a fresh attempt budget."""
    job = db.get(Job, job_id)
    if job is None:
        return None
    job.status = JobStatus.PENDING.value
    job.attempts = 0
    job.run_after = _now()
    job.locked_at = None
    job.last_error = None
    db.flush()
    return job


def job_to_dict(job: Job) -> dict[str, Any]:
    return {
        "id": str(job.id),
        "job_type": job.job_type,
        "dedup_key": job.dedup_key,
        "status": job.status,
        "attempts": job.attempts,
        "max_attempts": job.max_attempts,
        "run_after": job.run_after.isoformat() if job.run_after else None,
        "locked_at": job.locked_at.isoformat() if job.locked_at else None,
        "last_error": job.last_error,
        "payload": job.payload_json,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
    }


__all__ = [
    "CLAIMABLE_STATUSES",
    "backoff_for_attempt",
    "claim_job",
    "enqueue_job",
    "job_to_dict",
    "mark_completed",
    "mark_failed",
    "retry_dead_job",
]
