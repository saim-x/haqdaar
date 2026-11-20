"""The single seam between the case agent and BE-owned infrastructure.

Every import of a teammate's module lives here, so when a signature shifts at the S1
merge there is exactly one file to fix. The paths are pinned by docs/14 (A1 integration
contracts) and ADR-011..014; the keyword names below are the reading of docs/04 §4.3
and docs/09 §4-5 that the agent codes against.

Assumed signatures (confirm at S1):

    enqueue_job(db, job_type, payload, *, dedup_key=None)          # pinned verbatim
    audit.record(db, *, action, resource_type, resource_id=None,
                 payload=None, actor_user_id=None, tenant_id=None)
    create_notification(db, *, tenant_id, citizen_id=None, user_id=None, phone=None,
                        channel, title_ur, title_en, body_ur, body_en, case_id=None)
    enforce_consent(db, *, citizen_id, actor, category, purpose, resource_ref)
    ActorContext(user_id, role, tenant_id, label, citizen_id=None)

Nothing in ``app/engine`` may import this module: the engine stays pure.
"""

from __future__ import annotations

from typing import Any

from app.jobs.queue import enqueue_job
from app.notify import create_notification
from app.security.audit import record as audit_record
from app.security.consent import ActorContext, ConsentRevokedError, enforce_consent

__all__ = [
    "ActorContext",
    "ConsentRevokedError",
    "agent_actor",
    "audit",
    "create_notification",
    "enforce_consent",
    "enqueue_job",
]


def agent_actor(tenant_id: Any, *, label: str = "case-agent") -> ActorContext:
    """The department agent's identity for consent checks (docs/09 §4.1)."""
    return ActorContext(
        user_id=None,
        role="AGENT",
        tenant_id=tenant_id,
        label=label,
        citizen_id=None,
    )


def audit(
    db: Any,
    *,
    action: str,
    resource_type: str,
    resource_id: Any = None,
    payload: dict[str, Any] | None = None,
    actor_user_id: Any = None,
    tenant_id: Any = None,
) -> Any:
    """``audit.record`` with the keyword names the agent uses everywhere."""
    return audit_record(
        db,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        payload=payload or {},
        actor_user_id=actor_user_id,
        tenant_id=tenant_id,
    )
