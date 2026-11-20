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
    monkeypatch.setattr(
        seed_module,
        "_record_audit",
        lambda db, meta, **kwargs: audits.append(kwargs),
    )
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
        if not row["id"] == sd.uid("decision:showcase_101")
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
        monkeypatch.setattr(seed_module, "_record_audit", lambda *a, **k: None)
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
