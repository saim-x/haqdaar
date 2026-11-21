"""Cost-of-being-wrong threshold sweep (Challenge 01, docs/06 §3.3, docs/07 §8)."""

from __future__ import annotations

import copy
import json

import pytest
from app.engine.confidence import ConfidenceComponents
from app.engine.eval_sweep import (
    DEFAULT_THRESHOLDS,
    LabelledCase,
    SweepPoint,
    dashboard_payload,
    find_knee,
    load_labelled_cases,
    sweep,
)
from app.engine.facts import FactBundle, FactState
from app.engine.rules_dsl import RuleSetSchema

#: 18 cases. Every case passes every rule, so the route depends only on confidence.
#: ``truly_eligible`` is ground truth the engine cannot see - that is the whole point.
ELIGIBLE_CONFIDENCES = (0.99, 0.97, 0.95, 0.93, 0.91, 0.90, 0.88, 0.85, 0.80, 0.75, 0.70, 0.60)
INELIGIBLE_CONFIDENCES = (0.89, 0.86, 0.82, 0.78, 0.72, 0.65)


def _confidence(value: float) -> ConfidenceComponents:
    return ConfidenceComponents(
        identity=value,
        documents=value,
        data_consistency=value,
        consent_assurance=value,
        overall=value,
    )


def _labelled(
    case_id: str, facts: FactBundle, confidence: float, *, eligible: bool
) -> LabelledCase:
    return LabelledCase(
        case_id=case_id,
        facts=facts,
        truly_eligible=eligible,
        confidence=_confidence(confidence),
    )


@pytest.fixture()
def labelled_cases(fatima_facts: FactBundle) -> list[LabelledCase]:
    cases = [
        _labelled(f"E{index}", fatima_facts, value, eligible=True)
        for index, value in enumerate(ELIGIBLE_CONFIDENCES)
    ]
    cases += [
        _labelled(f"I{index}", fatima_facts, value, eligible=False)
        for index, value in enumerate(INELIGIBLE_CONFIDENCES)
    ]
    return cases


def test_default_grid_matches_the_spec() -> None:
    assert DEFAULT_THRESHOLDS == (0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95)


def test_sweep_emits_one_point_per_threshold(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    result = sweep(labelled_cases, sahara_v1)
    assert len(result.points) == len(DEFAULT_THRESHOLDS)
    assert result.sample_size == 18
    assert [point.threshold for point in result.points] == list(DEFAULT_THRESHOLDS)


def test_sweep_finds_the_090_knee(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    result = sweep(labelled_cases, sahara_v1)
    assert result.knee_threshold == 0.90
    costs = {point.threshold: point.expected_cost for point in result.points}
    assert costs[0.90] == 96.0
    assert costs[0.95] == 120.0
    assert costs[0.50] == 600.0
    assert min(costs.values()) == costs[0.90]
    assert sum(1 for cost in costs.values() if cost == costs[0.90]) == 1


def test_knee_point_metrics(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    point = sweep(labelled_cases, sahara_v1).point_at(0.90)
    assert point is not None
    assert point.auto_approved_count == 6
    assert point.false_approval_count == 0
    assert point.human_review_count == 12
    assert point.ask_more_count == 0
    assert point.auto_approve_rate == pytest.approx(6 / 18, abs=1e-4)
    assert point.false_approval_rate == 0.0
    assert point.human_review_rate == pytest.approx(12 / 18, abs=1e-4)
    assert point.expected_total_cost == point.expected_cost


def test_low_threshold_buys_wrong_approvals(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    point = sweep(labelled_cases, sahara_v1).point_at(0.50)
    assert point is not None
    assert point.auto_approved_count == 18
    assert point.false_approval_count == 6
    assert point.false_approval_rate == pytest.approx(6 / 18, abs=1e-4)
    assert point.human_review_count == 0
    assert point.expected_cost == 600.0


def test_raising_the_threshold_trades_recall_for_safety(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    result = sweep(labelled_cases, sahara_v1)
    auto_rates = [point.auto_approve_rate for point in result.points]
    assert auto_rates == sorted(auto_rates, reverse=True)
    assert result.point_at(0.95).false_approval_count == 0  # type: ignore[union-attr]


def test_active_threshold_defaults_to_the_ruleset_policy(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    assert sweep(labelled_cases, sahara_v1).active_threshold == 0.90


def test_active_threshold_can_be_overridden(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    result = sweep(labelled_cases, sahara_v1, active_threshold=0.95)
    assert result.active_threshold == 0.95
    assert result.knee_threshold == 0.90


def test_sweep_does_not_mutate_the_ruleset(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    before = copy.deepcopy(sahara_v1.model_dump())
    sweep(labelled_cases, sahara_v1)
    assert sahara_v1.model_dump() == before
    assert sahara_v1.policy.auto_approve_confidence_threshold == 0.90


def test_sweep_is_deterministic(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    first = sweep(labelled_cases, sahara_v1)
    second = sweep(labelled_cases, sahara_v1)
    assert first.model_dump() == second.model_dump()


def test_custom_threshold_grid(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    result = sweep(labelled_cases, sahara_v1, thresholds=(0.90,))
    assert len(result.points) == 1
    assert result.knee_threshold == 0.90


def test_empty_dataset_is_safe(sahara_v1: RuleSetSchema) -> None:
    result = sweep([], sahara_v1)
    assert result.sample_size == 0
    assert all(point.expected_cost == 0.0 for point in result.points)
    assert all(point.auto_approve_rate == 0.0 for point in result.points)


def test_find_knee_prefers_the_conservative_threshold_on_a_tie() -> None:
    points = [
        SweepPoint(
            threshold=0.80,
            auto_approved_count=1,
            false_approval_count=0,
            human_review_count=0,
            ask_more_count=0,
            auto_approve_rate=1.0,
            false_approval_rate=0.0,
            human_review_rate=0.0,
            expected_cost=50.0,
        ),
        SweepPoint(
            threshold=0.90,
            auto_approved_count=1,
            false_approval_count=0,
            human_review_count=0,
            ask_more_count=0,
            auto_approve_rate=1.0,
            false_approval_rate=0.0,
            human_review_rate=0.0,
            expected_cost=50.0,
        ),
    ]
    assert find_knee(points) == 0.90


def test_find_knee_on_empty_input() -> None:
    assert find_knee([]) == 0.0


def test_dashboard_payload_shape(
    labelled_cases: list[LabelledCase], sahara_v1: RuleSetSchema
) -> None:
    payload = dashboard_payload(sweep(labelled_cases, sahara_v1))
    assert set(payload) == {
        "decision_router_sweep",
        "active_threshold",
        "knee_threshold",
        "sample_size",
    }
    assert payload["active_threshold"] == 0.90
    assert payload["knee_threshold"] == 0.90
    assert payload["sample_size"] == 18
    assert len(payload["decision_router_sweep"]) == 10
    for point in payload["decision_router_sweep"]:
        assert set(point) == {
            "threshold",
            "auto_approve_rate",
            "false_approval_rate",
            "human_review_rate",
            "expected_cost",
        }
    json.dumps(payload)  # must be JSON-serialisable for the API


def test_labelled_case_from_record_with_plain_values() -> None:
    case = LabelledCase.from_record(
        {
            "case_id": "eval-001",
            "truly_eligible": True,
            "facts": {"monthly_income_pkr": 28000, "applicant_district": "Thatta"},
            "identity_confidence": 0.98,
        }
    )
    assert case.case_id == "eval-001"
    assert case.truly_eligible is True
    assert case.facts.facts["monthly_income_pkr"].state is FactState.KNOWN
    assert case.facts.facts["monthly_income_pkr"].value == 28000
    assert 0.0 <= case.confidence.overall <= 1.0


def test_labelled_case_from_record_ignores_unknown_fact_keys() -> None:
    case = LabelledCase.from_record(
        {
            "case_id": "eval-002",
            "truly_eligible": False,
            "facts": {"not_a_real_fact": 1, "applicant_district": "Thatta"},
            "identity_confidence": 0.5,
        }
    )
    assert "not_a_real_fact" not in case.facts.facts
    assert "applicant_district" in case.facts.facts


def test_labelled_case_from_record_accepts_full_fact_objects(
    fatima_facts: FactBundle,
) -> None:
    record = {
        "case_id": "eval-003",
        "truly_eligible": True,
        "facts": {
            key: fact.model_dump() for key, fact in fatima_facts.facts.items()
        },
        "confidence_components": _confidence(0.95).model_dump(),
    }
    case = LabelledCase.from_record(record)
    assert case.facts.snapshot_hash() == fatima_facts.snapshot_hash()
    assert case.confidence.overall == 0.95


def test_load_labelled_cases_reads_jsonl(
    tmp_path, fatima_facts: FactBundle, sahara_v1: RuleSetSchema
) -> None:
    path = tmp_path / "eval_cases.jsonl"
    records = [
        {
            "case_id": f"eval-{index}",
            "truly_eligible": index % 2 == 0,
            "facts": {"monthly_income_pkr": 28000, "applicant_district": "Thatta"},
            "confidence_components": _confidence(0.95).model_dump(),
        }
        for index in range(3)
    ]
    path.write_text(
        "\n".join(json.dumps(record) for record in records) + "\n\n", encoding="utf-8"
    )

    cases = load_labelled_cases(path)
    assert len(cases) == 3
    assert [case.case_id for case in cases] == ["eval-0", "eval-1", "eval-2"]
    assert sweep(cases, sahara_v1).sample_size == 3


# -- from_record: the three evidence fields the enriched set carries ----------
def _fact(value, source, confidence, *, entered_by="SYSTEM"):
    return {
        "state": "KNOWN",
        "value": value,
        "source": source,
        "source_confidence": confidence,
        "entered_by": entered_by,
        "alternatives": [],
        "conflict": False,
        "missing_reason": None,
    }


def _unknown_fact(reason="NOT_PROVIDED"):
    return {
        "state": "UNKNOWN",
        "value": None,
        "source": None,
        "source_confidence": 0.0,
        "entered_by": "SYSTEM",
        "alternatives": [],
        "conflict": False,
        "missing_reason": reason,
    }


def _enriched_record(**overrides):
    """A record shaped like ``backend/app/data/eval_cases.jsonl``."""
    record = {
        "case_id": "EVAL-0002",
        "program_code": "SAHARA_WIDOW_GRANT",
        "split": "train",
        "noise": [],
        "consent_assurance": 1.0,
        "truly_eligible": True,
        "children_unknown": False,
        "expected_amount_pkr": 15000,
        "facts": {
            "applicant_cnic": _fact("9990010000901", "DOCUMENT_QR", 0.97),
            "applicant_full_name": _fact("Sakina Bibi", "IDENTITY_REGISTRY", 0.93),
            "applicant_dob": _fact("1992-04-12", "IDENTITY_REGISTRY", 0.95),
            "cnic_doc_verified": _fact(True, "DOCUMENT_VERIFIER", 0.94),
            "death_cert_doc_verified": _fact(True, "DOCUMENT_VERIFIER", 0.93),
        },
    }
    record.update(overrides)
    return record


def test_from_record_uses_an_explicit_identity_confidence() -> None:
    case = LabelledCase.from_record(_enriched_record(identity_confidence=0.25))
    assert case.confidence.identity == 0.25


def test_from_record_derives_identity_from_the_registry_name_similarity() -> None:
    """docs/06 §3.2 pillar 1: similarity >= 0.85 is the exact-match band."""
    case = LabelledCase.from_record(_enriched_record())
    assert case.confidence.identity == 0.98


def test_from_record_spelling_drift_lands_in_the_variant_band() -> None:
    record = _enriched_record()
    record["facts"]["applicant_full_name"] = _fact(
        "Sakinaa Bibi", "IDENTITY_REGISTRY", 0.71
    )
    assert LabelledCase.from_record(record).confidence.identity == 0.93


def test_from_record_registry_miss_is_ambiguous_identity() -> None:
    record = _enriched_record(registry_not_found=True)
    for key in ("applicant_full_name", "applicant_dob"):
        record["facts"][key] = _unknown_fact()
    assert LabelledCase.from_record(record).confidence.identity == 0.25


def test_from_record_derives_documents_from_the_verified_facts() -> None:
    """docs/06 §3.2 pillar 2: min(verify_confidence) over the required documents."""
    case = LabelledCase.from_record(_enriched_record())
    assert case.confidence.documents == 0.93


def test_from_record_unverified_document_is_needs_retake() -> None:
    record = _enriched_record()
    record["facts"]["cnic_doc_verified"] = _fact(False, "DOCUMENT_VERIFIER", 0.94)
    assert LabelledCase.from_record(record).confidence.documents == 0.40


def test_from_record_uses_an_explicit_documents_list() -> None:
    record = _enriched_record(
        documents=[{"doc_type": "CNIC_FRONT", "status": "TAMPER_SUSPECTED"}]
    )
    assert LabelledCase.from_record(record).confidence.documents == 0.10


def test_from_record_uses_the_consent_assurance_score() -> None:
    """Verbal consent is 0.82 and caps the weakest-link overall below 0.90."""
    case = LabelledCase.from_record(_enriched_record(consent_assurance=0.82))
    assert case.confidence.consent_assurance == 0.82
    assert case.confidence.overall == 0.82


def test_from_record_falls_back_to_the_consent_method() -> None:
    record = _enriched_record()
    record.pop("consent_assurance")
    record["consent_method"] = "VERBAL_WITNESSED"
    assert LabelledCase.from_record(record).confidence.consent_assurance == 0.82


def test_from_record_without_consent_evidence_is_not_strong_consent() -> None:
    record = _enriched_record()
    record.pop("consent_assurance")
    assert LabelledCase.from_record(record).confidence.consent_assurance == 0.82


def test_the_shipped_eval_set_loads_and_sweeps() -> None:
    """The real ``backend/app/data/eval_cases.jsonl`` must satisfy the adapter."""
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "app" / "data" / "eval_cases.jsonl"
    if not path.exists():  # pragma: no cover - the file is DPI-owned
        pytest.skip("eval_cases.jsonl not present in this tree")

    cases = load_labelled_cases(path)
    assert len(cases) >= 100
    for case in cases:
        assert 0.0 <= case.confidence.overall <= 1.0
        # Every pillar must come from evidence, never from a silent default.
        # Identity and consent are discrete bands (docs/06 §3.2 pillars 1 and 4).
        assert case.confidence.identity in {0.25, 0.30, 0.75, 0.78, 0.93, 0.98}
        assert case.confidence.consent_assurance in {0.82, 1.0}
        # Documents is a measured score, not a band: a verified document contributes
        # its own confidence, "typically 0.92-0.98" (docs/06 §3.2 pillar 2) - that
        # range is descriptive, and a compressed-but-genuine card legitimately
        # measures lower. The three failure outcomes are the discrete values.
        documents = case.confidence.documents
        assert documents in {0.10, 0.40, 0.55} or 0.55 < documents <= 1.0, (
            f"{case.case_id}: documents pillar {documents} is neither a documented "
            "failure band nor a verified score above the unverifiable band"
        )
