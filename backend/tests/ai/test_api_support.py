"""Contract tests for the AI routers' shared plumbing (``app/ai/api_support.py``).

The Lead confirmed the canonical audit signature:

    record(db, *, action, resource_type, resource_id=None, actor_type="SYSTEM",
           actor_id=None, actor_role=None, tenant_id=None, request_id=None,
           payload=None)

The shim must mirror it exactly — including ``payload`` rather than
``payload_json``, which is the database column name — so it binds to BE's real
writer at S1 with zero rework. These tests fail loudly if the two drift apart.
"""

from __future__ import annotations

import inspect
import sys
import types
from typing import Any

import pytest

from app.ai import api_support

#: The canonical keyword-only parameters, in order, with their defaults.
CANONICAL = [
    ("action", inspect.Parameter.empty),
    ("resource_type", inspect.Parameter.empty),
    ("resource_id", None),
    ("actor_type", "SYSTEM"),
    ("actor_id", None),
    ("actor_role", None),
    ("tenant_id", None),
    ("request_id", None),
    ("payload", None),
]


@pytest.fixture
def audit_spy(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Capture what the shim forwards to ``app.security.audit.record``."""
    calls: list[dict[str, Any]] = []

    audit_module = types.ModuleType("app.security.audit")
    audit_module.record = lambda db, **kwargs: calls.append(kwargs)  # type: ignore[attr-defined]

    try:
        import app.security as security_pkg  # type: ignore
    except Exception:
        security_pkg = types.ModuleType("app.security")
        security_pkg.__path__ = []  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "app.security", security_pkg)
        import app

        monkeypatch.setattr(app, "security", security_pkg, raising=False)

    monkeypatch.setitem(sys.modules, "app.security.audit", audit_module)
    monkeypatch.setattr(security_pkg, "audit", audit_module, raising=False)
    return calls


class TestSignature:
    def test_keyword_parameters_match_the_canonical_writer(self) -> None:
        signature = inspect.signature(api_support.record_audit)
        params = [
            (name, parameter.default)
            for name, parameter in signature.parameters.items()
            if name != "db"
        ]
        assert params == CANONICAL

    def test_every_parameter_after_db_is_keyword_only(self) -> None:
        signature = inspect.signature(api_support.record_audit)
        for name, parameter in signature.parameters.items():
            if name == "db":
                continue
            assert parameter.kind is inspect.Parameter.KEYWORD_ONLY, name

    def test_payload_json_is_not_a_parameter(self) -> None:
        """``payload_json`` is the column name; the writer kwarg is ``payload``."""
        signature = inspect.signature(api_support.record_audit)
        assert "payload_json" not in signature.parameters
        assert "payload" in signature.parameters


class TestForwarding:
    def test_it_forwards_payload_not_payload_json(self, audit_spy: list[dict[str, Any]]) -> None:
        api_support.record_audit(
            object(),
            action="scam.checked",
            resource_type="scam_check",
            resource_id="abc",
            payload={"verdict": "LIKELY_SCAM"},
        )
        assert audit_spy
        event = audit_spy[0]
        assert event["payload"] == {"verdict": "LIKELY_SCAM"}
        assert "payload_json" not in event

    def test_it_forwards_every_canonical_field(self, audit_spy: list[dict[str, Any]]) -> None:
        api_support.record_audit(
            object(),
            action="document.verified",
            resource_type="document",
            resource_id="doc-1",
            actor_type="AI",
            actor_id="doc_verify",
            actor_role="AI",
            tenant_id="tenant-1",
            request_id="req-1",
            payload={"status": "VERIFIED"},
        )
        event = audit_spy[0]
        assert event["action"] == "document.verified"
        assert event["resource_type"] == "document"
        assert event["resource_id"] == "doc-1"
        assert event["actor_type"] == "AI"
        assert event["actor_id"] == "doc_verify"
        assert event["actor_role"] == "AI"
        assert event["tenant_id"] == "tenant-1"
        assert event["request_id"] == "req-1"
        assert event["payload"] == {"status": "VERIFIED"}

    def test_the_default_actor_type_is_system(self, audit_spy: list[dict[str, Any]]) -> None:
        api_support.record_audit(object(), action="seed.run", resource_type="seed")
        assert audit_spy[0]["actor_type"] == "SYSTEM"

    def test_a_missing_payload_becomes_an_empty_dict(self, audit_spy: list[dict[str, Any]]) -> None:
        api_support.record_audit(object(), action="x", resource_type="y")
        assert audit_spy[0]["payload"] == {}

    def test_actor_id_is_stringified(self, audit_spy: list[dict[str, Any]]) -> None:
        import uuid

        identifier = uuid.uuid4()
        api_support.record_audit(object(), action="x", resource_type="y", actor_id=identifier)
        assert audit_spy[0]["actor_id"] == str(identifier)


class TestDegradation:
    def test_no_session_is_a_no_op(self) -> None:
        api_support.record_audit(None, action="x", resource_type="y")

    def test_a_missing_audit_module_does_not_raise(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setitem(sys.modules, "app.security.audit", None)
        api_support.record_audit(object(), action="x", resource_type="y")

    def test_a_failing_writer_does_not_raise(self, monkeypatch: pytest.MonkeyPatch) -> None:
        audit_module = types.ModuleType("app.security.audit")

        def boom(*args: Any, **kwargs: Any) -> None:
            raise RuntimeError("audit chain is broken")

        audit_module.record = boom  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "app.security.audit", audit_module)

        api_support.record_audit(object(), action="x", resource_type="y")


class TestAdminMocksAudit:
    def test_the_admin_audit_helper_uses_the_payload_keyword(
        self, audit_spy: list[dict[str, Any]]
    ) -> None:
        """Regression: ``_audit`` passed ``payload_json`` and raised TypeError."""
        from app.api.v1 import admin_mocks

        user = types.SimpleNamespace(id="u1", role="PLATFORM_ADMIN", tenant_id="t1")
        admin_mocks._audit(object(), user, "admin.mocks.updated", {"service": "identity"})

        assert audit_spy
        assert audit_spy[0]["payload"] == {"service": "identity"}
        assert audit_spy[0]["actor_type"] == "USER"
