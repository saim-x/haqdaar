"""The public honesty page must show the simulated world as it actually is.

``/transparency`` is the page Scene 0 opens with, and docs/05 §3.9 promises
"real vs simulated subsystems **+ current mock statuses**". An empty
``mock_services`` array made that promise false: a judge could take a government
rail down and the public page would still look calm.

The seven services are the ``SERVICE_NAMES`` tuple in ``app/mocks/models.py``.
"""

from __future__ import annotations

from typing import Any

EXPECTED_SERVICES = (
    "identity",
    "civil",
    "household",
    "benefits",
    "payment",
    "complaint",
    "sms",
)

SERVICE_FIELDS = {"service_name", "mode", "latency_ms", "failure_rate", "updated_at"}


def test_transparency_lists_all_seven_mock_services(client: Any) -> None:
    response = client.get("/api/v1/transparency")
    assert response.status_code == 200, response.text

    body = response.json()
    services = body["mock_services"]
    assert len(services) == 7, f"expected the seven DPI services, got {len(services)}"
    assert tuple(row["service_name"] for row in services) == EXPECTED_SERVICES

    for row in services:
        assert set(row) == SERVICE_FIELDS, row
        assert row["mode"] in {"NORMAL", "SLOW", "FLAKY", "DOWN"}, row
        assert isinstance(row["latency_ms"], int)
        assert 0.0 <= float(row["failure_rate"]) <= 1.0


def test_transparency_reflects_a_live_mode_change(
    client: Any, platform_admin_headers: dict[str, str]
) -> None:
    """Take a rail down and the public page must say so."""
    patched = client.patch(
        "/api/v1/admin/mocks",
        headers=platform_admin_headers,
        json={"service": "identity", "mode": "DOWN"},
    )
    assert patched.status_code == 200, patched.text

    try:
        body = client.get("/api/v1/transparency").json()
        modes = {row["service_name"]: row["mode"] for row in body["mock_services"]}
        assert modes["identity"] == "DOWN"
        # The other six are untouched.
        assert {name for name, mode in modes.items() if mode == "DOWN"} == {"identity"}
    finally:
        restored = client.patch(
            "/api/v1/admin/mocks",
            headers=platform_admin_headers,
            json={"service": "identity", "mode": "NORMAL"},
        )
        assert restored.status_code == 200, restored.text


def test_transparency_components_and_mock_services_agree(client: Any) -> None:
    """Every simulated service named in the table must exist in the live status list."""
    body = client.get("/api/v1/transparency").json()

    simulated = " ".join(
        row["component"] for row in body["components"] if row["status"] == "SIMULATED"
    ).lower()
    for service in ("identity", "civil", "household", "benefits", "payment", "complaint", "sms"):
        assert service in simulated, f"{service} is simulated but not disclosed in components"

    assert {row["service_name"] for row in body["mock_services"]} == set(EXPECTED_SERVICES)
