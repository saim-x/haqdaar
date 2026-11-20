"""docs/05 §1: both case reads carry a weak ``ETag`` and honour ``If-None-Match``.

The list endpoint had it from the start; the single-case endpoint did not, so a
client polling ``GET /cases/{id}`` re-downloaded the full payload every time. These
tests pin the pair so the two cannot drift apart again.
"""

from __future__ import annotations

from typing import Any

import pytest

PROGRAM_CODE = "SAHARA_WIDOW_GRANT"


@pytest.fixture()
def case_id(client: Any, citizen_headers: dict[str, str], seeded_ids: dict[str, Any]) -> str:
    created = client.post(
        "/api/v1/cases",
        headers=citizen_headers,
        json={
            "program_id": str(seeded_ids["programs"][PROGRAM_CODE]),
            "case_type": "BENEFIT_APPLICATION",
        },
    )
    assert created.status_code in (200, 201), created.text
    return str(created.json()["id"])


def test_single_case_read_returns_a_weak_etag(
    client: Any, citizen_headers: dict[str, str], case_id: str
) -> None:
    response = client.get(f"/api/v1/cases/{case_id}", headers=citizen_headers)
    assert response.status_code == 200, response.text

    etag = response.headers.get("ETag")
    assert etag, "GET /cases/{id} must carry an ETag (docs/05 §1)"
    assert etag.startswith('W/"'), f"the ETag must be weak, got {etag!r}"


def test_single_case_read_honours_if_none_match(
    client: Any, citizen_headers: dict[str, str], case_id: str
) -> None:
    first = client.get(f"/api/v1/cases/{case_id}", headers=citizen_headers)
    etag = first.headers["ETag"]

    second = client.get(
        f"/api/v1/cases/{case_id}",
        headers={**citizen_headers, "If-None-Match": etag},
    )
    assert second.status_code == 304, second.text
    assert second.content == b""
    assert second.headers.get("ETag") == etag


def test_single_case_etag_changes_when_the_case_changes(
    client: Any, citizen_headers: dict[str, str], case_id: str
) -> None:
    before = client.get(f"/api/v1/cases/{case_id}", headers=citizen_headers).headers["ETag"]

    saved = client.patch(
        f"/api/v1/cases/{case_id}/draft",
        headers=citizen_headers,
        json={"wizard_step": "identity", "answers": {"applicant_district": {"value": "Thatta"}}},
    )
    assert saved.status_code == 200, saved.text

    after = client.get(f"/api/v1/cases/{case_id}", headers=citizen_headers).headers["ETag"]
    assert after != before, "a stale ETag would serve a cached body after a real change"


def test_list_and_single_use_the_same_etag_convention(
    client: Any, citizen_headers: dict[str, str], case_id: str
) -> None:
    listing = client.get("/api/v1/cases", headers=citizen_headers)
    single = client.get(f"/api/v1/cases/{case_id}", headers=citizen_headers)

    assert listing.headers.get("ETag", "").startswith('W/"')
    assert single.headers.get("ETag", "").startswith('W/"')

    replayed = client.get(
        "/api/v1/cases",
        headers={**citizen_headers, "If-None-Match": listing.headers["ETag"]},
    )
    assert replayed.status_code == 304
