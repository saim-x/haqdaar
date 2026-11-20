"""Evaluation dashboard (docs/07 §8, docs/05 §3.9).

Full-file takeover of BE's stub. One endpoint that merges three independent sources:

1. **Decision-router sweep** — ``engine.eval_sweep`` over the labelled case file
   ``backend/app/data/eval_cases.jsonl`` (DPI-owned; read-only here). This is the
   Challenge 01 cost curve, with the knee and the active threshold highlighted.
2. **Model benchmarks** — ``app.ai.benchmarks.scam_metrics()`` and ``doc_metrics()``
   (DPI-owned). Import-guarded: if the module has not merged yet the dashboard still
   returns everything else plus ``benchmarks_available: false``.
3. **Live operations** — SQL over ``decisions``, ``case_notes`` and ``ai_telemetry``:
   decisions by route, officer override rate, p50/p95 pipeline latency, LLM calls,
   cost and failure rate for the last 24 hours.

Integration assumptions (confirm at S1):

* ``main.py`` includes this router with ``prefix="/api/v1"``.
* ``app.security.deps`` exposes ``require_roles(*roles)``.
* ``app.db.get_db`` yields a ``Session``.
* ``app.models`` exposes ``CaseNote``, ``Decision``, ``Program``, ``RuleVersion``,
  ``AiTelemetry``.
"""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.engine.eval_sweep import (
    LabelledCase,
    dashboard_payload,
    load_labelled_cases,
    sweep,
)
from app.engine.rules_dsl import RuleSetSchema
from app.models import AiTelemetry, CaseNote, Decision, Program, RuleVersion
from app.security.deps import require_roles

__all__ = ["router"]

router = APIRouter(tags=["eval"])

DbSession = Annotated[Session, Depends(get_db)]
Viewer = Annotated[Any, Depends(require_roles("ADMIN", "AUDITOR", "OFFICER"))]

#: DPI-owned labelled dataset (docs/14 A3). Read-only for us.
EVAL_CASES_PATH = Path(__file__).resolve().parents[2] / "data" / "eval_cases.jsonl"

#: docs/07 §8: live operations look back one day.
LIVE_WINDOW_HOURS = 24

#: ``doc_metrics()`` re-verifies 30 images (~2 s) per call. The eval set is committed,
#: so cache the result; the TTL only exists so a dataset swap is eventually picked up.
DOC_METRICS_TTL_SECONDS = 300.0
_doc_metrics_cache: tuple[float, dict[str, Any]] | None = None


# -- helpers -------------------------------------------------------------
def _tenant_id(user: Any) -> Any:
    return getattr(user, "tenant_id", None)


def _active_ruleset(
    db: Session, tenant_id: Any, program_id: Any | None
) -> tuple[Any, RuleSetSchema | None]:
    """The active rule version of the requested (or first active) program."""
    query = select(Program).where(Program.is_active.is_(True))
    if tenant_id is not None:
        query = query.where(Program.tenant_id == tenant_id)
    if program_id is not None:
        query = query.where(Program.id == program_id)
    program = db.execute(query.order_by(Program.created_at.asc())).scalars().first()
    if program is None or not program.active_rule_version_id:
        return program, None
    version = db.get(RuleVersion, program.active_rule_version_id)
    if version is None:
        return program, None
    return program, RuleSetSchema.model_validate(version.rules_json)


def _load_cases(path: Path) -> tuple[list[LabelledCase], str | None]:
    if not path.exists():
        return [], f"labelled dataset not found at {path.name}"
    try:
        return load_labelled_cases(path), None
    except (ValueError, KeyError) as exc:  # malformed JSONL must not 500 the dashboard
        return [], f"labelled dataset unreadable: {type(exc).__name__}"


def _percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(fraction * (len(ordered) - 1))))
    return int(ordered[index])


def _import_benchmarks() -> Any:
    """The lazy import seam for DPI's benchmarks module.

    Kept as its own function so the "module has not merged" path is testable by
    patching this seam, rather than by manipulating ``sys.modules`` for a module that
    now exists.
    """
    from app.ai import benchmarks

    return benchmarks


def _doc_metrics(benchmarks: Any) -> dict[str, Any]:
    """``doc_metrics()`` behind a TTL cache.

    DPI's implementation re-runs the real verifier over the 30-image eval set on every
    call (~2 s). The dataset is committed, so the result cannot change at runtime;
    paying that on every dashboard load would make the page feel broken.
    """
    global _doc_metrics_cache
    now = time.monotonic()
    if _doc_metrics_cache is not None:
        cached_at, cached = _doc_metrics_cache
        if now - cached_at < DOC_METRICS_TTL_SECONDS:
            return dict(cached)
    measured = benchmarks.doc_metrics() if hasattr(benchmarks, "doc_metrics") else {}
    _doc_metrics_cache = (now, dict(measured or {}))
    return dict(measured or {})


def _benchmarks(db: Session | None = None) -> tuple[dict[str, Any], dict[str, Any], bool]:
    """DPI's benchmark metrics, or empty blocks when the module has not merged."""
    try:
        benchmarks = _import_benchmarks()
    except ImportError:
        return {}, {}, False
    # ``db`` gives the scam block its live check and dispute counts (docs/07 §8).
    scam = benchmarks.scam_metrics(db) if hasattr(benchmarks, "scam_metrics") else {}
    return dict(scam or {}), _doc_metrics(benchmarks), True


# -- live operations -----------------------------------------------------
def _live_operations(db: Session, tenant_id: Any) -> dict[str, Any]:
    since = datetime.now(UTC) - timedelta(hours=LIVE_WINDOW_HOURS)
    decision_filter = [Decision.tenant_id == tenant_id] if tenant_id is not None else []

    total = int(
        db.execute(
            select(func.count()).select_from(Decision).where(*decision_filter)
        ).scalar_one()
    )

    by_route: dict[str, int] = {}
    for route, count in db.execute(
        select(Decision.route_action, func.count())
        .where(*decision_filter)
        .group_by(Decision.route_action)
    ).all():
        by_route[str(route)] = int(count)

    officer_decisions = int(
        db.execute(
            select(func.count())
            .select_from(Decision)
            .where(*decision_filter, Decision.decision_source != "AI_ENGINE")
        ).scalar_one()
    )
    overrides = int(
        db.execute(
            select(func.count())
            .select_from(Decision)
            .where(*decision_filter, Decision.is_override.is_(True))
        ).scalar_one()
    )

    # Pipeline latency: sum the AGENT_STEP latencies per case, then take percentiles.
    note_filter = [CaseNote.note_type == "AGENT_STEP"]
    if tenant_id is not None:
        note_filter.append(CaseNote.tenant_id == tenant_id)
    step_rows = db.execute(
        select(CaseNote.case_id, CaseNote.metadata_json).where(*note_filter)
    ).all()
    per_case: dict[Any, int] = {}
    for case_id, metadata in step_rows:
        latency = (metadata or {}).get("latency_ms")
        if isinstance(latency, int):
            per_case[case_id] = per_case.get(case_id, 0) + latency
    latencies = list(per_case.values())

    telemetry_filter = [AiTelemetry.created_at >= since]
    if tenant_id is not None:
        telemetry_filter.append(AiTelemetry.tenant_id == tenant_id)
    llm_calls = int(
        db.execute(
            select(func.count()).select_from(AiTelemetry).where(*telemetry_filter)
        ).scalar_one()
    )
    llm_failures = int(
        db.execute(
            select(func.count())
            .select_from(AiTelemetry)
            .where(*telemetry_filter, AiTelemetry.succeeded.is_(False))
        ).scalar_one()
    )
    llm_cost = float(
        db.execute(
            select(func.coalesce(func.sum(AiTelemetry.estimated_cost_usd), 0)).where(
                *telemetry_filter
            )
        ).scalar_one()
    )

    return {
        "total_decisions": total,
        "by_route": by_route,
        "officer_override_rate": (
            round(overrides / officer_decisions, 4) if officer_decisions else 0.0
        ),
        "latency_p50_ms": _percentile(latencies, 0.50),
        "latency_p95_ms": _percentile(latencies, 0.95),
        "llm_calls_24h": llm_calls,
        "llm_cost_usd_24h": round(llm_cost, 6),
        "llm_failure_rate": round(llm_failures / llm_calls, 4) if llm_calls else 0.0,
    }


# -- the endpoint --------------------------------------------------------
@router.get("/eval/dashboard")
def eval_dashboard(
    db: DbSession,
    user: Viewer,
    program_id: Annotated[uuid.UUID | None, Query()] = None,
) -> dict[str, Any]:
    """Threshold sweep + model benchmarks + live operations (docs/07 §8)."""
    tenant_id = _tenant_id(user)
    program, ruleset = _active_ruleset(db, tenant_id, program_id)

    cases, dataset_note = _load_cases(EVAL_CASES_PATH)
    if ruleset is not None and cases:
        sweep_block = dashboard_payload(sweep(cases, ruleset))
    else:
        sweep_block = {
            "decision_router_sweep": [],
            "active_threshold": (
                ruleset.policy.auto_approve_confidence_threshold if ruleset else None
            ),
            "knee_threshold": None,
            "sample_size": 0,
        }

    scam, documents, benchmarks_available = _benchmarks(db)

    return {
        **sweep_block,
        "scam_classifier": scam,
        "document_verifier": documents,
        "live_operations": _live_operations(db, tenant_id),
        "benchmarks_available": benchmarks_available,
        "program": (
            {"id": str(program.id), "code": program.code} if program is not None else None
        ),
        "dataset_note": dataset_note,
        "generated_at": datetime.now(UTC).isoformat(),
    }
