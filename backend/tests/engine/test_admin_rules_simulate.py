"""Digital Twin API seam: a stored row must never turn a preview into a 500.

``POST /admin/rules/{id}/simulate`` (docs/05 §3.7) replays historical ``decisions``
rows. A row written by an older code path - a NULL ``input_snapshot_json``, a partial
``confidence_components`` - used to raise straight through the endpoint and surface as
``500 INTERNAL_ERROR``. The twin engine stays strict (it is a pure function and must
not silently drop inputs); the API layer is the only place that decides what to skip,
and it reports the skip in the audit payload.

These tests pin that split, plus the ``sample_size`` coercion.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException

from app.api.v1.admin_rules import (
    MAX_SAMPLE_SIZE,
    _replay_cases,
    _requested_sample_size,
)
from app.engine.twin import TwinCase

#: A minimal but complete ``decisions`` row (docs/04 §4.3) that replays cleanly.
GOOD_ROW: dict[str, Any] = {
    "case_id": "11111111-1111-5111-8111-111111111111",
    "reference_code": "HQ-2026-000001",
    "input_snapshot_json": {},
    "flags_json": [],
    "confidence_components": {
        "identity": 0.98,
        "documents": 0.96,
        "data_consistency": 0.98,
        "consent_assurance": 1.0,
        "overall": 0.96,
    },
    "ask_more_rounds": 0,
    "hours_waiting": 0.0,
}


def _row(**overrides: Any) -> dict[str, Any]:
    row = dict(GOOD_ROW)
    row.update(overrides)
    return row


# -- quarantine ----------------------------------------------------------
def test_a_well_formed_row_is_replayed() -> None:
    cases, skipped = _replay_cases([GOOD_ROW])

    assert skipped == []
    assert len(cases) == 1
    assert isinstance(cases[0], TwinCase)
    assert cases[0].case_id == GOOD_ROW["case_id"]
    assert cases[0].confidence.overall == pytest.approx(0.96)


@pytest.mark.parametrize(
    ("label", "row"),
    [
        ("null snapshot", _row(input_snapshot_json=None)),
        ("missing snapshot", {"case_id": "x", "confidence_components": GOOD_ROW["confidence_components"]}),
        ("null components", _row(confidence_components=None)),
        ("partial components", _row(confidence_components={"identity": 0.9})),
        ("snapshot not a mapping", _row(input_snapshot_json=["not", "a", "dict"])),
        ("unknown fact key", _row(input_snapshot_json={"not_a_fact": {"state": "KNOWN"}})),
    ],
)
def test_a_malformed_row_is_quarantined_not_raised(label: str, row: dict[str, Any]) -> None:
    cases, skipped = _replay_cases([row])

    assert cases == [], label
    assert skipped == [str(row.get("case_id") or "unknown")], label


def test_one_bad_row_does_not_lose_the_good_ones() -> None:
    rows = [
        _row(case_id="a"),
        _row(case_id="b", input_snapshot_json=None),
        _row(case_id="c"),
    ]

    cases, skipped = _replay_cases(rows)

    assert [case.case_id for case in cases] == ["a", "c"]
    assert skipped == ["b"]


def test_an_empty_history_is_not_an_error() -> None:
    assert _replay_cases([]) == ([], [])


# -- sample_size ---------------------------------------------------------
def test_sample_size_falls_back_to_the_query_default() -> None:
    assert _requested_sample_size(None, 200) == 200
    assert _requested_sample_size({}, 200) == 200
    assert _requested_sample_size({"sample_size": None}, 200) == 200


def test_sample_size_accepts_a_numeric_string() -> None:
    assert _requested_sample_size({"sample_size": "200"}, 200) == 200


def test_sample_size_is_clamped_to_the_documented_cap() -> None:
    assert _requested_sample_size({"sample_size": 0}, 200) == 1
    assert _requested_sample_size({"sample_size": -5}, 200) == 1
    assert _requested_sample_size({"sample_size": 10_000}, 200) == MAX_SAMPLE_SIZE


def test_a_non_numeric_sample_size_is_a_400_not_a_500() -> None:
    with pytest.raises(HTTPException) as excinfo:
        _requested_sample_size({"sample_size": "many"}, 200)

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail["error"]["code"] == "VALIDATION_ERROR"
    assert excinfo.value.detail["error"]["details"]["fields"] == ["sample_size"]
