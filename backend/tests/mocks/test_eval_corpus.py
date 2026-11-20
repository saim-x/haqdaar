"""The labelled corpus behind the Challenge 01 cost curve.

``backend/app/data/eval_cases.jsonl`` is the honesty engine of the demo: the
Evaluation Dashboard's ``decision_router_sweep`` is only as meaningful as the labels
behind it. These tests pin the properties the dashboard depends on:

* every case carries the four-pillar evidence of docs/06 §3.2, so EN's adapter never
  has to invent a number (a missing ``identity_confidence`` floors a case at 0.25 and
  a missing ``documents`` list floors it at 0.55 — either one makes the whole curve
  flat);
* the evidence is consistent with the story (name bands, document statuses, consent
  method);
* the corpus contains a population that *looks* clean and is not, so the cost curve
  has a knee instead of a cliff;
* at tau = 0.90 the sweep auto-approves 55-65 % of the sample with a false-approval
  rate at or below 1 %, and the expected cost bottoms out there (docs/06 §3.3).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.engine.anomalies import RiskFlag
from app.engine.confidence import DocumentEvidence
from app.engine.entity_resolution import name_sim
from app.engine.eval_sweep import LabelledCase, load_labelled_cases, sweep
from app.engine.evaluator import RuleResult, evaluate_ruleset
from app.engine.rules_dsl import RuleSetSchema
from app.mocks import gen_datasets as gen
from app.mocks import seed_data as sd

CORPUS_PATH = Path(__file__).resolve().parents[2] / "app" / "data" / "eval_cases.jsonl"

#: docs/06 §3.3: "auto-approving ~55-65 % of clean applications in seconds".
AUTO_APPROVE_RATE_BAND = (0.55, 0.65)
#: docs/06 §3.3: "false approval rate <= 1 %".
MAX_FALSE_APPROVAL_RATE = 0.01
#: docs/06 §3.3: the default Sahara v1 threshold, which the curve must justify.
ACTIVE_THRESHOLD = 0.90


@pytest.fixture(scope="module")
def rows() -> list[dict[str, Any]]:
    return [
        json.loads(line)
        for line in CORPUS_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


@pytest.fixture(scope="module")
def sahara() -> RuleSetSchema:
    return RuleSetSchema.model_validate(sd.SAHARA_RULES_V1)


@pytest.fixture(scope="module")
def cases() -> list[LabelledCase]:
    return load_labelled_cases(CORPUS_PATH)


# -- evidence completeness -------------------------------------------------
def test_every_case_carries_the_four_pillar_evidence(rows) -> None:
    """A missing pillar input silently floors the case and flattens the curve."""
    for row in rows:
        assert "identity_confidence" in row, row["case_id"]
        assert 0.0 <= row["identity_confidence"] <= 1.0, row["case_id"]
        assert row["documents"], row["case_id"]
        assert row["consent_method"] in {"SELF_OTP", "CITIZEN_OTP", "VERBAL_WITNESSED"}
        assert row["consent_assurance"] in {0.82, 1.0}, row["case_id"]
        # The two fields must agree: the pillar is derived from the method.
        expected = 1.0 if row["consent_method"] != "VERBAL_WITNESSED" else 0.82
        assert row["consent_assurance"] == expected, row["case_id"]


def test_documents_validate_against_the_engine_model(rows) -> None:
    for row in rows:
        for doc in row["documents"]:
            DocumentEvidence.model_validate(doc)


def test_flags_validate_against_the_risk_flag_model(rows) -> None:
    """Severity is fixed per code; a wrong pair must fail here, not in the sweep."""
    for row in rows:
        for flag in row["flags"]:
            RiskFlag.model_validate(flag)


def test_every_case_has_all_twenty_canonical_fact_keys(rows) -> None:
    from app.engine.facts import FACT_REGISTRY

    for row in rows:
        assert set(row["facts"]) == set(FACT_REGISTRY), row["case_id"]


def test_every_cnic_uses_the_reserved_synthetic_prefix(rows) -> None:
    for row in rows:
        for key in ("applicant_cnic", "spouse_cnic"):
            value = row["facts"][key]["value"]
            if value is None:
                continue
            assert value.startswith("99900"), (row["case_id"], key, value)
            assert len(value) == 13, (row["case_id"], key, value)


# -- evidence consistency --------------------------------------------------
def test_spelling_drift_names_sit_in_the_variant_band() -> None:
    """docs/06 §3.2: name similarity >= 0.85 scores identity 0.93."""
    for registry_name, variants in gen.NAME_DRIFTS.items():
        for variant in variants:
            assert name_sim(registry_name, variant) >= 0.85, (registry_name, variant)


def test_soft_identity_names_sit_in_the_soft_match_band() -> None:
    """docs/06 §3.2: name similarity 0.55-0.69 scores identity 0.75."""
    for registry_name, declared in gen.SOFT_NAME_PAIRS:
        similarity = name_sim(registry_name, declared)
        assert 0.55 <= similarity < 0.70, (registry_name, declared, similarity)


def test_identity_confidence_matches_the_cohort_story(rows) -> None:
    for row in rows:
        if "SPELLING_DRIFT" in row["noise"]:
            assert row["identity_confidence"] == 0.93, row["case_id"]
        elif "SOFT_IDENTITY_MATCH" in row["noise"]:
            assert row["identity_confidence"] == 0.75, row["case_id"]
        elif "REGISTRY_MISS" in row["noise"]:
            assert row["identity_confidence"] == 0.25, row["case_id"]
        else:
            assert row["identity_confidence"] == 0.98, row["case_id"]


def test_document_status_matches_the_noise_profile(rows) -> None:
    for row in rows:
        statuses = {doc["status"] for doc in row["documents"]}
        if "FORGED_DOC" in row["noise"]:
            assert "TAMPER_SUSPECTED" in statuses, row["case_id"]
        elif "LOW_QUALITY_DOC" in row["noise"]:
            assert "NEEDS_RETAKE" in statuses, row["case_id"]
        elif "REGISTRY_MISS" in row["noise"]:
            assert "UNVERIFIABLE" in statuses, row["case_id"]
        else:
            assert statuses == {"VERIFIED"}, row["case_id"]


def test_compressed_documents_still_verify(rows) -> None:
    """AC-04.4: a WhatsApp-compressed genuine card is VERIFIED, never tampered."""
    compressed = [row for row in rows if "COMPRESSED_DOC" in row["noise"]]
    assert compressed
    for row in compressed:
        cnic = next(d for d in row["documents"] if d["doc_type"] == "CNIC_FRONT")
        assert cnic["status"] == "VERIFIED", row["case_id"]
        assert cnic["verify_confidence"] == 0.85, row["case_id"]


# -- the population that makes the curve bend ------------------------------
def test_clean_looking_ineligible_population_exists(rows) -> None:
    """~10-15 cases that pass every rule and are still ineligible.

    Without them every ``truly_eligible: false`` case fails a hard rule, the router
    sends it to a human at *every* threshold, and ``false_approval_rate`` is
    structurally zero — the cost curve cannot show a knee.
    """
    hidden = [
        row
        for row in rows
        if row.get("ground_truth_reason") and row["truly_eligible"] is False
    ]
    assert 10 <= len(hidden) <= 20, len(hidden)
    for row in hidden:
        assert row["expected_amount_pkr"] is None, row["case_id"]


def test_hidden_cases_pass_every_rule_on_the_observable_facts(rows, sahara) -> None:
    """The whole point: the rules cannot see why these are ineligible."""
    hidden = [row for row in rows if row.get("ground_truth_reason")]
    assert hidden
    for row in hidden:
        case = LabelledCase.from_record(row)
        evaluation = evaluate_ruleset(sahara, case.facts)
        failed = [trace.rule_id for trace in evaluation.rules if trace.result is not RuleResult.PASS]
        assert not failed, (row["case_id"], failed)


def test_hidden_cases_are_caught_by_the_active_threshold(cases) -> None:
    """At tau = 0.90 every hidden case must fall below the line."""
    hidden = [case for case in cases if case.confidence.overall < ACTIVE_THRESHOLD]
    assert hidden
    for case in cases:
        if case.truly_eligible:
            continue
        assert case.confidence.overall < ACTIVE_THRESHOLD, case.case_id


def test_visible_truth_cohorts_agree_with_the_rules_visible_predicate(rows) -> None:
    """Only a HIDDEN_* cohort may carry a truth the rules cannot see."""
    for row in rows:
        if row.get("ground_truth_reason"):
            continue
        assert gen._is_eligible(row["facts"]) is row["truly_eligible"], row["case_id"]


# -- the documented target shape -------------------------------------------
def test_sweep_hits_the_documented_target_shape(cases, sahara) -> None:
    """docs/06 §3.3, the number the dashboard has to show."""
    result = sweep(cases, sahara)
    point = result.point_at(ACTIVE_THRESHOLD)
    assert point is not None

    low, high = AUTO_APPROVE_RATE_BAND
    assert low <= point.auto_approve_rate <= high, point.auto_approve_rate
    assert point.false_approval_rate <= MAX_FALSE_APPROVAL_RATE, point.false_approval_rate
    assert result.knee_threshold == ACTIVE_THRESHOLD, result.knee_threshold
    assert result.active_threshold == ACTIVE_THRESHOLD


def test_expected_cost_bottoms_out_at_the_active_threshold(cases, sahara) -> None:
    result = sweep(cases, sahara)
    costs = {point.threshold: point.expected_cost for point in result.points}
    assert min(costs, key=costs.__getitem__) == ACTIVE_THRESHOLD, costs


def test_cost_curve_falls_then_rises(cases, sahara) -> None:
    """A curve that only rises (or only falls) has no knee to justify."""
    result = sweep(cases, sahara)
    ordered = sorted(result.points, key=lambda point: point.threshold)
    costs = [point.expected_cost for point in ordered]
    knee = costs.index(min(costs))
    assert knee > 0, costs
    assert knee < len(costs) - 1, costs
    assert costs[: knee + 1] == sorted(costs[: knee + 1]), costs
    assert costs[knee:] == sorted(costs[knee:]), costs


def test_false_approvals_exist_below_the_threshold(cases, sahara) -> None:
    """If nothing is ever wrongly approved, the cost curve proves nothing."""
    result = sweep(cases, sahara)
    low = result.point_at(0.50)
    assert low is not None
    assert low.false_approval_count > 0, low.false_approval_count


# -- determinism -----------------------------------------------------------
def test_generator_is_deterministic() -> None:
    assert gen.build_eval_cases() == gen.build_eval_cases()


def test_committed_corpus_matches_the_generator(rows) -> None:
    """A hand-edited corpus would drift from the cohort table; this catches it."""
    assert gen.build_eval_cases() == rows
