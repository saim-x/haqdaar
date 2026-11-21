"""``GET /metrics`` — the scrape endpoint a dashboard reads.

``/health`` answers "can this instance serve?" for a load balancer. ``/metrics``
answers "what is this instance doing?" for a dashboard. These tests hold the
second contract: the exposition must parse, the series must be derived from the
database rather than invented, and a broken query must degrade the endpoint
instead of taking it down.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

#: ``name{label="value"} 1.0`` — the Prometheus text exposition grammar.
_SAMPLE = re.compile(r"^(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)(?:\{(?P<labels>[^}]*)\})? (?P<value>\S+)$")


def _parse(body: str) -> dict[str, list[tuple[dict[str, str], float]]]:
    """Parse the exposition into ``{metric: [(labels, value)]}``.

    Parsing rather than substring-matching is the point: a malformed line is a
    broken scrape, and ``"haqdaar_up" in body`` would pass on a line no scraper
    can read.
    """
    series: dict[str, list[tuple[dict[str, str], float]]] = {}
    for line in body.splitlines():
        if not line or line.startswith("#"):
            continue
        match = _SAMPLE.match(line)
        assert match, f"unparseable exposition line: {line!r}"
        labels: dict[str, str] = {}
        if match.group("labels"):
            for pair in match.group("labels").split(","):
                key, _, value = pair.partition("=")
                labels[key.strip()] = value.strip().strip('"')
        series.setdefault(match.group("name"), []).append((labels, float(match.group("value"))))
    return series


def test_metrics_is_prometheus_text(client: Any) -> None:
    response = client.get("/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "version=0.0.4" in response.headers["content-type"]


def test_every_line_parses_and_has_a_type(client: Any) -> None:
    body = client.get("/metrics").text
    series = _parse(body)
    assert series, "the exposition was empty"

    declared = {
        line.split()[2] for line in body.splitlines() if line.startswith("# TYPE ")
    }
    for name in series:
        assert name in declared, f"{name} has samples but no # TYPE line"


def test_liveness_and_dependency_gauges_are_present(client: Any) -> None:
    series = _parse(client.get("/metrics").text)
    for name in (
        "haqdaar_up",
        "haqdaar_database_up",
        "haqdaar_worker_up",
        "haqdaar_uploads_writable",
    ):
        assert name in series, f"{name} is missing"
        assert series[name][0][1] in {0.0, 1.0}, f"{name} must be 0 or 1"


def test_process_is_up_and_database_is_reachable(client: Any) -> None:
    series = _parse(client.get("/metrics").text)
    assert series["haqdaar_up"][0][1] == 1.0
    assert series["haqdaar_database_up"][0][1] == 1.0


def test_case_and_decision_counters_carry_tenant_and_status_labels(client: Any) -> None:
    series = _parse(client.get("/metrics").text)
    # The seeded world has cases and decisions, so both counters must be present
    # and labelled — an unlabelled total would be a number nobody can act on, and
    # an unlabelled total is also what makes /metrics disagree with the
    # tenant-scoped eval dashboard.
    assert "haqdaar_cases_total" in series
    assert "haqdaar_decisions_total" in series
    for labels, value in series["haqdaar_decisions_total"]:
        assert "route" in labels
        assert "tenant" in labels
        assert value >= 0
    for labels, value in series["haqdaar_cases_total"]:
        assert "status" in labels
        assert "tenant" in labels
        assert value >= 0


def test_decision_counter_sums_to_the_table(client: Any, db: Any) -> None:
    """The labelled series must add up to the rows they describe.

    This is the check that would have caught an unlabelled total disagreeing with
    the tenant-scoped dashboard: the sum over all tenants is the table count.
    """
    from sqlalchemy import text

    series = _parse(client.get("/metrics").text)
    rows = db.execute(text("SELECT count(*) FROM decisions")).scalar() or 0
    total = sum(value for _labels, value in series["haqdaar_decisions_total"])
    assert total == float(rows)


def test_audit_and_rag_gauges_reflect_the_database(client: Any, db: Any) -> None:
    from sqlalchemy import text

    series = _parse(client.get("/metrics").text)
    audit_rows = db.execute(text("SELECT count(*) FROM audit_events")).scalar() or 0
    chunk_rows = db.execute(text("SELECT count(*) FROM rag_chunks")).scalar() or 0

    assert series["haqdaar_audit_events_total"][0][1] == float(audit_rows)
    assert series["haqdaar_rag_chunks"][0][1] == float(chunk_rows)


def test_worker_heartbeat_age_is_a_gauge_not_a_boolean(client: Any) -> None:
    series = _parse(client.get("/metrics").text)
    value = series["haqdaar_worker_heartbeat_age_seconds"][0][1]
    # -1 means "never seen a heartbeat"; anything else is a real age in seconds.
    assert value == -1.0 or value >= 0.0


def test_a_failing_query_degrades_instead_of_raising(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A metrics query that breaks must not take the endpoint down.

    A scrape that returns 500 is indistinguishable from a dead instance, and the
    dashboard would page on the wrong thing. The endpoint reports the failure as
    a series instead.
    """
    from app import main as main_module

    class _BrokenSession:
        def execute(self, *_args: Any, **_kwargs: Any) -> Any:
            raise RuntimeError("simulated database failure")

        def close(self) -> None:
            return None

    monkeypatch.setattr(main_module, "SessionLocal", lambda: _BrokenSession())

    response = client.get("/metrics")
    assert response.status_code == 200
    series = _parse(response.text)
    assert series["haqdaar_metrics_errors"][0][1] == 1.0
    # The liveness gauges are computed before the queries, so they still report.
    assert series["haqdaar_up"][0][1] == 1.0
