"""Dry-run the seeder without a database.

The seeder is ~1,500 lines of row construction. This harness executes the whole
``seed_all`` path against a recording fake session so that every dict, rule
trace and showcase flag is actually built at least once in CI — long before the
application schema exists. It asserts the counts and invariants the demo depends
on (docs/10 §2).
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from typing import Any

import pytest

from app.mocks import seed as seed_module
from app.mocks import seed_data as sd


class _InsertOp:
    def __init__(self, name: str) -> None:
        self.name = name


class _FakeTable:
    def __init__(self, name: str) -> None:
        self.name = name

    def insert(self) -> _InsertOp:
        return _InsertOp(self.name)


class _AutoTables(dict):
    """``metadata.tables`` stand-in that materialises any requested table."""

    def get(self, name: str, default: Any = None) -> Any:  # type: ignore[override]
        if name not in self:
            self[name] = _FakeTable(name)
        return self[name]


class _FakeMetadata:
    def __init__(self) -> None:
        self.tables: _AutoTables = _AutoTables()


def _stub_audit_writer(monkeypatch: pytest.MonkeyPatch, stub: Any) -> None:
    """Replace the seeder's audit writer everywhere it is bound.

    ``seed_showcase`` does ``from app.mocks.seed import _record_audit`` at import
    time, so patching ``seed_module._record_audit`` alone leaves that reference
    pointing at the real writer — which then runs a ``select(table.c.seq, ...)``
    against the fake metadata and dies on the missing ``.c``. Patch every module
    that holds its own binding.
    """
    from app.mocks import seed_showcase

    monkeypatch.setattr(seed_module, "_record_audit", stub)
    monkeypatch.setattr(seed_showcase, "_record_audit", stub)


class _FakeSession:
    def __init__(self) -> None:
        self.inserted: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self.orm_rows: list[Any] = []
        self.commits = 0

    def execute(self, statement: Any, rows: Any = None) -> Any:
        if isinstance(statement, _InsertOp) and rows is not None:
            self.inserted[statement.name].extend(rows)
        return None

    def add_all(self, rows: Any) -> None:
        self.orm_rows.extend(rows)

    def merge(self, row: Any) -> Any:
        self.orm_rows.append(row)
        return row

    def flush(self) -> None:
        return None

    def commit(self) -> None:
        self.commits += 1


@pytest.fixture()
def seeded(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> tuple[dict[str, Any], _FakeSession]:
    metadata = _FakeMetadata()
    session = _FakeSession()
    audits: list[dict[str, Any]] = []

    monkeypatch.setattr(seed_module, "_metadata", lambda: metadata)
    _stub_audit_writer(monkeypatch, lambda db, meta, **kwargs: audits.append(kwargs))
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))

    summary = seed_module.seed_all(session, reset=False, with_rag=False)
    summary["_audits"] = audits
    return summary, session


def test_seed_builds_the_whole_world(seeded: tuple[dict[str, Any], _FakeSession]) -> None:
    summary, session = seeded

    assert summary["tenants"] == 2
    assert summary["users"] == len(sd.PERSONAS) == 9
    assert summary["programs"] == 2
    assert summary["historical_cases"] == 70
    assert summary["showcase_cases"] == 6
    assert summary["demo_documents"] == 7
    assert summary["elapsed_ms"] > 0
    assert session.commits == 1


def test_seed_writes_every_expected_table(seeded: tuple[dict[str, Any], _FakeSession]) -> None:
    _, session = seeded
    for name in (
        "tenants",
        "users",
        "citizens",
        "programs",
        "rule_versions",
        "consent_grants",
        "cases",
        "decisions",
        "case_notes",
        "payments",
        "notifications",
    ):
        assert session.inserted[name], f"no rows inserted into {name}"


def test_showcase_cases_match_the_frozen_spec(seeded: tuple[dict[str, Any], _FakeSession]) -> None:
    _, session = seeded
    showcase = {
        row["reference_code"]: row
        for row in session.inserted["cases"]
        if row["reference_code"].startswith("HQ-2026-0001")
    }
    assert sorted(showcase) == [f"HQ-2026-0001{n:02d}" for n in range(1, 7)]

    expected = {
        "HQ-2026-000101": ("HUMAN_REVIEW", 90, "URGENT", "TAMPER_SUSPECTED", 0.10),
        "HQ-2026-000102": ("HUMAN_REVIEW", 60, "HIGH", "DATA_CONFLICT_INCOME", 0.72),
        "HQ-2026-000103": ("HUMAN_REVIEW", 65, "HIGH", "POSSIBLE_DUPLICATE_IDENTITY", 0.25),
        "HQ-2026-000104": ("HUMAN_REVIEW", 65, "HIGH", "PAYOUT_ACCOUNT_SHARED", 0.20),
        "HQ-2026-000105": ("HUMAN_REVIEW", 45, "NORMAL", "LOW_ASSURANCE_CONSENT", 0.82),
        "HQ-2026-000106": ("PAYMENT_FAILED", 65, "HIGH", "PAYMENT_FAILED", 0.93),
    }
    for reference, (status, score, band, flag, confidence) in expected.items():
        row = showcase[reference]
        assert row["status"] == status, reference
        assert row["priority_score"] == score, reference
        assert row["priority_band"] == band, reference
        assert row["latest_confidence"] == pytest.approx(confidence), reference
        assert [f["code"] for f in row["flags_json"]] == [flag], reference


def test_every_cnic_uses_the_fictional_prefix(seeded: tuple[dict[str, Any], _FakeSession]) -> None:
    _, session = seeded
    seen = 0
    for row in session.inserted["citizens"]:
        value = row["cnic_digits"]
        if value is None:
            continue
        seen += 1
        assert len(value) == 13, value
        assert value.startswith("99900"), value
    assert seen >= 15


def test_historical_cases_span_the_digital_twin_band(
    seeded: tuple[dict[str, Any], _FakeSession],
) -> None:
    _, session = seeded
    spd = [
        row
        for row in session.inserted["decisions"]
        if row["id"] != sd.uid("decision:showcase_101")
    ]
    incomes = [
        row["input_snapshot_json"]["monthly_income_pkr"]["value"]
        for row in spd
        if row["input_snapshot_json"].get("monthly_income_pkr", {}).get("state") == "KNOWN"
    ]
    band = [value for value in incomes if 35_001 <= value <= 40_000]
    assert 8 <= len(band) <= 12, band


def test_decision_snapshots_are_hash_stable(seeded: tuple[dict[str, Any], _FakeSession]) -> None:
    _, session = seeded
    for row in session.inserted["decisions"]:
        snapshot = row["input_snapshot_json"]
        assert row["input_snapshot_hash"] == sd.sha256_text(sd.canonical_json(snapshot))
        assert row["rule_trace_json"], row["id"]
        assert 0.0 <= row["confidence_overall"] <= 1.0


def test_audit_events_are_written_for_decisions(
    seeded: tuple[dict[str, Any], _FakeSession],
) -> None:
    summary, _ = seeded
    actions = {event["action"] for event in summary["_audits"]}
    assert "decision.recorded" in actions
    assert len(summary["_audits"]) >= 70


def test_seed_is_deterministic(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    def run() -> dict[str, str]:
        metadata = _FakeMetadata()
        session = _FakeSession()
        monkeypatch.setattr(seed_module, "_metadata", lambda: metadata)
        _stub_audit_writer(monkeypatch, lambda *a, **k: None)
        monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
        seed_module.seed_all(session, reset=False, with_rag=False)
        return {
            row["reference_code"]: str(row["id"]) for row in session.inserted["cases"]
        }

    assert run() == run()


def test_showcase_ids_are_uuid5(seeded: tuple[dict[str, Any], _FakeSession]) -> None:
    _, session = seeded
    for row in session.inserted["cases"]:
        assert isinstance(row["id"], uuid.UUID)


# --------------------------------------------------------------------------- #
# ADR-015: R09_CHILDREN_KNOWN — no auto-approval with a provisional amount
# --------------------------------------------------------------------------- #
def test_both_programs_carry_the_children_known_rule() -> None:
    for ruleset in (sd.SAHARA_RULES_V1, sd.GUZARA_RULES_V1):
        ids = [rule["id"] for rule in ruleset["eligibility_rules"]]
        assert "R09_CHILDREN_KNOWN" in ids, ids
        rule = next(r for r in ruleset["eligibility_rules"] if r["id"] == "R09_CHILDREN_KNOWN")
        assert rule["fact"] == "children_under_18"
        assert rule["op"] == "gte"
        assert rule["value"] == 0
        assert rule["on_fail"] == "HUMAN"
        assert rule["on_unknown"] == "ASK"
        assert rule["required_for_auto"] is True
        assert rule["label_en"] and rule["label_ur"]
        assert rule["ask_prompt_en"] and rule["ask_prompt_ur"]


def test_seeded_rulesets_validate_against_the_engine_dsl() -> None:
    from app.engine.rules_dsl import validate_rules_json

    for ruleset in (sd.SAHARA_RULES_V1, sd.GUZARA_RULES_V1):
        report = validate_rules_json(ruleset)
        assert report.valid, report.errors


def test_unknown_children_never_auto_approves() -> None:
    """The whole point of ADR-015: UNKNOWN children routes ASK_MORE, then HUMAN."""
    from app.engine.confidence import DocumentEvidence, DocumentStatus
    from app.engine.facts import FactBundle
    from app.engine.pipeline import evaluate_and_route
    from app.engine.rules_dsl import RuleSetSchema

    def bundle(children: int | None) -> FactBundle:
        facts = sd.build_facts(
            cnic_value=sd.cnic(1),
            full_name="Fatima Bibi",
            dob="1988-04-12",
            district="Thatta",
            income=28000,
            children=children if children is not None else 0,
            household_size=5,
            poverty_score=22,
            payout_phone="+923001234567",
            spouse_name="Ghulam Rasool",
            spouse_cnic=sd.cnic(2),
            cnic_doc_verified=True,
            death_cert_verified=True,
        )
        if children is None:
            facts["children_under_18"] = sd.unknown()
        return FactBundle(facts=sd.public_facts(facts))

    docs = [
        DocumentEvidence(doc_type="CNIC_FRONT", status=DocumentStatus.VERIFIED, verify_confidence=0.97),
        DocumentEvidence(
            doc_type="SPOUSE_DEATH_CERTIFICATE",
            status=DocumentStatus.VERIFIED,
            verify_confidence=0.96,
        ),
    ]

    for ruleset in (sd.SAHARA_RULES_V1, sd.GUZARA_RULES_V1):
        schema = RuleSetSchema.model_validate(ruleset)
        first = evaluate_and_route(bundle(None), schema, identity_confidence=0.98, documents=docs)
        assert first.route.action.value == "ASK_MORE"
        assert first.evaluation.benefit.provisional is True

        exhausted = evaluate_and_route(
            bundle(None), schema, identity_confidence=0.98, documents=docs, ask_more_rounds=2
        )
        assert exhausted.route.action.value == "HUMAN_REVIEW"

        known = evaluate_and_route(bundle(2), schema, identity_confidence=0.98, documents=docs)
        assert known.route.action.value == "AUTO_APPROVE"
        assert known.evaluation.benefit.provisional is False


def test_eval_cases_include_unknown_children_with_honest_labels() -> None:
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "app" / "data" / "eval_cases.jsonl"
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]

    unknown = [row for row in rows if row.get("children_unknown")]
    assert len(unknown) >= 5, len(unknown)
    # Ground-truth eligibility is unchanged by an unknown count, but no amount is
    # asserted for those cases because the amount genuinely depends on the count.
    assert any(row["truly_eligible"] for row in unknown)
    assert all(row["expected_amount_pkr"] is None for row in unknown)
    assert all(row["facts"]["children_under_18"]["state"] == "UNKNOWN" for row in unknown)


def test_eval_cases_include_a_registry_miss_slice() -> None:
    """docs/06 §5.2 Case A "Not found" must occur in the corpus as evidence.

    The registry holding no record is recorded as UNKNOWN identity facts, never as
    a guessed name or a fabricated "alive", so EN derives CNIC_NOT_IN_REGISTRY
    from the absence. The label stays honest: eligibility is not established.
    """
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "app" / "data" / "eval_cases.jsonl"
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]

    miss = [row for row in rows if row.get("registry_not_found")]
    assert 3 <= len(miss) <= 6, len(miss)
    for row in miss:
        assert row["identity_confidence"] == 0.25
        assert row["truly_eligible"] is False
        assert row["expected_amount_pkr"] is None
        for key in (
            "applicant_full_name",
            "applicant_dob",
            "applicant_age_years",
            "applicant_is_alive",
        ):
            fact = row["facts"][key]
            assert fact["state"] == "UNKNOWN", key
            assert fact["value"] is None, key
            assert fact["source"] is None, key
            # NOT_PROVIDED, not USER_UNKNOWN: the citizen did supply the CNIC.
            assert fact["missing_reason"] == "NOT_PROVIDED", key
            assert fact["entered_by"] == "SYSTEM", key

    # The slice must not swallow the rest of the corpus.
    assert len(rows) == 120
    assert sum(1 for row in rows if row["truly_eligible"]) >= 40
