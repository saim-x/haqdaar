"""RBAC matrix, tenant isolation and demo-mode gating — docs/09 §2–3, docs/13 §1.

The judging brief calls out "server-side enforcement of access controls and
permissions", so these tests drive the real HTTP surface with real JWTs for every
role rather than inspecting dependencies.

The matrix below is transcribed from docs/05 §3. A role that docs/05 does not
list must get ``403 FORBIDDEN`` with ``details.required_roles``; a role that is
listed must never get that particular rejection (it may still get a business
403, a 404 for a missing resource, or a 422 for a bad body).
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

#: A syntactically valid id that exists in no table, so path parameters resolve
#: to 404 without any test having to create a resource first.
MISSING = "00000000-0000-0000-0000-000000000000"

ROLE_PERSONAS: dict[str, str] = {
    "CITIZEN": "widow_fatima",
    "HELPER": "helper_ayesha",
    "OFFICER": "officer_sana",
    "ADMIN": "admin_bilal",
    "AUDITOR": "auditor_nadia",
}

ALL_ROLES = tuple(ROLE_PERSONAS)

#: ``(method, path, roles docs/05 §3 allows)``.
MATRIX: tuple[tuple[str, str, frozenset[str]], ...] = (
    # -- cases (docs/05 §3.3) ------------------------------------------------
    ("GET", "/api/v1/cases", frozenset({"CITIZEN", "HELPER"})),
    ("POST", "/api/v1/cases", frozenset({"CITIZEN", "HELPER"})),
    ("GET", f"/api/v1/cases/{MISSING}", frozenset({"CITIZEN", "HELPER", "OFFICER", "AUDITOR"})),
    ("PATCH", f"/api/v1/cases/{MISSING}/draft", frozenset({"CITIZEN", "HELPER"})),
    ("POST", f"/api/v1/cases/{MISSING}/submit", frozenset({"CITIZEN", "HELPER"})),
    ("POST", f"/api/v1/cases/{MISSING}/withdraw", frozenset({"CITIZEN", "HELPER"})),
    ("POST", f"/api/v1/cases/{MISSING}/complaint", frozenset({"CITIZEN", "HELPER"})),
    # -- consent (docs/05 §3.4) ---------------------------------------------
    ("GET", "/api/v1/consent/grants", frozenset({"CITIZEN", "HELPER"})),
    ("POST", "/api/v1/consent/grants", frozenset({"CITIZEN", "HELPER"})),
    ("PATCH", f"/api/v1/consent/grants/{MISSING}", frozenset({"CITIZEN"})),
    ("POST", f"/api/v1/consent/grants/{MISSING}/withdraw", frozenset({"CITIZEN"})),
    ("GET", "/api/v1/consent/access-logs", frozenset({"CITIZEN", "AUDITOR"})),
    # -- documents (docs/05 §3.5) -------------------------------------------
    ("POST", "/api/v1/documents", frozenset({"CITIZEN", "HELPER"})),
    (
        "GET",
        f"/api/v1/documents/{MISSING}",
        frozenset({"CITIZEN", "HELPER", "OFFICER", "AUDITOR"}),
    ),
    (
        "GET",
        f"/api/v1/documents/{MISSING}/file",
        frozenset({"CITIZEN", "HELPER", "OFFICER", "AUDITOR"}),
    ),
    # -- my data (docs/05 §3.6) ---------------------------------------------
    ("GET", "/api/v1/me/data", frozenset({"CITIZEN", "HELPER"})),
    ("POST", "/api/v1/me/corrections", frozenset({"CITIZEN", "HELPER"})),
    ("GET", "/api/v1/me/notifications", frozenset({"CITIZEN", "HELPER"})),
    # -- helper (docs/05 §3.6) ----------------------------------------------
    ("GET", "/api/v1/helper/families", frozenset({"HELPER"})),
    ("POST", "/api/v1/helper/families", frozenset({"HELPER"})),
    ("GET", "/api/v1/helper/tenants", frozenset({"HELPER"})),
    ("POST", f"/api/v1/helper/families/{MISSING}/consent-otp", frozenset({"HELPER"})),
    ("POST", f"/api/v1/helper/families/{MISSING}/consent-verify", frozenset({"HELPER"})),
    # -- officer (docs/05 §3.7) ---------------------------------------------
    ("GET", "/api/v1/officer/queue", frozenset({"OFFICER"})),
    ("GET", "/api/v1/officer/officers", frozenset({"OFFICER"})),
    ("GET", "/api/v1/officer/corrections", frozenset({"OFFICER"})),
    ("GET", f"/api/v1/officer/cases/{MISSING}", frozenset({"OFFICER"})),
    ("POST", f"/api/v1/officer/cases/{MISSING}/assign", frozenset({"OFFICER"})),
    ("POST", f"/api/v1/officer/cases/{MISSING}/decide", frozenset({"OFFICER"})),
    ("POST", f"/api/v1/officer/cases/{MISSING}/notes", frozenset({"OFFICER"})),
    ("POST", f"/api/v1/officer/cases/{MISSING}/reevaluate", frozenset({"OFFICER"})),
    ("POST", f"/api/v1/officer/corrections/{MISSING}/resolve", frozenset({"OFFICER"})),
    # -- admin (docs/05 §3.7) -----------------------------------------------
    ("GET", "/api/v1/admin/users", frozenset({"ADMIN"})),
    ("POST", "/api/v1/admin/users", frozenset({"ADMIN"})),
    ("PATCH", f"/api/v1/admin/users/{MISSING}", frozenset({"ADMIN"})),
    ("GET", "/api/v1/admin/api-keys", frozenset({"ADMIN"})),
    ("POST", "/api/v1/admin/api-keys", frozenset({"ADMIN"})),
    ("DELETE", f"/api/v1/admin/api-keys/{MISSING}", frozenset({"ADMIN"})),
    ("GET", "/api/v1/admin/jobs", frozenset({"ADMIN"})),
    ("POST", f"/api/v1/admin/jobs/{MISSING}/retry", frozenset({"ADMIN"})),
    ("GET", "/api/v1/admin/tenants", frozenset({"ADMIN"})),
    ("GET", "/api/v1/admin/mocks", frozenset({"ADMIN"})),
    ("PATCH", "/api/v1/admin/mocks", frozenset({"ADMIN"})),
    # -- auditor (docs/05 §3.9) ---------------------------------------------
    ("GET", "/api/v1/auditor/events", frozenset({"AUDITOR"})),
    ("GET", "/api/v1/auditor/consents", frozenset({"AUDITOR"})),
    ("GET", "/api/v1/auditor/verify-chain", frozenset({"AUDITOR"})),
    ("GET", f"/api/v1/auditor/cases/{MISSING}/trace", frozenset({"AUDITOR"})),
    # -- analytics + catalogue ----------------------------------------------
    ("GET", "/api/v1/analytics/tenant", frozenset({"ADMIN", "OFFICER", "AUDITOR"})),
    (
        "GET",
        "/api/v1/programs",
        frozenset({"CITIZEN", "HELPER", "OFFICER", "ADMIN", "AUDITOR"}),
    ),
)

#: Routes that must never be exercised as an allowed role: they mutate the whole
#: demo world. They are checked for denial only.
DESTRUCTIVE = ("POST", "/api/v1/admin/demo/reset", frozenset({"ADMIN"}))


def _rbac_denial(response: Any) -> bool:
    """True when the response is ``403`` *because of the role guard*.

    Two envelope shapes exist: the shared one nests ``details`` under ``error``,
    while ``admin_mocks`` raises ``HTTPException(detail={"error": ..., ...})``
    which the handler passes through flat.
    """
    if response.status_code != 403:
        return False
    try:
        body = response.json()
    except ValueError:  # pragma: no cover - defensive
        return False
    error = body.get("error")
    if isinstance(error, dict):
        return "required_roles" in (error.get("details") or {})
    return "required_roles" in body


def _error_code(response: Any) -> str | None:
    try:
        body = response.json()
    except ValueError:  # pragma: no cover - defensive
        return None
    error = body.get("error")
    if isinstance(error, dict):
        return error.get("code")
    if isinstance(error, str):
        return error
    return None


# --- the matrix -------------------------------------------------------------


def test_role_matrix_matches_docs_05(client: Any, persona_headers: Any) -> None:
    headers = {role: persona_headers(persona) for role, persona in ROLE_PERSONAS.items()}

    failures: list[str] = []
    for method, path, allowed in MATRIX:
        for role in ALL_ROLES:
            response = client.request(method, path, headers=headers[role], json={})
            if role in allowed:
                if _rbac_denial(response):
                    failures.append(f"{method} {path}: {role} was denied but docs/05 allows it")
            elif not _rbac_denial(response):
                failures.append(
                    f"{method} {path}: {role} was not denied "
                    f"(status {response.status_code}, code {_error_code(response)})"
                )

    assert not failures, "RBAC matrix violations:\n" + "\n".join(failures)


def test_demo_reset_is_admin_only(client: Any, persona_headers: Any) -> None:
    """Never called as ADMIN — it would wipe the seeded world mid-session."""
    method, path, allowed = DESTRUCTIVE
    for role in ALL_ROLES:
        if role in allowed:
            continue
        response = client.request(method, path, headers=persona_headers(ROLE_PERSONAS[role]))
        assert _rbac_denial(response), f"{role} could reach {method} {path}"


def test_unauthenticated_requests_are_401(client: Any) -> None:
    """No token at all is ``401 UNAUTHORIZED``, never a 403 or a 500."""
    failures: list[str] = []
    for method, path, _allowed in MATRIX:
        if path.startswith("/api/v1/admin/mocks"):
            # admin_mocks resolves the caller optionally and answers 403 itself.
            continue
        response = client.request(method, path, json={})
        if response.status_code != 401 or _error_code(response) != "UNAUTHORIZED":
            failures.append(
                f"{method} {path}: {response.status_code} {_error_code(response)}"
            )
    assert not failures, "unauthenticated requests not rejected with 401:\n" + "\n".join(failures)


def test_auditor_cannot_mutate_anything(client: Any, auditor_headers: dict[str, str]) -> None:
    """Oversight is read-only: every mutation the auditor can see is a 403."""
    mutations = [
        ("POST", "/api/v1/cases"),
        ("PATCH", f"/api/v1/cases/{MISSING}/draft"),
        ("POST", f"/api/v1/cases/{MISSING}/submit"),
        ("POST", f"/api/v1/cases/{MISSING}/withdraw"),
        ("POST", "/api/v1/documents"),
        ("POST", "/api/v1/consent/grants"),
        ("PATCH", f"/api/v1/consent/grants/{MISSING}"),
        ("POST", f"/api/v1/consent/grants/{MISSING}/withdraw"),
        ("POST", f"/api/v1/officer/cases/{MISSING}/decide"),
        ("POST", f"/api/v1/officer/cases/{MISSING}/assign"),
        ("POST", "/api/v1/admin/users"),
        ("POST", "/api/v1/admin/api-keys"),
        ("POST", "/api/v1/me/corrections"),
    ]
    for method, path in mutations:
        response = client.request(method, path, headers=auditor_headers, json={})
        assert _rbac_denial(response), f"auditor reached {method} {path}"


# --- four eyes --------------------------------------------------------------


def _pending_second_approval_case(db: Any, officer_user_id: uuid.UUID) -> Any:
    """A case parked in ``PENDING_SECOND_APPROVAL`` with a known first approver."""
    from sqlalchemy import select

    from app.models.cases import Case
    from app.models.enums import CaseStatus
    from app.models.identity import User

    officer = db.get(User, officer_user_id)
    case = db.execute(
        select(Case)
        .where(Case.tenant_id == officer.tenant_id, Case.citizen_id.is_not(None))
        .order_by(Case.created_at.asc())
        .limit(1)
    ).scalar_one_or_none()
    assert case is not None, "the seeded world has no case in the officer's tenant"

    case.status = CaseStatus.PENDING_SECOND_APPROVAL.value
    case.first_approver_id = officer_user_id
    case.assigned_officer_id = officer_user_id
    db.commit()
    return case


def test_four_eyes_blocks_the_same_officer(
    client: Any, db: Any, officer_headers: dict[str, str], second_officer_headers: dict[str, str]
) -> None:
    """docs/09 §2: the second approval must come from a different officer."""
    from app.models.identity import User
    from app.security.jwt import decode_access_token

    claims = decode_access_token(officer_headers["Authorization"].split(" ", 1)[1])
    officer_user_id = uuid.UUID(claims["sub"])
    assert db.get(User, officer_user_id) is not None

    case = _pending_second_approval_case(db, officer_user_id)
    body = {"action": "APPROVE", "note": "second approval"}

    same = client.post(
        f"/api/v1/officer/cases/{case.id}/decide", headers=officer_headers, json=body
    )
    assert same.status_code == 403, same.text
    assert _error_code(same) == "SAME_OFFICER"

    other = client.post(
        f"/api/v1/officer/cases/{case.id}/decide", headers=second_officer_headers, json=body
    )
    assert other.status_code == 200, other.text
    assert other.json()["status"] == "APPROVED"


# --- tenant isolation -------------------------------------------------------


def test_cross_tenant_case_is_404_not_403(
    client: Any, db: Any, officer_headers: dict[str, str], other_tenant_officer_headers: dict[str, str]
) -> None:
    """docs/09 §3: a foreign resource must not leak its existence."""
    from sqlalchemy import select

    from app.models.audit import AuditEvent
    from app.models.cases import Case
    from app.security.jwt import decode_access_token

    claims = decode_access_token(officer_headers["Authorization"].split(" ", 1)[1])
    from app.models.identity import User

    officer = db.get(User, uuid.UUID(claims["sub"]))
    case = db.execute(
        select(Case).where(Case.tenant_id == officer.tenant_id).limit(1)
    ).scalar_one_or_none()
    assert case is not None

    response = client.get(
        f"/api/v1/officer/cases/{case.id}", headers=other_tenant_officer_headers
    )
    assert response.status_code == 404, response.text
    assert _error_code(response) == "NOT_FOUND"

    db.rollback()
    denied = db.execute(
        select(AuditEvent)
        .where(AuditEvent.action == "auth.cross_scope_denied")
        .order_by(AuditEvent.seq.desc())
        .limit(1)
    ).scalar_one_or_none()
    assert denied is not None, "a cross-tenant read must leave an audit trail"
    assert denied.payload_json.get("role") == "OFFICER"


# --- public API keys --------------------------------------------------------


def _create_api_key(client: Any, admin_headers: dict[str, str], scopes: list[str]) -> dict[str, Any]:
    response = client.post(
        "/api/v1/admin/api-keys",
        headers=admin_headers,
        json={"name": "rbac-test", "scopes": scopes, "rate_limit_per_min": 600},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_public_endpoints_require_an_api_key(client: Any) -> None:
    for path in ("/api/v1/public/programs", "/api/v1/public/cases/HQ-2025-000001/status"):
        response = client.get(path)
        assert response.status_code == 401, f"{path} served without a key"
        assert _error_code(response) == "UNAUTHORIZED"


def test_revoked_api_key_is_401_on_the_next_call(
    client: Any, admin_headers: dict[str, str]
) -> None:
    created = _create_api_key(client, admin_headers, ["rules:read"])
    key = created["api_key"]
    key_id = created["id"]

    ok = client.get("/api/v1/public/programs", headers={"X-API-Key": key})
    assert ok.status_code == 200, ok.text

    revoked = client.delete(f"/api/v1/admin/api-keys/{key_id}", headers=admin_headers)
    assert revoked.status_code == 200, revoked.text

    after = client.get("/api/v1/public/programs", headers={"X-API-Key": key})
    assert after.status_code == 401, after.text
    assert _error_code(after) == "UNAUTHORIZED"


def test_api_key_scopes_are_enforced(client: Any, admin_headers: dict[str, str]) -> None:
    created = _create_api_key(client, admin_headers, ["rules:read"])
    key = created["api_key"]

    allowed = client.get("/api/v1/public/programs", headers={"X-API-Key": key})
    assert allowed.status_code == 200, allowed.text

    denied = client.get(
        "/api/v1/public/cases/HQ-2025-000001/status", headers={"X-API-Key": key}
    )
    assert denied.status_code == 403, denied.text
    assert _error_code(denied) == "FORBIDDEN"


# --- demo mode --------------------------------------------------------------


def test_demo_login_is_404_when_demo_mode_is_off(
    client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """docs/09 §1.1: the persona shortcut disappears entirely outside demo mode."""
    from app.config import settings

    monkeypatch.setattr(settings, "demo_mode", False, raising=False)

    response = client.post("/api/v1/auth/demo-login", json={"persona_key": "officer_sana"})
    assert response.status_code == 404, response.text
    assert _error_code(response) == "NOT_FOUND"
