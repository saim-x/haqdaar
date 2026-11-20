"""HTTP caching helpers — weak ETags for slow-connection clients (docs/05 §1)."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import Request, Response


def weak_etag(payload: Any) -> str:
    """Deterministic weak ETag over a JSON-able payload."""
    material = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:32]
    return f'W/"{digest}"'


def etag_matches(request: Request, etag: str) -> bool:
    header = request.headers.get("If-None-Match")
    if not header:
        return False
    candidates = {part.strip() for part in header.split(",")}
    return etag in candidates or "*" in candidates


def not_modified(etag: str) -> Response:
    return Response(status_code=304, headers={"ETag": etag})


def with_etag(response: Response, etag: str) -> Response:
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "private, must-revalidate"
    return response


__all__ = ["etag_matches", "not_modified", "weak_etag", "with_etag"]
