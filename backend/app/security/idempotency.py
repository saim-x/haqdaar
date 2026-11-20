"""Idempotent offline mutations (docs/05 §1, docs/04 §4.5 ``idempotency_keys``).

A replay with the same ``Idempotency-Key`` and the same body returns the exact
cached status and body. The same key with a different body is
``409 IDEMPOTENCY_CONFLICT``. Rows are written in the *same* transaction as the
mutation, so a rolled-back mutation never leaves a cached response behind.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.jobs import IdempotencyKey
from app.security.errors import IdempotencyConflictError

IDEMPOTENCY_HEADER = "Idempotency-Key"


@dataclass(frozen=True, slots=True)
class StoredResponse:
    status_code: int
    body: dict[str, Any]


def get_idempotency_key(request: Request) -> str | None:
    raw = request.headers.get(IDEMPOTENCY_HEADER)
    if not raw:
        return None
    return raw.strip()[:128]


def request_hash(method: str, path: str, payload: Any) -> str:
    material = json.dumps(
        {"method": method.upper(), "path": path, "payload": payload},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def replay(
    db: Session,
    *,
    key: str | None,
    user_id: uuid.UUID,
    method: str,
    path: str,
    payload: Any,
) -> StoredResponse | None:
    """Return the cached response for this key, or ``None`` when it is new."""
    if not key:
        return None

    row = db.get(IdempotencyKey, {"key": key, "user_id": user_id})
    if row is None:
        return None

    if row.request_hash != request_hash(method, path, payload):
        raise IdempotencyConflictError(
            details={"key": key, "path": path},
        )
    return StoredResponse(status_code=row.response_status, body=row.response_body)


def remember(
    db: Session,
    *,
    key: str | None,
    user_id: uuid.UUID,
    method: str,
    path: str,
    payload: Any,
    status_code: int,
    body: dict[str, Any],
) -> None:
    """Cache a successful response for replay (same transaction as the mutation)."""
    if not key:
        return
    existing = db.get(IdempotencyKey, {"key": key, "user_id": user_id})
    if existing is not None:
        return
    db.add(
        IdempotencyKey(
            key=key,
            user_id=user_id,
            method=method.upper()[:8],
            path=path[:255],
            request_hash=request_hash(method, path, payload),
            response_status=status_code,
            response_body=body,
        )
    )
    db.flush()


__all__ = [
    "IDEMPOTENCY_HEADER",
    "StoredResponse",
    "get_idempotency_key",
    "remember",
    "replay",
    "request_hash",
]
