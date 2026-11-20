"""FastAPI application factory — middleware, error envelope, routers, health.

Everything the platform exposes is mounted here from day one: BE's real routers,
EN's rule editor and eval routers, and the one-time stubs owned by other agents.
A missing teammate module never prevents boot.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.db import SessionLocal
from app.security.context import (
    configure_logging,
    get_request_id,
    log_event,
    request_id_var,
    set_request_id,
)
from app.security.errors import ApiError
from app.security.ratelimit import check_ai_limit, check_scam_limit

logger = logging.getLogger("app.main")

REQUEST_ID_HEADER = "X-Request-ID"
PROTOTYPE_BANNER = "Haqdaar prototype — simulated government services, synthetic data only"

#: Paths that never require an RBAC dependency (docs/03 §7 invariant 3).
PUBLIC_PATH_PREFIXES = (
    "/api/v1/auth/",
    "/api/v1/scam/check",
    "/api/v1/transparency",
    "/health",
    "/mock/",
    "/api/docs",
    "/api/openapi.json",
)


# --- middleware -------------------------------------------------------------


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Propagate or generate ``X-Request-ID`` and emit one JSON log line per request."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get(REQUEST_ID_HEADER)
        request_id = incoming.strip() if incoming and incoming.strip() else f"req_{uuid.uuid4().hex}"
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers[REQUEST_ID_HEADER] = request_id
            response.headers["X-Prototype"] = "true"
            return response
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            log_event(
                logger,
                "http.request",
                method=request.method,
                path=request.url.path,
                status=status_code,
                duration_ms=duration_ms,
                request_id=request_id,
            )
            request_id_var.reset(token)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Anonymous per-IP limits for the public AI endpoints (docs/03 §6.3)."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if settings.rate_limit_enabled:
            path = request.url.path
            ip = request.client.host if request.client else "unknown"
            try:
                if request.method == "POST" and path == "/api/v1/scam/check":
                    check_scam_limit(ip)
                elif request.method == "POST" and (
                    path.startswith("/api/v1/voice/") or path == "/api/v1/rag/ask"
                ):
                    check_ai_limit(ip)
            except ApiError as exc:
                return _error_response(exc)
        return await call_next(request)


# --- error envelope ---------------------------------------------------------


def _error_response(exc: ApiError) -> JSONResponse:
    body = {
        "error": {
            "code": exc.code,
            "message_en": exc.message_en,
            "message_ur": exc.message_ur,
            "request_id": get_request_id(),
            "details": exc.details or {},
        }
    }
    headers = dict(exc.headers)
    if get_request_id():
        headers.setdefault(REQUEST_ID_HEADER, get_request_id() or "")
    return JSONResponse(status_code=exc.status_code, content=body, headers=headers)


def _envelope(
    *,
    status_code: int,
    code: str,
    message_en: str,
    message_ur: str,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message_en": message_en,
                "message_ur": message_ur,
                "request_id": get_request_id(),
                "details": details or {},
            }
        },
        headers=headers or {},
    )


_STATUS_DEFAULTS: dict[int, tuple[str, str, str]] = {
    400: ("VALIDATION_ERROR", "The request contains invalid or missing fields.", "درخواست میں غلط یا غائب معلومات ہیں۔"),
    401: ("UNAUTHORIZED", "Authentication is required or your session has expired.", "تصدیق ضروری ہے یا آپ کا سیشن ختم ہو گیا ہے۔"),
    403: ("FORBIDDEN", "Your role does not allow this action.", "آپ کے کردار کو یہ اجازت نہیں ہے۔"),
    404: ("NOT_FOUND", "The requested resource was not found.", "مطلوبہ معلومات موجود نہیں۔"),
    409: ("INVALID_TRANSITION", "This status change is not allowed.", "یہ تبدیلی اجازت شدہ نہیں ہے۔"),
    413: ("FILE_TOO_LARGE", "The file is too large.", "فائل بہت بڑی ہے۔"),
    415: ("UNSUPPORTED_MEDIA_TYPE", "This file type is not supported.", "اس قسم کی فائل معاون نہیں ہے۔"),
    422: ("VALIDATION_ERROR", "The request contains invalid or missing fields.", "درخواست میں غلط یا غائب معلومات ہیں۔"),
    429: ("RATE_LIMITED", "Too many requests. Please try again shortly.", "بہت زیادہ درخواستیں۔ براہ کرم تھوڑی دیر بعد کوشش کریں۔"),
    503: ("SERVICE_UNAVAILABLE", "A required service is temporarily unavailable.", "ضروری سروس عارضی طور پر دستیاب نہیں ہے۔"),
}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return _error_response(exc)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [
            {
                "field": ".".join(str(part) for part in error.get("loc", ()) if part != "body"),
                "message": error.get("msg", ""),
                "type": error.get("type", ""),
            }
            for error in exc.errors()
        ]
        return _envelope(
            status_code=400,
            code="VALIDATION_ERROR",
            message_en="The request contains invalid or missing fields.",
            message_ur="درخواست میں غلط یا غائب معلومات ہیں۔",
            details={"fields": fields},
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail
        # Teammate routers raise HTTPException(detail={"error": {...}}); pass it through.
        if isinstance(detail, dict) and "error" in detail:
            error = dict(detail["error"])
            error.setdefault("request_id", get_request_id())
            error.setdefault("details", {})
            return JSONResponse(
                status_code=exc.status_code, content={"error": error}, headers=exc.headers or {}
            )
        code, message_en, message_ur = _STATUS_DEFAULTS.get(
            exc.status_code,
            ("INTERNAL_ERROR", "Something went wrong.", "کچھ غلط ہو گیا۔"),
        )
        return _envelope(
            status_code=exc.status_code,
            code=code,
            message_en=message_en,
            message_ur=message_ur,
            details={"detail": detail} if isinstance(detail, str) and detail else {},
            headers=exc.headers or {},
        )

    @app.exception_handler(Exception)
    async def _unhandled(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error", extra={"extra_fields": {"error": type(exc).__name__}})
        return _envelope(
            status_code=500,
            code="INTERNAL_ERROR",
            message_en="Something went wrong. Please try again.",
            message_ur="کچھ غلط ہو گیا۔ براہ کرم دوبارہ کوشش کریں۔",
        )


# --- routers ----------------------------------------------------------------


def _include_routers(app: FastAPI) -> None:
    from app.api.v1 import (
        admin_jobs,
        admin_keys,
        admin_mocks,
        admin_rules,
        admin_users,
        analytics,
        auditor,
        auth,
        cases,
        consent,
        documents,
        eval as eval_router,
        helper,
        me,
        officer,
        programs,
        public,
        rag,
        scam,
        transparency,
        voice,
    )

    api_prefix = "/api/v1"
    for module in (
        auth,
        programs,
        cases,
        documents,
        consent,
        me,
        helper,
        officer,
        admin_users,
        admin_keys,
        admin_jobs,
        admin_rules,
        admin_mocks,
        auditor,
        public,
        analytics,
        transparency,
        eval_router,
        voice,
        scam,
        rag,
    ):
        app.include_router(module.router, prefix=api_prefix)

    # Simulated DPI services live under /mock (A3 owns the router body).
    from app.mocks import router as mock_router

    app.include_router(mock_router.router, prefix="/mock")


# --- health -----------------------------------------------------------------


def _check_database() -> tuple[bool, str]:
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return True, "ok"
    except Exception as exc:  # noqa: BLE001
        return False, f"{type(exc).__name__}"
    finally:
        db.close()


def _check_worker() -> tuple[bool, str]:
    from app.jobs.worker import worker_is_stale

    db = SessionLocal()
    try:
        return (False, "stale") if worker_is_stale(db) else (True, "ok")
    except Exception as exc:  # noqa: BLE001
        return False, f"{type(exc).__name__}"
    finally:
        db.close()


def _check_uploads() -> tuple[bool, str]:
    try:
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        probe = settings.upload_dir / ".write-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True, "ok"
    except Exception as exc:  # noqa: BLE001
        return False, f"{type(exc).__name__}"


# --- app factory ------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    if settings.run_embedded_worker:
        from app.jobs.worker import start_embedded_worker

        start_embedded_worker()
    log_event(
        logger,
        "app.started",
        env=settings.app_env,
        ai_provider=settings.ai_provider,
        demo_mode=settings.demo_mode,
        embedded_worker=settings.run_embedded_worker,
    )
    try:
        yield
    finally:
        if settings.run_embedded_worker:
            from app.jobs.worker import stop_embedded_worker

            stop_embedded_worker()
        log_event(logger, "app.stopped")


def create_app() -> FastAPI:
    configure_logging(settings.log_level)

    app = FastAPI(
        title="Haqdaar API",
        version="1.0.0",
        description=(
            f"{PROTOTYPE_BANNER}\n\n"
            "Multi-tenant AI-assisted public benefit delivery, consent, audit and "
            "anti-scam platform. Every government service under `/mock/v1/*` is "
            "simulated and every citizen record is synthetic (CNIC prefix `99900`)."
        ),
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(RequestContextMiddleware)
    register_exception_handlers(app)
    _include_routers(app)

    @app.get("/health", tags=["ops"], summary="Liveness + dependency health")
    def health() -> Response:
        db_ok, db_detail = _check_database()
        worker_ok, worker_detail = _check_worker()
        uploads_ok, uploads_detail = _check_uploads()
        healthy = db_ok and uploads_ok
        body = {
            "status": "OK" if healthy else "DEGRADED",
            "database": db_detail,
            "worker": worker_detail,
            "uploads": uploads_detail,
            "detail": {
                "worker_heartbeat_stale": not worker_ok,
                "ai_provider": settings.ai_provider,
                "demo_mode": settings.demo_mode,
                "embedded_worker": settings.run_embedded_worker,
            },
        }
        return JSONResponse(status_code=200 if healthy else 503, content=body)

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, Any]:
        return {
            "name": "Haqdaar API",
            "prototype": True,
            "docs": "/api/docs",
            "openapi": "/api/openapi.json",
            "health": "/health",
        }

    # Serve the built PWA when the multi-stage image copied it in.
    if settings.static_dir.exists() and (settings.static_dir / "index.html").exists():
        from fastapi.staticfiles import StaticFiles

        app.mount("/", StaticFiles(directory=str(settings.static_dir), html=True), name="static")

    return app


app = create_app()


__all__ = ["PUBLIC_PATH_PREFIXES", "REQUEST_ID_HEADER", "app", "create_app"]
