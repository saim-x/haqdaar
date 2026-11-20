"""Canonical signed-QR payloads for mock specimen documents.

Single source of truth shared by the generator (``app/mocks/doc_generator.py``)
and the verifier (``app/ai/doc_verify.py``). Keeping it in ``app/ai`` means the
verifier never imports ``app.mocks`` — the mock world and the AI world agree on
the wire format, not on each other's internals.

Payload (docs/10 §3.1)::

    {
      "doc_type": "CNIC_FRONT",
      "cnic": "9990010000012",
      "full_name": "Fatima Bibi",
      "dob": "1974-05-14",
      "issuer": "MOCK_IDENTITY_REGISTRY",
      "sig": "<hex HMAC-SHA256 of the canonical fields>"
    }

The signature covers ``doc_type``, ``cnic``, ``full_name``, ``dob`` and
``issuer`` — sorted keys, compact separators, UTF-8. Any edit to a signed field
invalidates the HMAC, which is exactly how a Photoshopped name is caught.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from typing import Any, Mapping

#: Fields covered by the HMAC, in canonical (sorted) order.
CANONICAL_FIELDS: tuple[str, ...] = ("cnic", "dob", "doc_type", "full_name", "issuer")

#: Issuer identifiers for the two specimen document types.
ISSUER_CNIC = "MOCK_IDENTITY_REGISTRY"
ISSUER_DEATH = "MOCK_CIVIL_REGISTRY"

DEFAULT_QR_SECRET = "dev-qr-secret-change-me"


def qr_secret() -> str:
    """Return ``QR_HMAC_SECRET`` (dev default keeps local runs frictionless)."""
    return os.environ.get("QR_HMAC_SECRET") or DEFAULT_QR_SECRET


def canonical_bytes(payload: Mapping[str, Any]) -> bytes:
    """Serialize the signed subset of ``payload`` deterministically."""
    subset = {field: payload.get(field) for field in CANONICAL_FIELDS}
    return json.dumps(subset, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def sign_payload(payload: Mapping[str, Any], secret: str | None = None) -> str:
    """Return the hex HMAC-SHA256 signature for ``payload``."""
    key = (secret if secret is not None else qr_secret()).encode("utf-8")
    return hmac.new(key, canonical_bytes(payload), hashlib.sha256).hexdigest()


def build_payload(
    *,
    doc_type: str,
    cnic: str,
    full_name: str,
    dob: str | None,
    issuer: str,
    secret: str | None = None,
) -> dict[str, Any]:
    """Build a complete, signed QR payload."""
    payload: dict[str, Any] = {
        "doc_type": doc_type,
        "cnic": cnic,
        "full_name": full_name,
        "dob": dob,
        "issuer": issuer,
    }
    payload["sig"] = sign_payload(payload, secret)
    return payload


def verify_payload(payload: Mapping[str, Any], secret: str | None = None) -> bool:
    """Constant-time HMAC verification. Missing/blank ``sig`` is never valid."""
    signature = payload.get("sig")
    if not isinstance(signature, str) or not signature:
        return False
    expected = sign_payload(payload, secret)
    return hmac.compare_digest(signature.lower(), expected.lower())


def payload_to_json(payload: Mapping[str, Any]) -> str:
    """Compact JSON suitable for embedding in a QR code."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def parse_payload(raw: str | bytes | None) -> dict[str, Any] | None:
    """Parse a decoded QR string into a dict, or ``None`` if it is not our format."""
    if raw is None:
        return None
    if isinstance(raw, bytes):
        try:
            raw = raw.decode("utf-8")
        except UnicodeDecodeError:
            return None
    text = raw.strip()
    if not text.startswith("{"):
        return None
    try:
        parsed = json.loads(text)
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None
    if not all(field in parsed for field in ("doc_type", "cnic", "full_name", "sig")):
        return None
    return parsed


__all__ = [
    "CANONICAL_FIELDS",
    "DEFAULT_QR_SECRET",
    "ISSUER_CNIC",
    "ISSUER_DEATH",
    "build_payload",
    "canonical_bytes",
    "parse_payload",
    "payload_to_json",
    "qr_secret",
    "sign_payload",
    "verify_payload",
]
