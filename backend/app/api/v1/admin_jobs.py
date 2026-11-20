"""Admin job queue inspection & retry — docs/05 §3.7."""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.jobs.queue import job_to_dict, retry_dead_job
from app.models.cases import Case
from app.models.enums import JobStatus, UserRole
from app.models.jobs import Job
from app.models.programs import Program
from app.security import audit
from app.security.errors import NotFoundError
from app.security.rbac import ActorContext, require_roles

router = APIRouter(prefix="/admin", tags=["admin-jobs"])

DbSession = Annotated[Session, Depends(get_db)]
AdminActor = Annotated[ActorContext, Depends(require_roles(UserRole.ADMIN))]


def _tenant_job_ids(db: Session, tenant_id: uuid.UUID):
    """Sub-select of job ids whose payload references this tenant's cases/programmes."""
    case_ids = select(func.cast(Case.id, String)).where(
        Case.tenant_id == tenant_id
    )
    program_ids = select(func.cast(Program.id, String)).where(
        Program.tenant_id == tenant_id
    )
    return Job.payload_json["case_id"].astext.in_(case_ids) | Job.payload_json[
        "program_id"
    ].astext.in_(program_ids)


@router.get("/jobs", summary="Inspect the job queue")
def list_jobs(
    actor: AdminActor,
    db: DbSession,
    status: str | None = Query(default=None),
    job_type: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    query = select(Job)
    count_query = select(func.count()).select_from(Job)

    if status:
        query = query.where(Job.status == status)
        count_query = count_query.where(Job.status == status)
    if job_type:
        query = query.where(Job.job_type == job_type)
        count_query = count_query.where(Job.job_type == job_type)
    if not actor.is_platform_admin and actor.tenant_id is not None:
        criterion = _tenant_job_ids(db, actor.tenant_id)
        query = query.where(criterion)
        count_query = count_query.where(criterion)

    total = db.execute(count_query).scalar_one()
    rows = (
        db.execute(query.order_by(Job.created_at.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )
    return {
        "items": [job_to_dict(job) for job in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "queue_depth": _queue_depth(db),
    }


def _queue_depth(db: Session) -> dict[str, int]:
    rows = db.execute(select(Job.status, func.count()).group_by(Job.status)).all()
    depth = {status.value: 0 for status in JobStatus}
    for status_value, count in rows:
        depth[str(status_value)] = int(count)
    return depth


@router.post("/jobs/{job_id}/retry", summary="Re-queue a DEAD job")
def retry_job(job_id: uuid.UUID, actor: AdminActor, db: DbSession) -> dict[str, Any]:
    job = db.get(Job, job_id)
    if job is None:
        raise NotFoundError()
    if not actor.is_platform_admin and actor.tenant_id is not None:
        case_id = (job.payload_json or {}).get("case_id")
        if case_id:
            case = db.get(Case, uuid.UUID(str(case_id)))
            if case is None or case.tenant_id != actor.tenant_id:
                raise NotFoundError()

    requeued = retry_dead_job(db, job_id)
    if requeued is None:
        raise NotFoundError()

    audit.record(
        db,
        action="job.retried",
        resource_type="job",
        resource_id=job_id,
        actor_type=actor.actor_type,
        actor_id=actor.actor_id_str,
        actor_role=actor.role_value,
        tenant_id=actor.tenant_id,
        payload={"job_type": requeued.job_type, "previous_status": job.status},
    )
    db.commit()
    return job_to_dict(requeued)


__all__ = ["router"]
