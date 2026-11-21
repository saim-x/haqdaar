"""Tenant analytics - docs/05 §3.9."""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.cases import Case, Decision, Payment
from app.models.enums import CaseStatus, UserRole
from app.security.rbac import ActorContext, require_roles

router = APIRouter(prefix="/analytics", tags=["analytics"])

DbSession = Annotated[Session, Depends(get_db)]
AnalyticsActor = Annotated[
    ActorContext, Depends(require_roles(UserRole.ADMIN, UserRole.OFFICER, UserRole.AUDITOR))
]


@router.get("/tenant", summary="Per-tenant case, decision and disbursement metrics")
def tenant_analytics(
    actor: AnalyticsActor,
    db: DbSession,
    tenant_id: uuid.UUID | None = Query(default=None),
) -> dict[str, Any]:
    # Tenant comes from the token; only platform-scoped actors may name one.
    scope_tenant = actor.tenant_id
    if scope_tenant is None and (actor.is_platform_admin or actor.role_value == UserRole.AUDITOR.value):
        scope_tenant = tenant_id

    case_filter = [] if scope_tenant is None else [Case.tenant_id == scope_tenant]

    by_status = dict(
        db.execute(
            select(Case.status, func.count()).where(*case_filter).group_by(Case.status)
        ).all()
    )
    total_cases = sum(int(count) for count in by_status.values())

    decided = int(
        db.execute(
            select(func.count())
            .select_from(Case)
            .where(*case_filter, Case.decided_at.is_not(None))
        ).scalar_one()
    )
    avg_seconds = db.execute(
        select(
            func.avg(
                func.extract("epoch", Case.decided_at - Case.submitted_at)
            )
        ).where(*case_filter, Case.decided_at.is_not(None), Case.submitted_at.is_not(None))
    ).scalar_one()

    auto_approved = int(
        db.execute(
            select(func.count())
            .select_from(Decision)
            .where(
                *([] if scope_tenant is None else [Decision.tenant_id == scope_tenant]),
                Decision.decision_source == "AI_ENGINE",
                Decision.route_action == "AUTO_APPROVE",
            )
        ).scalar_one()
    )
    ai_decisions = int(
        db.execute(
            select(func.count())
            .select_from(Decision)
            .where(
                *([] if scope_tenant is None else [Decision.tenant_id == scope_tenant]),
                Decision.decision_source == "AI_ENGINE",
            )
        ).scalar_one()
    )

    disbursed = int(
        db.execute(
            select(func.coalesce(func.sum(Payment.amount_pkr), 0)).where(
                *([] if scope_tenant is None else [Payment.tenant_id == scope_tenant]),
                Payment.status == "COMPLETED",
            )
        ).scalar_one()
    )

    flag_counts: dict[str, int] = {}
    flag_rows = db.execute(select(Case.flags_json).where(*case_filter)).scalars().all()
    for flags in flag_rows:
        for flag in flags or []:
            if isinstance(flag, dict) and flag.get("code"):
                flag_counts[str(flag["code"])] = flag_counts.get(str(flag["code"]), 0) + 1
    top_flags = sorted(flag_counts.items(), key=lambda item: item[1], reverse=True)[:10]

    return {
        "tenant_id": str(scope_tenant) if scope_tenant else None,
        "cases_by_status": {str(key): int(value) for key, value in by_status.items()},
        "total_cases": total_cases,
        "decided_cases": decided,
        "avg_time_to_decision_seconds": round(float(avg_seconds), 1) if avg_seconds else None,
        "auto_approve_pct": round(100.0 * auto_approved / ai_decisions, 1) if ai_decisions else 0.0,
        "disbursed_pkr": disbursed,
        "top_flags": [{"code": code, "count": count} for code, count in top_flags],
        "open_cases": sum(
            int(count)
            for status, count in by_status.items()
            if str(status)
            not in {
                CaseStatus.PAID.value,
                CaseStatus.REJECTED.value,
                CaseStatus.WITHDRAWN.value,
                CaseStatus.CLOSED.value,
            }
        ),
    }


__all__ = ["router"]
