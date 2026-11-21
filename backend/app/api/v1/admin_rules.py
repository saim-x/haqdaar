"""Rule Editor, Digital Twin and publish endpoints (docs/05 §3.7).

Full-file takeover of BE's stub. Six endpoints, all tenant-scoped, all audited:

    GET    /admin/programs/{program_id}/rules          ADMIN, AUDITOR
    POST   /admin/programs/{program_id}/rules          ADMIN
    PUT    /admin/rules/{rule_version_id}              ADMIN
    POST   /admin/rules/{rule_version_id}/validate     ADMIN
    POST   /admin/rules/{rule_version_id}/simulate     ADMIN
    POST   /admin/rules/{rule_version_id}/publish      ADMIN

Integration assumptions (confirm at S1, all in one place):

* ``main.py`` includes this router with ``prefix="/api/v1"``; the router itself
  carries ``prefix="/admin"``.
* ``app.security.deps`` exposes ``require_roles(*roles)`` (docs/09 §2). The user
  object has ``id``, ``role`` and ``tenant_id``.
* ``app.db.get_db`` yields a ``Session``.
* ``app.models`` exposes ``Program``, ``RuleVersion``, ``SimulationRun``, ``Case``,
  ``Decision``.

Publishing is atomic: the version flips to ``PUBLISHED``, the previous active version
is ``ARCHIVED``, ``programs.active_rule_version_id`` moves, and ``REINDEX_RAG`` is
enqueued — all in one transaction, so the next evaluation uses the new rules with no
restart.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.agent import deps
from app.db import get_db
from app.engine.rules_dsl import RuleSetSchema, validate_rules_json
from app.engine.twin import TwinCase, replay
from app.models import Case, Decision, Program, RuleVersion, SimulationRun
from app.security.deps import require_roles

__all__ = ["router"]

router = APIRouter(prefix="/admin", tags=["admin-rules"])

DbSession = Annotated[Session, Depends(get_db)]
AdminUser = Annotated[Any, Depends(require_roles("ADMIN"))]
AdminOrAuditor = Annotated[Any, Depends(require_roles("ADMIN", "AUDITOR"))]
JsonBody = Annotated[dict[str, Any] | None, Body()]

#: docs/05 §3.7: the Digital Twin replays the last 200 decided cases by default.
DEFAULT_SAMPLE_SIZE = 200
MAX_SAMPLE_SIZE = 1000


# -- error envelope (docs/05 §2) ----------------------------------------
def _error(
    status_code: int,
    code: str,
    message_en: str,
    message_ur: str,
    *,
    details: dict[str, Any] | None = None,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={
            "error": {
                "code": code,
                "message_en": message_en,
                "message_ur": message_ur,
                "details": details or {},
            }
        },
    )


def _not_found() -> HTTPException:
    return _error(
        status.HTTP_404_NOT_FOUND,
        "NOT_FOUND",
        "Resource not found.",
        "وسیلہ موجود نہیں۔",
    )


def _immutable() -> HTTPException:
    return _error(
        status.HTTP_409_CONFLICT,
        "RULE_VERSION_IMMUTABLE",
        "A published rule version cannot be edited. Create a new draft instead.",
        "شائع شدہ قواعد میں ترمیم نہیں کی جا سکتی۔ نیا ڈرافٹ بنائیں۔",
    )


def _validation_failed(errors: tuple[dict[str, str], ...]) -> HTTPException:
    return _error(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "RULE_VALIDATION_FAILED",
        "The rule set failed validation.",
        "قواعد کی جانچ ناکام رہی۔",
        details={"errors": list(errors)},
    )


# -- helpers -------------------------------------------------------------
def _is_platform_or_auditor(user: Any) -> bool:
    return getattr(user, "tenant_id", None) is None and getattr(user, "role", None) in {
        "ADMIN",
        "AUDITOR",
    }


def _tenant_id(user: Any) -> Any:
    tenant_id = getattr(user, "tenant_id", None)
    if tenant_id is None:
        raise _error(
            status.HTTP_403_FORBIDDEN,
            "FORBIDDEN",
            "This endpoint requires a tenant-scoped account.",
            "یہ سہولت صرف ادارے کے اکاؤنٹ کے لیے ہے۔",
        )
    return tenant_id


def _get_program(db: Session, program_id: Any, user: Any) -> Program:
    program = db.get(Program, program_id)
    if program is None:
        raise _not_found()
    if _is_platform_or_auditor(user):
        return program
    if program.tenant_id != _tenant_id(user):
        raise _not_found()
    return program


def _get_version(db: Session, rule_version_id: Any, user: Any) -> RuleVersion:
    version = db.get(RuleVersion, rule_version_id)
    if version is None:
        raise _not_found()
    if _is_platform_or_auditor(user):
        return version
    if version.tenant_id != _tenant_id(user):
        raise _not_found()
    return version


def _version_json(version: RuleVersion) -> dict[str, Any]:
    return {
        "id": str(version.id),
        "program_id": str(version.program_id),
        "version_number": version.version_number,
        "status": version.status,
        "content_hash": version.content_hash,
        "change_note": version.change_note,
        "rules_json": version.rules_json,
        "created_by_user_id": (
            str(version.created_by_user_id) if version.created_by_user_id else None
        ),
        "published_by_user_id": (
            str(version.published_by_user_id) if version.published_by_user_id else None
        ),
        "published_at": (
            version.published_at.isoformat() if version.published_at else None
        ),
        "created_at": version.created_at.isoformat() if version.created_at else None,
    }


def _next_version_number(db: Session, program_id: Any) -> int:
    current = db.execute(
        select(func.max(RuleVersion.version_number)).where(
            RuleVersion.program_id == program_id
        )
    ).scalar_one_or_none()
    return int(current or 0) + 1


def _active_version(db: Session, program: Program) -> RuleVersion | None:
    if not program.active_rule_version_id:
        return None
    return db.get(RuleVersion, program.active_rule_version_id)


def _ruleset_or_422(version: RuleVersion) -> RuleSetSchema:
    """Parse a stored ``rules_json``, reporting a bad row as 422, never a 500.

    A version written before a DSL change (or hand-edited in the database) must
    surface as ``422 RULE_VALIDATION_FAILED`` with ``details.errors`` — the same
    contract publish and validate honour (docs/05 §2).
    """
    report = validate_rules_json(version.rules_json)
    if not report.valid or report.ruleset is None:
        raise _validation_failed(report.errors)
    return report.ruleset


# -- list ----------------------------------------------------------------
@router.get("/programs/{program_id}/rules")
def list_rule_versions(
    program_id: uuid.UUID,
    db: DbSession,
    user: AdminOrAuditor,
) -> dict[str, Any]:
    """Every version of a program's rules, newest first, with hashes and notes."""
    program = _get_program(db, program_id, user)
    versions = (
        db.execute(
            select(RuleVersion)
            .where(RuleVersion.program_id == program.id)
            .order_by(RuleVersion.version_number.desc())
        )
        .scalars()
        .all()
    )
    return {
        "program_id": str(program.id),
        "program_code": program.code,
        "active_rule_version_id": (
            str(program.active_rule_version_id)
            if program.active_rule_version_id
            else None
        ),
        "versions": [_version_json(version) for version in versions],
    }


# -- create draft --------------------------------------------------------
@router.post("/programs/{program_id}/rules", status_code=status.HTTP_201_CREATED)
def create_rule_draft(
    program_id: uuid.UUID,
    db: DbSession,
    user: AdminUser,
    payload: JsonBody = None,
) -> dict[str, Any]:
    """Create a ``DRAFT``, cloned from the active version or supplied wholesale."""
    program = _get_program(db, program_id, user)
    body = payload or {}
    rules_json = body.get("rules_json")
    clone_from = body.get("clone_from")

    if rules_json is None:
        source = _active_version(db, program)
        if source is None:
            raise _error(
                status.HTTP_400_BAD_REQUEST,
                "VALIDATION_ERROR",
                "No active rule version to clone and no rules_json supplied.",
                "کوئی فعال قواعد نہیں اور نئی قواعد بھی فراہم نہیں کی گئیں۔",
                details={"fields": ["rules_json"]},
            )
        rules_json = source.rules_json
    elif clone_from not in (None, "ACTIVE"):
        raise _error(
            status.HTTP_400_BAD_REQUEST,
            "VALIDATION_ERROR",
            "clone_from must be 'ACTIVE' when rules_json is supplied.",
            "rules_json کے ساتھ clone_from کی قدر 'ACTIVE' ہونی چاہیے۔",
            details={"fields": ["clone_from"]},
        )

    report = validate_rules_json(rules_json)
    if not report.valid:
        raise _validation_failed(report.errors)

    version = RuleVersion(
        id=uuid.uuid4(),
        tenant_id=program.tenant_id,
        program_id=program.id,
        version_number=_next_version_number(db, program.id),
        status="DRAFT",
        rules_json=rules_json,
        content_hash=report.content_hash,
        change_note=body.get("change_note"),
        created_by_user_id=getattr(user, "id", None),
    )
    db.add(version)
    db.flush()
    deps.audit(
        db,
        action="rule.draft_created",
        resource_type="rule_version",
        resource_id=version.id,
        tenant_id=program.tenant_id,
        actor_user_id=getattr(user, "id", None),
        payload={
            "program_id": str(program.id),
            "version_number": version.version_number,
            "content_hash": version.content_hash,
            "cloned_from": (
                str(program.active_rule_version_id)
                if program.active_rule_version_id
                else None
            ),
        },
    )
    db.commit()
    return _version_json(version)


# -- update draft --------------------------------------------------------
@router.put("/rules/{rule_version_id}")
def update_rule_draft(
    rule_version_id: uuid.UUID,
    db: DbSession,
    user: AdminUser,
    payload: JsonBody = None,
) -> dict[str, Any]:
    """Edit a ``DRAFT``. Published versions are immutable (409)."""
    version = _get_version(db, rule_version_id, user)
    if version.status != "DRAFT":
        raise _immutable()

    body = payload or {}
    rules_json = body.get("rules_json", version.rules_json)
    report = validate_rules_json(rules_json)
    if not report.valid:
        raise _validation_failed(report.errors)

    version.rules_json = rules_json
    version.content_hash = report.content_hash
    if "change_note" in body:
        version.change_note = body["change_note"]
    deps.audit(
        db,
        action="rule.draft_updated",
        resource_type="rule_version",
        resource_id=version.id,
        tenant_id=version.tenant_id,
        actor_user_id=getattr(user, "id", None),
        payload={
            "version_number": version.version_number,
            "content_hash": version.content_hash,
        },
    )
    db.commit()
    return _version_json(version)


# -- validate ------------------------------------------------------------
@router.post("/rules/{rule_version_id}/validate")
def validate_rule_version(
    rule_version_id: uuid.UUID,
    db: DbSession,
    user: AdminUser,
) -> dict[str, Any]:
    """Validate the stored ``rules_json``; 422 with ``details.errors`` on failure."""
    version = _get_version(db, rule_version_id, user)
    report = validate_rules_json(version.rules_json)
    if not report.valid:
        raise _validation_failed(report.errors)
    return {
        "valid": True,
        "errors": [],
        "content_hash": report.content_hash,
        "rule_count": len(report.ruleset.eligibility_rules) if report.ruleset else 0,
    }


# -- simulate (Digital Twin) --------------------------------------------
@router.post("/rules/{rule_version_id}/simulate")
def simulate_rule_version(
    rule_version_id: uuid.UUID,
    db: DbSession,
    user: AdminUser,
    payload: JsonBody = None,
    sample_size: Annotated[int, Query(ge=1, le=MAX_SAMPLE_SIZE)] = DEFAULT_SAMPLE_SIZE,
) -> dict[str, Any]:
    """Replay historical decisions against this version. Zero side effects on cases."""
    version = _get_version(db, rule_version_id, user)
    program = _get_program(db, version.program_id, user)
    baseline = _active_version(db, program)
    if baseline is None:
        raise _error(
            status.HTTP_409_CONFLICT,
            "INVALID_TRANSITION",
            "The program has no active rule version to compare against.",
            "موازنے کے لیے کوئی فعال قواعد موجود نہیں۔",
        )

    requested = _requested_sample_size(payload, sample_size)
    baseline_rules = _ruleset_or_422(baseline)
    candidate_rules = _ruleset_or_422(version)

    rows = _historical_decision_rows(db, program, requested)
    cases, skipped = _replay_cases(rows)
    result = replay(baseline_rules, candidate_rules, cases, sample_size=requested)

    run = SimulationRun(
        id=uuid.uuid4(),
        tenant_id=program.tenant_id,
        program_id=program.id,
        baseline_rule_version_id=baseline.id,
        candidate_rule_version_id=version.id,
        sample_size=result.sample_size,
        summary_json=result.to_json(),
        created_by_user_id=getattr(user, "id", None),
    )
    db.add(run)
    deps.audit(
        db,
        action="rule.simulated",
        resource_type="rule_version",
        resource_id=version.id,
        tenant_id=program.tenant_id,
        actor_user_id=getattr(user, "id", None),
        payload={
            "simulation_run_id": str(run.id),
            "baseline_rule_version_id": str(baseline.id),
            "sample_size": result.sample_size,
            "flipped_count": result.flipped_count,
            "budget_delta_pkr": result.budget_delta_pkr,
            "skipped_rows": len(skipped),
            "skipped_case_ids": skipped[:20],
        },
    )
    db.commit()
    return {"simulation_run_id": str(run.id), **result.to_json()}


def _requested_sample_size(payload: dict[str, Any] | None, fallback: int) -> int:
    """``sample_size`` from the body, else the query default, clamped to the cap."""
    raw = (payload or {}).get("sample_size")
    if raw is None:
        raw = fallback
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise _error(
            status.HTTP_400_BAD_REQUEST,
            "VALIDATION_ERROR",
            "sample_size must be an integer.",
            "sample_size عددی ہونا چاہیے۔",
            details={"fields": ["sample_size"]},
        ) from None
    return max(1, min(value, MAX_SAMPLE_SIZE))


def _replay_cases(
    rows: list[dict[str, Any]],
) -> tuple[list[TwinCase], list[str]]:
    """Adapt stored decision rows, quarantining any that cannot be replayed.

    A historical row written by an older code path (or edited in the database)
    must never turn a read-only preview into a 500. Bad rows are skipped and
    reported in the audit payload, so the data problem stays visible instead of
    silently shrinking the sample.
    """
    cases: list[TwinCase] = []
    skipped: list[str] = []
    for row in rows:
        try:
            cases.append(TwinCase.from_decision_row(row))
        except (AttributeError, KeyError, TypeError, ValueError, ValidationError):
            skipped.append(str(row.get("case_id") or "unknown"))
    return cases, skipped


def _historical_decision_rows(
    db: Session, program: Program, limit: int
) -> list[dict[str, Any]]:
    """The last ``limit`` decided cases of this program, newest first."""
    case_ids = select(Case.id).where(
        Case.tenant_id == program.tenant_id, Case.program_id == program.id
    )
    decisions = (
        db.execute(
            select(Decision)
            .where(Decision.tenant_id == program.tenant_id, Decision.case_id.in_(case_ids))
            .order_by(Decision.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    rows: list[dict[str, Any]] = []
    for decision in decisions:
        case = db.get(Case, decision.case_id)
        rows.append(
            {
                "case_id": str(decision.case_id),
                "reference_code": getattr(case, "reference_code", "") or "",
                "input_snapshot_json": decision.input_snapshot_json,
                "flags_json": getattr(case, "flags_json", None) or [],
                "confidence_components": decision.confidence_components,
                "ask_more_rounds": getattr(case, "ask_more_rounds", 0) or 0,
                "hours_waiting": getattr(case, "hours_waiting", 0.0) or 0.0,
            }
        )
    return rows


# -- publish -------------------------------------------------------------
@router.post("/rules/{rule_version_id}/publish")
def publish_rule_version(
    rule_version_id: uuid.UUID,
    db: DbSession,
    user: AdminUser,
    payload: JsonBody = None,
) -> dict[str, Any]:
    """Validate, publish, move the program pointer, and enqueue ``REINDEX_RAG``."""
    version = _get_version(db, rule_version_id, user)
    program = _get_program(db, version.program_id, user)

    change_note = str((payload or {}).get("change_note") or "").strip()
    if not change_note:
        raise _error(
            status.HTTP_400_BAD_REQUEST,
            "VALIDATION_ERROR",
            "change_note is required when publishing a rule version.",
            "قواعد شائع کرتے وقت تبدیلی کا نوٹ لازمی ہے۔",
            details={"fields": ["change_note"]},
        )
    if version.status == "PUBLISHED":
        raise _error(
            status.HTTP_409_CONFLICT,
            "RULE_VERSION_IMMUTABLE",
            "This rule version is already published.",
            "یہ قواعد پہلے ہی شائع ہو چکے ہیں۔",
        )

    report = validate_rules_json(version.rules_json)
    if not report.valid:
        raise _validation_failed(report.errors)

    previous = _active_version(db, program)
    if previous is not None and previous.id != version.id:
        previous.status = "ARCHIVED"

    version.status = "PUBLISHED"
    version.change_note = change_note
    version.published_by_user_id = getattr(user, "id", None)
    version.published_at = datetime.now(UTC)
    version.content_hash = report.content_hash
    program.active_rule_version_id = version.id

    deps.enqueue_job(
        db,
        "REINDEX_RAG",
        {"program_id": str(program.id), "rule_version_id": str(version.id)},
        dedup_key=f"REINDEX_RAG:{version.id}",
    )
    deps.audit(
        db,
        action="rule.published",
        resource_type="rule_version",
        resource_id=version.id,
        tenant_id=program.tenant_id,
        actor_user_id=getattr(user, "id", None),
        payload={
            "program_id": str(program.id),
            "version_number": version.version_number,
            "content_hash": version.content_hash,
            "previous_rule_version_id": str(previous.id) if previous else None,
            "change_note": change_note,
        },
    )
    db.commit()
    return {
        **_version_json(version),
        "active_rule_version_id": str(program.active_rule_version_id),
        "reindex_enqueued": True,
    }
