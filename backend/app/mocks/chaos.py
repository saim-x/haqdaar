"""Chaos controls for the simulated DPI services (docs/10 §1.1).

Every ``/mock/v1/*`` response passes through :class:`ChaosRoute`, which:

1. reads ``mock_service_configs`` for the service that owns the path,
2. applies the configured mode —
   ``NORMAL`` 30–80 ms jitter, ``SLOW`` ``latency_ms`` sleep,
   ``FLAKY`` sleep + HTTP 503 at ``failure_rate``,
   ``DOWN`` immediate HTTP 503 ``MOCK_SERVICE_DOWN``,
3. guarantees the universal envelope ``{"simulated": true, "service": ...,
   "service_mode": ...}`` on every 2xx body.

The chaos decision is made **before** the endpoint runs, so a ``DOWN`` service
never touches the database and never half-executes a mutation. That is what lets
the case agent prove "no guess was made" (Challenge 02 / J-8).
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from app.mocks.config import (
    DEFAULT_FAILURE_RATE,
    DEFAULT_LATENCY_MS,
    NORMAL_JITTER_MAX_MS,
    NORMAL_JITTER_MIN_MS,
)

logger = logging.getLogger("haqdaar.mocks.chaos")

#: Path prefix → simulated service name (docs/04 §4.6 service names).
_PATH_SERVICE_MAP: tuple[tuple[str, str], ...] = (
    ("/identity", "identity"),
    ("/civil", "civil"),
    ("/household", "household"),
    ("/benefits", "benefits"),
    ("/payments", "payment"),
    ("/complaints", "complaint"),
    ("/sms", "sms"),
)


def service_for_path(path: str) -> str | None:
    """Map a request path to its simulated service name."""
    for prefix, service in _PATH_SERVICE_MAP:
        if prefix in path:
            return service
    return None


@dataclass(frozen=True)
class ChaosState:
    """Resolved chaos decision for one request."""

    service: str
    mode: str
    delay_ms: int
    failure_rate: float

    @property
    def should_fail(self) -> bool:
        if self.mode == "DOWN":
            return True
        if self.mode == "FLAKY":
            return random.random() < self.failure_rate
        return False


def _load_state(service: str) -> ChaosState:
    """Read the live chaos config, degrading to ``NORMAL`` if the DB is unavailable."""
    try:
        from app.db import SessionLocal

        db = SessionLocal()
        try:
            from app.mocks.config import get_service_config

            cfg = get_service_config(db, service)
        finally:
            db.close()
    except Exception:  # pragma: no cover - defensive: chaos must never break mocks
        logger.warning("chaos config unavailable for %s; defaulting to NORMAL", service)
        return ChaosState(service=service, mode="NORMAL", delay_ms=0, failure_rate=0.0)

    mode = str(cfg.get("mode") or "NORMAL").upper()
    latency_ms = int(cfg.get("latency_ms") or DEFAULT_LATENCY_MS)
    failure_rate = float(cfg.get("failure_rate") or DEFAULT_FAILURE_RATE)

    if mode == "NORMAL":
        delay_ms = random.randint(NORMAL_JITTER_MIN_MS, NORMAL_JITTER_MAX_MS)
    elif mode in ("SLOW", "FLAKY"):
        delay_ms = latency_ms
    else:  # DOWN
        delay_ms = 0
    return ChaosState(service=service, mode=mode, delay_ms=delay_ms, failure_rate=failure_rate)


def _down_body(service: str, mode: str) -> dict[str, Any]:
    error = "MOCK_SERVICE_DOWN" if mode == "DOWN" else "MOCK_SERVICE_UNAVAILABLE"
    return {
        "simulated": True,
        "service": service,
        "service_mode": mode,
        "error": error,
    }


def _inject_envelope(response: Response, service: str, mode: str) -> Response:
    """Add ``simulated`` / ``service`` / ``service_mode`` to a JSON 2xx body."""
    if response.status_code >= 300:
        return response
    body = getattr(response, "body", None)
    if not body:
        return response
    try:
        payload = json.loads(body)
    except (ValueError, TypeError):
        return response
    if not isinstance(payload, dict):
        return response
    payload.setdefault("simulated", True)
    payload.setdefault("service", service)
    payload["service_mode"] = mode
    headers = dict(response.headers)
    headers.pop("content-length", None)
    return JSONResponse(
        content=payload,
        status_code=response.status_code,
        headers=headers,
        media_type="application/json",
    )


class ChaosRoute(APIRoute):
    """``APIRoute`` subclass that applies chaos + the universal envelope."""

    def get_route_handler(self) -> Callable[[Request], Any]:
        original = super().get_route_handler()

        async def chaos_handler(request: Request) -> Response:
            service = service_for_path(request.url.path)
            if service is None:  # pragma: no cover - every mock route is mapped
                return await original(request)

            state = _load_state(service)
            if state.should_fail:
                logger.info(
                    "mock chaos failure service=%s mode=%s path=%s",
                    service,
                    state.mode,
                    request.url.path,
                )
                return JSONResponse(
                    content=_down_body(service, state.mode),
                    status_code=503,
                    headers={"Retry-After": "2"},
                )

            if state.delay_ms:
                await asyncio.sleep(state.delay_ms / 1000.0)

            response = await original(request)
            return _inject_envelope(response, service, state.mode)

        return chaos_handler


class MockChaosMiddleware:
    """Optional ASGI middleware variant of the same policy.

    ``app/main.py`` may mount this for belt-and-braces coverage; the router-level
    :class:`ChaosRoute` is the primary mechanism because ``app/mocks`` owns the
    router but not ``main.py``.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope.get("type") != "http" or not str(scope.get("path", "")).startswith("/mock/"):
            await self.app(scope, receive, send)
            return

        service = service_for_path(str(scope.get("path", "")))
        if service is None:
            await self.app(scope, receive, send)
            return

        state = _load_state(service)
        if state.should_fail:
            body = json.dumps(_down_body(service, state.mode)).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 503,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                        (b"retry-after", b"2"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return

        if state.delay_ms:
            await asyncio.sleep(state.delay_ms / 1000.0)
        await self.app(scope, receive, send)


__all__ = [
    "ChaosRoute",
    "ChaosState",
    "MockChaosMiddleware",
    "service_for_path",
]
