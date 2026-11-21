"""Deterministic nine-step case-processing agent (docs/07 §7).

Not an unconstrained LLM loop: a fixed pipeline where every step is a plain function,
every external call goes through :class:`MockClient` (httpx -> ``MOCK_BASE_URL``), and
every step leaves an ``AGENT_STEP`` case note plus an ``agent.step`` audit event.

Failure contract: a mock service that is down after two fast retries raises
:class:`ExternalServiceUnavailable`. The caller moves the case to ``WAITING_EXTERNAL``
and the ``PROCESS_CASE`` job reschedules with backoff. **Zero decision is recorded.**

Idempotency (AC-05.3): re-running the pipeline for the same case, facts and rule
version finds the existing decision by ``(case_id, input_snapshot_hash,
rule_content_hash)`` and writes nothing new — no duplicate decision, no duplicate
payment job.

Purity boundary: this module may import ``httpx``, ``sqlalchemy``, ``app.models`` and
the pinned BE helpers. It must never import ``app.mocks`` — the DPI services are only
reachable over HTTP.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from app.agent import deps
from app.agent.assemble import (
    AssembledFacts,
    DocumentRow,
    assemble_facts,
    parse_active_benefits,
    parse_death_records,
    parse_household,
    parse_identity_matches,
)
from app.agent.mock_client import ExternalServiceUnavailable, MockClient
from app.engine.anomalies import PayoutUsage, PriorCase
from app.engine.confidence import ConsentMethod
from app.engine.entity_resolution import name_sim
from app.engine.pipeline import EngineResult, evaluate_and_route
from app.engine.rules_dsl import RuleSetSchema
from app.models import (
    Case,
    CaseNote,
    Citizen,
    ConsentGrant,
    Decision,
    Document,
    Payment,
    Program,
    RuleVersion,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

__all__ = [
    "ExternalServiceUnavailable",
    "MockClient",
    "ReevaluationNotAllowed",
    "check_complaint_agent",
    "reevaluate_case",
    "run_case_agent",
]

#: Case statuses that mean "this application is still live" for duplicate detection.
_LIVE_STATUSES = (
    "SUBMITTED",
    "PROCESSING",
    "WAITING_EXTERNAL",
    "NEEDS_INFO",
    "HUMAN_REVIEW",
    "IN_REVIEW",
    "PENDING_SECOND_APPROVAL",
    "APPROVED",
    "PAYMENT_INITIATED",
    "PAID",
)

#: Route outcome -> case status. They share names by design (docs/04 §3.3).
_OUTCOME_TO_STATUS = {
    "APPROVED": "APPROVED",
    "NEEDS_INFO": "NEEDS_INFO",
    "HUMAN_REVIEW": "HUMAN_REVIEW",
    "WAITING_EXTERNAL": "WAITING_EXTERNAL",
}


# -- run context ---------------------------------------------------------
@dataclass
class _Context:
    """Everything the nine steps read and write."""

    db: Session
    case: Any
    citizen: Any
    program: Any
    rule_version: Any
    ruleset: RuleSetSchema
    client: MockClient
    correlation_id: str
    identity_payload: dict[str, Any] | None = None
    death_payload: dict[str, Any] | None = None
    household_payload: dict[str, Any] | None = None
    benefits_payload: dict[str, Any] | None = None
    documents: tuple[DocumentRow, ...] = ()
    prior_cases: tuple[PriorCase, ...] = ()
    payout_usages: tuple[PayoutUsage, ...] = ()
    helper_submissions: int | None = None
    payout_title_similarity: float | None = None
    civil_registry_queried: bool = True
    benefits_registry_queried: bool = True
    assembled: AssembledFacts | None = None
    result: EngineResult | None = None
    decision: Any = None
    deduped: bool = False
    steps: list[dict[str, Any]] = field(default_factory=list)


def _draft_value(draft: dict[str, Any], key: str) -> Any:
    entry = draft.get(key)
    if isinstance(entry, dict):
        return entry.get("value")
    return entry


def _hours_waiting(case: Any) -> float:
    created = getattr(case, "created_at", None)
    if created is None:
        return 0.0
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    return max(0.0, (datetime.now(UTC) - created).total_seconds() / 3600.0)


# -- step bookkeeping ----------------------------------------------------
def _record_step(
    ctx: _Context,
    name: str,
    started: float,
    *,
    status: str,
    detail: str = "",
) -> None:
    latency_ms = int((time.perf_counter() - started) * 1000)
    ctx.steps.append(
        {"step": name, "status": status, "latency_ms": latency_ms, "detail": detail}
    )
    ctx.db.add(
        CaseNote(
            tenant_id=ctx.case.tenant_id,
            case_id=ctx.case.id,
            author_user_id=None,
            note_type="AGENT_STEP",
            body=f"{name}: {status}" + (f" — {detail}" if detail else ""),
            metadata_json={
                "step": name,
                "status": status,
                "latency_ms": latency_ms,
                "correlation_id": ctx.correlation_id,
                "detail": detail,
            },
            is_visible_to_citizen=False,
        )
    )
    deps.audit(
        ctx.db,
        action="agent.step",
        resource_type="case",
        resource_id=ctx.case.id,
        tenant_id=ctx.case.tenant_id,
        payload={
            "step": name,
            "status": status,
            "latency_ms": latency_ms,
            "correlation_id": ctx.correlation_id,
        },
    )


def _run_step(ctx: _Context, name: str, fn: Callable[[_Context], None]) -> None:
    started = time.perf_counter()
    try:
        fn(ctx)
    except ExternalServiceUnavailable as exc:
        _record_step(
            ctx,
            name,
            started,
            status="FAILED",
            detail=f"{exc.service}: {exc.detail}",
        )
        raise
    _record_step(ctx, name, started, status="OK")


# -- step 1: consent -----------------------------------------------------
def _step_verify_consent(ctx: _Context) -> None:
    """Active DEPARTMENT consent for IDENTITY, HOUSEHOLD and DOCUMENTS.

    Those three are the citizen's own data (docs/04 §3.1 ``data_category``). The
    benefits-registry and payout-alias lookups in step 7 are cross-program fraud and
    eligibility checks, not reads of the applicant's record, so they are not gated on
    ``PAYMENT`` / ``CASE_HISTORY`` consent — gating them would park a case that the
    citizen has fully authorised.
    """
    actor = deps.agent_actor(ctx.case.tenant_id)
    for category in ("IDENTITY", "HOUSEHOLD", "DOCUMENTS"):
        deps.enforce_consent(
            ctx.db,
            citizen_id=ctx.citizen.id,
            actor=actor,
            category=category,
            purpose="BENEFIT_APPLICATION",
            resource_ref=ctx.case.reference_code,
        )


# -- step 2: identity ----------------------------------------------------
def _step_fetch_identity(ctx: _Context) -> None:
    draft = ctx.case.draft_answers or {}
    cnic = _draft_value(draft, "applicant_cnic")
    params: dict[str, Any] = {}
    if cnic:
        params["cnic"] = str(cnic)
    else:
        name = _draft_value(draft, "applicant_full_name")
        district = _draft_value(draft, "applicant_district")
        dob = _draft_value(draft, "applicant_dob")
        if name:
            params["name"] = str(name)
        if district:
            params["district"] = str(district)
        if dob:
            params["dob"] = str(dob)
    if not params:
        ctx.identity_payload = {"matches": []}
        return
    ctx.identity_payload = ctx.client.get(
        "identity", "/mock/v1/identity/lookup", params=params
    )


# -- step 3: civil death registry ---------------------------------------
def _step_fetch_civil_death(ctx: _Context) -> None:
    draft = ctx.case.draft_answers or {}
    spouse_cnic = _draft_value(draft, "spouse_cnic")
    params: dict[str, Any] = {}
    if spouse_cnic:
        params["spouse_cnic"] = str(spouse_cnic)
    else:
        name = _draft_value(draft, "spouse_full_name")
        district = _draft_value(draft, "applicant_district")
        if name:
            params["deceased_name"] = str(name)
        if district:
            params["district"] = str(district)
    if not params:
        # Nothing to search on: the registry was not consulted, so the fact is UNKNOWN.
        ctx.civil_registry_queried = False
        ctx.death_payload = {"records": []}
        return
    ctx.death_payload = ctx.client.get(
        "civil", "/mock/v1/civil/death-records", params=params
    )


# -- step 4: household survey -------------------------------------------
def _step_fetch_household(ctx: _Context) -> None:
    cnic = _draft_value(ctx.case.draft_answers or {}, "applicant_cnic")
    if not cnic:
        ctx.household_payload = {"found": False}
        return
    ctx.household_payload = ctx.client.get(
        "household", "/mock/v1/household/survey", params={"cnic": str(cnic)}
    )


# -- step 5: benefits registry ------------------------------------------
def _step_fetch_benefits(ctx: _Context) -> None:
    cnic = _draft_value(ctx.case.draft_answers or {}, "applicant_cnic")
    if not cnic:
        ctx.benefits_registry_queried = False
        ctx.benefits_payload = {"active_benefits": []}
        return
    ctx.benefits_payload = ctx.client.get(
        "benefits", "/mock/v1/benefits/active", params={"cnic": str(cnic)}
    )


# -- step 6: documents ---------------------------------------------------
def _step_check_documents(ctx: _Context) -> None:
    rows = (
        ctx.db.execute(
            select(Document)
            .where(Document.case_id == ctx.case.id)
            .order_by(Document.created_at.asc(), Document.id.asc())
        )
        .scalars()
        .all()
    )
    latest_documents = {row.doc_type: row for row in rows}
    ctx.documents = tuple(
        DocumentRow(
            doc_type=row.doc_type,
            verify_status=row.verify_status,
            verify_confidence=(
                float(row.verify_confidence)
                if row.verify_confidence is not None
                else None
            ),
            verify_checks=tuple(row.verify_checks or ()),
            extracted_fields=row.extracted_fields or {},
        )
        for row in latest_documents.values()
    )


# -- step 7: anomaly checks ---------------------------------------------
def _step_run_anomaly_checks(ctx: _Context) -> None:
    draft = ctx.case.draft_answers or {}
    cnic = _draft_value(draft, "applicant_cnic")
    alias = _draft_value(draft, "payout_phone")

    # Duplicate application: same citizen, same program, still live.
    if cnic:
        prior_rows = (
            ctx.db.execute(
                select(Case).where(
                    Case.tenant_id == ctx.case.tenant_id,
                    Case.citizen_id == ctx.citizen.id,
                    Case.program_id == ctx.case.program_id,
                    Case.id != ctx.case.id,
                    Case.status.in_(_LIVE_STATUSES),
                )
            )
            .scalars()
            .all()
        )
        ctx.prior_cases = tuple(
            PriorCase(
                case_id=str(row.id),
                cnic_digits=str(cnic),
                program_code=ctx.program.code,
                status=row.status,
                created_at=(
                    row.created_at.date()
                    if isinstance(row.created_at, datetime)
                    else row.created_at
                ),
            )
            for row in prior_rows
            if row.created_at is not None
        )

    # Shared payout alias: PAYOUT usages count, shared CONTACT phones do not.
    # Deliberately not tenant-scoped: docs/06 §6 defines the trigger as "≥ 2 other
    # distinct citizens' cases", and the same alias paying citizens of two departments
    # is a stronger fraud signal, not a weaker one. Nothing here is returned to a user.
    if alias:
        usages: list[PayoutUsage] = []
        paid = (
            ctx.db.execute(
                select(Payment).where(
                    Payment.payout_alias == str(alias),
                    Payment.citizen_id != ctx.citizen.id,
                )
            )
            .scalars()
            .all()
        )
        usages.extend(
            PayoutUsage(
                citizen_id=str(row.citizen_id), alias=str(alias), alias_kind="PAYOUT"
            )
            for row in paid
        )
        contacts = (
            ctx.db.execute(
                select(Citizen).where(
                    Citizen.phone == str(alias), Citizen.id != ctx.citizen.id
                )
            )
            .scalars()
            .all()
        )
        usages.extend(
            PayoutUsage(
                citizen_id=str(row.id), alias=str(alias), alias_kind="CONTACT"
            )
            for row in contacts
        )
        ctx.payout_usages = tuple(usages)

        title_payload = ctx.client.get(
            "payment", "/mock/v1/payments/account-title", params={"alias": str(alias)}
        )
        account_title = title_payload.get("account_title")
        applicant_name = _draft_value(draft, "applicant_full_name")
        if account_title and applicant_name:
            ctx.payout_title_similarity = name_sim(
                str(account_title), str(applicant_name)
            )

    # Helper velocity: more than 10 submissions in the last hour.
    if ctx.case.submitted_via_helper and ctx.case.submitted_by_user_id:
        since = datetime.now(UTC) - timedelta(minutes=60)
        ctx.helper_submissions = int(
            ctx.db.execute(
                select(func.count())
                .select_from(Case)
                .where(
                    Case.submitted_by_user_id == ctx.case.submitted_by_user_id,
                    Case.created_at >= since,
                )
            ).scalar_one()
        )


# -- step 8: assemble and decide ----------------------------------------
def _step_assemble_facts_and_decide(ctx: _Context) -> None:
    draft = ctx.case.draft_answers or {}
    ctx.assembled = assemble_facts(
        draft_answers=draft,
        identity_matches=parse_identity_matches(ctx.identity_payload),
        death_records=parse_death_records(ctx.death_payload),
        household=parse_household(ctx.household_payload),
        active_benefits=parse_active_benefits(ctx.benefits_payload),
        documents=ctx.documents,
        program_code=ctx.program.code,
        consent_method=_consent_method(ctx.db, ctx.case),
        prior_cases=ctx.prior_cases,
        payout_usages=ctx.payout_usages,
        helper_submissions_last_60_minutes=ctx.helper_submissions,
        payout_title_similarity=ctx.payout_title_similarity,
        civil_registry_queried=ctx.civil_registry_queried,
        benefits_registry_queried=ctx.benefits_registry_queried,
    )
    ctx.result = evaluate_and_route(
        ctx.assembled.facts,
        ctx.ruleset,
        identity_confidence=ctx.assembled.identity_confidence,
        flags=ctx.assembled.flags,
        documents=ctx.assembled.documents,
        consent_method=ctx.assembled.consent_method,
        ask_more_rounds=int(ctx.case.ask_more_rounds or 0),
        external_unavailable=False,
        hours_waiting=_hours_waiting(ctx.case),
        rule_version_number=getattr(ctx.rule_version, "version_number", None),
    )


def _consent_method(db: Session, case: Any) -> str:
    """Assurance comes from the consent grant, never from a wizard answer.

    ``consent_method`` is not a canonical fact key (docs/04 §5 is frozen); the
    citizen's assurance level lives on ``consent_grants.assurance_level`` and
    uses the same three values as :class:`ConsentMethod`.
    """
    citizen_id = getattr(case, "citizen_id", None)
    if citizen_id is not None:
        assurance = db.execute(
            select(ConsentGrant.assurance_level)
            .where(
                ConsentGrant.citizen_id == citizen_id,
                ConsentGrant.status == "ACTIVE",
            )
            .order_by(ConsentGrant.granted_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if assurance in ConsentMethod.__members__:
            return str(assurance)
    return ConsentMethod.SELF_OTP.value


# -- step 9: commit and dispatch ----------------------------------------
def _step_commit_and_dispatch(ctx: _Context) -> None:
    result = ctx.result
    assert result is not None  # step 8 always runs before step 9

    existing = (
        ctx.db.execute(
            select(Decision).where(
                Decision.case_id == ctx.case.id,
                Decision.input_snapshot_hash == result.input_snapshot_hash,
                Decision.rule_content_hash == result.rule_content_hash,
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        ctx.decision = existing
        ctx.deduped = True
        return

    payload = result.to_decision_payload()
    decision = Decision(
        id=uuid.uuid4(),
        tenant_id=ctx.case.tenant_id,
        case_id=ctx.case.id,
        decision_source="AI_ENGINE",
        actor_user_id=None,
        rule_version_id=ctx.rule_version.id,
        **payload,
    )
    ctx.db.add(decision)
    ctx.db.flush()
    ctx.decision = decision

    status = _OUTCOME_TO_STATUS[result.route.outcome.value]
    ctx.case.status = status
    ctx.case.latest_route = result.route.action.value
    ctx.case.latest_confidence = result.confidence.overall
    ctx.case.latest_rule_version_id = ctx.rule_version.id
    ctx.case.priority_score = result.route.priority_score
    ctx.case.priority_band = result.route.priority_band.value
    ctx.case.flags_json = [flag.to_json() for flag in ctx.assembled.flags]  # type: ignore[union-attr]
    ctx.case.ai_case_note = (
        result.route.handoff.to_json() if result.route.handoff is not None else None
    )
    ctx.case.citizen_explanation = result.explanation.to_json()
    if status == "APPROVED":
        ctx.case.approved_amount_pkr = result.amount_pkr
        ctx.case.decided_at = datetime.now(UTC)
    else:
        # A re-evaluation that no longer approves must not leave a stale amount behind.
        ctx.case.approved_amount_pkr = None
        ctx.case.decided_at = None
    if status == "NEEDS_INFO":
        ctx.case.ask_more_rounds = int(ctx.case.ask_more_rounds or 0) + 1

    _notify(ctx, result)
    if status == "APPROVED":
        deps.enqueue_job(
            ctx.db,
            "INITIATE_PAYMENT",
            {
                "case_id": str(ctx.case.id),
                "decision_id": str(decision.id),
                "amount_pkr": result.amount_pkr,
            },
            dedup_key=f"INITIATE_PAYMENT:{decision.id}",
        )

    deps.audit(
        ctx.db,
        action="decision.recorded",
        resource_type="decision",
        resource_id=decision.id,
        tenant_id=ctx.case.tenant_id,
        payload={
            "case_id": str(ctx.case.id),
            "route_action": result.route.action.value,
            "outcome_status": result.route.outcome.value,
            "confidence_overall": result.confidence.overall,
            "rule_content_hash": result.rule_content_hash,
            "input_snapshot_hash": result.input_snapshot_hash,
            "amount_pkr": result.amount_pkr,
            "amount_provisional": result.amount_provisional,
            "correlation_id": ctx.correlation_id,
        },
    )


def _notify(ctx: _Context, result: EngineResult) -> None:
    """Citizen-facing notification for every route (docs/07 §7 step 9)."""
    explanation = result.explanation
    phone = getattr(ctx.citizen, "phone", None)
    deps.create_notification(
        ctx.db,
        tenant_id=ctx.case.tenant_id,
        citizen_id=ctx.citizen.id,
        user_id=getattr(ctx.citizen, "user_id", None),
        phone=phone,
        channel="SMS_SIMULATED" if phone else "IN_APP",
        title_ur=explanation.headline_ur,
        title_en=explanation.headline_en,
        body_ur=" ".join((explanation.headline_ur, *explanation.reasons_ur, explanation.next_step_ur)),
        body_en=" ".join((explanation.headline_en, *explanation.reasons_en, explanation.next_step_en)),
        case_id=ctx.case.id,
    )


# -- orchestration -------------------------------------------------------
def _load_ruleset(rule_version: Any) -> RuleSetSchema:
    return RuleSetSchema.model_validate(rule_version.rules_json)


def _load_context(
    db: Session, case: Any, client: MockClient, correlation_id: str
) -> _Context:
    citizen = db.get(Citizen, case.citizen_id)
    if citizen is None:
        raise LookupError(f"citizen {case.citizen_id} not found for case {case.id}")
    program = db.get(Program, case.program_id)
    if program is None:
        raise LookupError(f"program {case.program_id} not found for case {case.id}")
    rule_version = (
        db.get(RuleVersion, program.active_rule_version_id)
        if program.active_rule_version_id
        else None
    )
    if rule_version is None:
        raise LookupError(f"program {program.code} has no active rule version")
    return _Context(
        db=db,
        case=case,
        citizen=citizen,
        program=program,
        rule_version=rule_version,
        ruleset=_load_ruleset(rule_version),
        client=client,
        correlation_id=correlation_id,
    )


_STEPS: tuple[tuple[str, Callable[[_Context], None]], ...] = (
    ("verify_consent", _step_verify_consent),
    ("fetch_identity", _step_fetch_identity),
    ("fetch_civil_death", _step_fetch_civil_death),
    ("fetch_household", _step_fetch_household),
    ("fetch_benefits", _step_fetch_benefits),
    ("check_documents", _step_check_documents),
    ("run_anomaly_checks", _step_run_anomaly_checks),
    ("assemble_facts_and_decide", _step_assemble_facts_and_decide),
    ("commit_and_dispatch", _step_commit_and_dispatch),
)


def run_case_agent(
    db: Session,
    case_id: Any,
    *,
    correlation_id: str | None = None,
    client: MockClient | None = None,
) -> Any:
    """Run the nine steps for one case. Returns the ``Decision`` (or ``None``)."""
    correlation_id = correlation_id or str(uuid.uuid4())
    case = db.get(Case, case_id)
    if case is None:
        raise LookupError(f"case {case_id} not found")

    owns_client = client is None
    if client is None:
        from app.config import settings  # BE-owned; imported lazily to keep tests light

        client = MockClient(settings.MOCK_BASE_URL)

    try:
        ctx = _load_context(db, case, client, correlation_id)
        case.status = "PROCESSING"
        try:
            for name, step in _STEPS:
                _run_step(ctx, name, step)
        except deps.ConsentRevokedError:
            _halt_for_consent(ctx)
            return None
        except ExternalServiceUnavailable:
            _halt_for_external(ctx)
            raise
        db.commit()
        return ctx.decision
    finally:
        if owns_client and client is not None:
            client.close()


def _halt_for_consent(ctx: _Context) -> None:
    """Consent withdrawn mid-flight: pause, never decide (docs/04 §3.3)."""
    ctx.case.previous_status = ctx.case.status
    ctx.case.status = "ON_HOLD_CONSENT"
    deps.audit(
        ctx.db,
        action="case.status_changed",
        resource_type="case",
        resource_id=ctx.case.id,
        tenant_id=ctx.case.tenant_id,
        payload={
            "to": "ON_HOLD_CONSENT",
            "reason": "CONSENT_REVOKED",
            "correlation_id": ctx.correlation_id,
        },
    )
    ctx.db.commit()


def _halt_for_external(ctx: _Context) -> None:
    """A mock service is down: park the case, record no decision."""
    ctx.case.status = "WAITING_EXTERNAL"
    deps.audit(
        ctx.db,
        action="case.status_changed",
        resource_type="case",
        resource_id=ctx.case.id,
        tenant_id=ctx.case.tenant_id,
        payload={
            "to": "WAITING_EXTERNAL",
            "reason": "EXTERNAL_SERVICE_UNAVAILABLE",
            "correlation_id": ctx.correlation_id,
        },
    )
    ctx.db.commit()


# -- officer re-evaluation -----------------------------------------------
class ReevaluationNotAllowed(RuntimeError):
    """The case is not in a state an officer may re-evaluate.

    The route layer maps this to ``409 INVALID_TRANSITION`` (docs/05 §2).
    """

    code = "INVALID_TRANSITION"


#: Statuses an officer may re-evaluate. Consent holds and closed cases are excluded.
_REEVALUABLE_STATUSES = (
    "NEEDS_INFO",
    "HUMAN_REVIEW",
    "IN_REVIEW",
    "PENDING_SECOND_APPROVAL",
    "WAITING_EXTERNAL",
    "APPROVED",
    "PAYMENT_INITIATED",
    "PAYMENT_FAILED",
    "REJECTED",
)


def _latest_decision(db: Session, case_id: Any) -> Any:
    return (
        db.execute(
            select(Decision)
            .where(Decision.case_id == case_id)
            .order_by(Decision.created_at.desc())
        )
        .scalars()
        .first()
    )


def reevaluate_case(
    db: Session,
    case_id: Any,
    *,
    officer_user_id: Any,
    reason: str | None = None,
    correlation_id: str | None = None,
    client: MockClient | None = None,
) -> dict[str, Any]:
    """Officer ``/reevaluate``: re-run the pipeline against the CURRENT active rules.

    The earlier decision is append-only and stays exactly as it was, including the rule
    version and content hash it was made under. A new decision is recorded only when the
    facts or the rules actually changed (AC-05.3); otherwise the existing decision is
    returned and the timeline records that nothing moved.

    The officer's request is committed before the pipeline runs, so the timeline entry
    survives even if a mock service is down and the case parks in ``WAITING_EXTERNAL``.
    """
    correlation_id = correlation_id or str(uuid.uuid4())
    case = db.get(Case, case_id)
    if case is None:
        raise LookupError(f"case {case_id} not found")
    if case.status not in _REEVALUABLE_STATUSES:
        raise ReevaluationNotAllowed(
            f"case {case.reference_code} is {case.status}; re-evaluation is allowed "
            f"from {', '.join(_REEVALUABLE_STATUSES)}"
        )

    program = db.get(Program, case.program_id)
    if program is None:
        raise LookupError(f"program {case.program_id} not found for case {case.id}")
    active = (
        db.get(RuleVersion, program.active_rule_version_id)
        if program.active_rule_version_id
        else None
    )
    if active is None:
        raise LookupError(f"program {program.code} has no active rule version")

    previous = _latest_decision(db, case.id)
    previous_version_id = getattr(previous, "rule_version_id", None)
    previous_version = (
        db.get(RuleVersion, previous_version_id) if previous_version_id else None
    )
    version_changed = previous_version_id != active.id
    previous_number = getattr(previous_version, "version_number", None)

    if version_changed and previous_number is not None:
        change = f"v{previous_number} → v{active.version_number}"
    else:
        change = f"v{active.version_number} (unchanged)"

    db.add(
        CaseNote(
            tenant_id=case.tenant_id,
            case_id=case.id,
            author_user_id=officer_user_id,
            note_type="OFFICER_NOTE",
            body=(
                f"Re-evaluation requested against rule version {change}"
                + (f" — {reason}" if reason else "")
            ),
            metadata_json={
                "action": "REEVALUATE",
                "rule_version_changed": version_changed,
                "previous_rule_version_id": (
                    str(previous_version_id) if previous_version_id else None
                ),
                "previous_rule_version_number": previous_number,
                "active_rule_version_id": str(active.id),
                "active_rule_version_number": active.version_number,
                "previous_decision_id": str(previous.id) if previous is not None else None,
                "reason": reason,
                "correlation_id": correlation_id,
            },
            is_visible_to_citizen=False,
        )
    )
    deps.audit(
        db,
        action="case.reevaluated",
        resource_type="case",
        resource_id=case.id,
        tenant_id=case.tenant_id,
        actor_user_id=officer_user_id,
        payload={
            "rule_version_changed": version_changed,
            "previous_rule_version_id": (
                str(previous_version_id) if previous_version_id else None
            ),
            "active_rule_version_id": str(active.id),
            "previous_decision_id": str(previous.id) if previous is not None else None,
            "correlation_id": correlation_id,
        },
    )
    db.commit()

    decision = run_case_agent(db, case.id, correlation_id=correlation_id, client=client)
    recorded = decision is not None and (
        previous is None or decision.id != previous.id
    )

    return {
        "case_id": str(case.id),
        "reference_code": case.reference_code,
        "status": case.status,
        "rule_version_id": str(active.id),
        "rule_version_number": active.version_number,
        "rule_version_changed": version_changed,
        "previous_decision_id": str(previous.id) if previous is not None else None,
        "decision_id": str(decision.id) if decision is not None else None,
        "decision_recorded": recorded,
        "correlation_id": correlation_id,
    }


# -- complaint agent -----------------------------------------------------
def check_complaint_agent(
    db: Session,
    case_id: Any,
    *,
    correlation_id: str | None = None,
    client: MockClient | None = None,
) -> dict[str, Any]:
    """``CHECK_COMPLAINT`` handler: chase a failed payment and file the complaint."""
    correlation_id = correlation_id or str(uuid.uuid4())
    case = db.get(Case, case_id)
    if case is None:
        raise LookupError(f"case {case_id} not found")

    owns_client = client is None
    if client is None:
        from app.config import settings

        client = MockClient(settings.MOCK_BASE_URL)

    try:
        application = (
            db.get(Case, case.parent_case_id) if case.parent_case_id else None
        )
        if application is None:
            raise LookupError(f"complaint {case.id} has no parent application")

        payment = (
            db.execute(select(Payment).where(Payment.case_id == application.id))
            .scalars()
            .first()
        )
        if payment is None:
            raise LookupError(f"application {application.id} has no payment")

        payment_payload = client.get(
            "payment", f"/mock/v1/payments/{payment.external_ref or payment.id}"
        )
        status = str(payment_payload.get("status", "")).upper()
        payment.status = status or payment.status
        payment.failure_reason = payment_payload.get("failure_reason")

        complaint_ref: str | None = None
        if status == "FAILED":
            citizen = db.get(Citizen, case.citizen_id)
            filed = client.post(
                "complaint",
                "/mock/v1/complaints",
                json={
                    "payment_ref": str(payment.external_ref or payment.id),
                    "citizen_cnic": getattr(citizen, "cnic_digits", None),
                    "reason": "PAYMENT_FAILED",
                },
            )
            complaint_ref = filed.get("complaint_ref")

        case.status = "CLOSED"
        case.decided_at = datetime.now(UTC)
        deps.audit(
            db,
            action="case.status_changed",
            resource_type="case",
            resource_id=case.id,
            tenant_id=case.tenant_id,
            payload={
                "to": "CLOSED",
                "payment_status": status,
                "complaint_ref": complaint_ref,
                "correlation_id": correlation_id,
            },
        )
        db.commit()
        return {
            "case_id": str(case.id),
            "payment_status": status,
            "complaint_ref": complaint_ref,
            "correlation_id": correlation_id,
        }
    finally:
        if owns_client and client is not None:
            client.close()
