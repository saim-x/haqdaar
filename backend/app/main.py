"""FastAPI application factory - middleware, error envelope, routers, health.

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
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings, upload_root
from app.db import SessionLocal
from app.security.context import (
    configure_logging,
    get_request_id,
    log_event,
    request_id_var,
)
from app.security.errors import ApiError
from app.security.ratelimit import check_ai_limit, check_otp_verify_limit, check_scam_limit

logger = logging.getLogger("app.main")

REQUEST_ID_HEADER = "X-Request-ID"
PROTOTYPE_BANNER = "Haqdaar prototype - simulated government services, synthetic data only"

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
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
            response.headers.setdefault("X-Frame-Options", "DENY")
            response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
            response.headers.setdefault(
                "Permissions-Policy", "camera=(self), microphone=(self), geolocation=()"
            )
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


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Anonymous per-IP limits for the public AI and OTP endpoints (docs/03 §6.3)."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if settings.rate_limit_enabled:
            path = request.url.path
            ip = _client_ip(request)
            try:
                if request.method == "POST" and path == "/api/v1/scam/check":
                    check_scam_limit(ip)
                elif request.method == "POST" and path == "/api/v1/auth/otp/verify":
                    check_otp_verify_limit(ip)
                elif request.method == "POST" and (
                    path.startswith("/api/v1/voice/")
                    or path.startswith("/api/v1/rag/")
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


def _coded_error_response(
    exc: StarletteHTTPException, code: object, detail: dict[str, object]
) -> JSONResponse:
    """Render ``HTTPException(detail={"error": "CODE", ...extras})`` as the envelope.

    Teammate routers raise this shape (``admin_mocks`` does). The code is kept
    verbatim and the remaining keys become ``details``, so a client sees the same
    structure as every other error.
    """
    _default_code, message_en, message_ur = _STATUS_DEFAULTS.get(
        exc.status_code,
        ("INTERNAL_ERROR", "Something went wrong.", "کچھ غلط ہو گیا۔"),
    )
    return _envelope(
        status_code=exc.status_code,
        code=str(code),
        message_en=message_en,
        message_ur=message_ur,
        details={key: value for key, value in detail.items() if key != "error"},
        headers=exc.headers or {},
    )


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
            raw = detail["error"]
            if not isinstance(raw, dict):
                return _coded_error_response(exc, raw, detail)
            error = dict(raw)
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
        avatar,
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
        avatar,
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
        probe = upload_root() / ".write-probe"
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

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER, "ETag", "X-Prototype"],
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

    @app.get(
        "/metrics",
        tags=["ops"],
        summary="Prometheus metrics",
        response_class=Response,
        include_in_schema=False,
    )
    def metrics() -> Response:
        """Prometheus text exposition.

        ``/health`` answers "is this instance able to serve?" for a load balancer.
        This answers "what is this instance doing?" for a dashboard, which is a
        different question and needs a different shape: counters and gauges that a
        scraper can diff over time, not a single boolean.

        Every series is derived from the database, so a metric cannot report a
        number the system does not actually hold. A failure to read returns the
        ``up`` gauge at 0 rather than an empty body - a scrape that silently
        returns nothing looks identical to a healthy instance with no traffic.
        """
        lines: list[str] = []

        def gauge(name: str, value: float, help_text: str, **labels: str) -> None:
            if not any(line.startswith(f"# HELP {name} ") for line in lines):
                lines.append(f"# HELP {name} {help_text}")
                lines.append(f"# TYPE {name} gauge")
            rendered = ",".join(f'{key}="{val}"' for key, val in labels.items())
            suffix = f"{{{rendered}}}" if rendered else ""
            lines.append(f"{name}{suffix} {value}")

        def counter(name: str, value: float, help_text: str, **labels: str) -> None:
            if not any(line.startswith(f"# HELP {name} ") for line in lines):
                lines.append(f"# HELP {name} {help_text}")
                lines.append(f"# TYPE {name} counter")
            rendered = ",".join(f'{key}="{val}"' for key, val in labels.items())
            suffix = f"{{{rendered}}}" if rendered else ""
            lines.append(f"{name}{suffix} {value}")

        db_ok, _ = _check_database()
        worker_ok, _ = _check_worker()
        uploads_ok, _ = _check_uploads()

        gauge("haqdaar_up", 1, "1 when the process is serving requests")
        gauge("haqdaar_database_up", int(db_ok), "1 when the database answers SELECT 1")
        gauge("haqdaar_worker_up", int(worker_ok), "1 when a worker heartbeat is fresh")
        gauge("haqdaar_uploads_writable", int(uploads_ok), "1 when the upload root is writable")

        db = SessionLocal()
        try:
            for tenant, status, count in db.execute(
                text(
                    "SELECT coalesce(t.code, 'platform'), c.status, count(*) "
                    "FROM cases c LEFT JOIN tenants t ON t.id = c.tenant_id "
                    "GROUP BY 1, 2"
                )
            ).all():
                counter(
                    "haqdaar_cases_total",
                    float(count),
                    "Cases by tenant and current status",
                    tenant=str(tenant),
                    status=str(status),
                )

            for tenant, route, count in db.execute(
                text(
                    "SELECT coalesce(t.code, 'platform'), d.route_action, count(*) "
                    "FROM decisions d LEFT JOIN tenants t ON t.id = d.tenant_id "
                    "GROUP BY 1, 2"
                )
            ).all():
                counter(
                    "haqdaar_decisions_total",
                    float(count),
                    "Decisions by tenant and route action",
                    tenant=str(tenant),
                    route=str(route),
                )

            audit_total = db.execute(text("SELECT count(*) FROM audit_events")).scalar() or 0
            counter("haqdaar_audit_events_total", float(audit_total), "Rows in the audit chain")

            chunks = db.execute(text("SELECT count(*) FROM rag_chunks")).scalar() or 0
            gauge("haqdaar_rag_chunks", float(chunks), "Indexed policy chunks")

            llm_calls = db.execute(
                text(
                    "SELECT count(*) FROM ai_telemetry "
                    "WHERE created_at > now() - interval '24 hours'"
                )
            ).scalar() or 0
            counter(
                "haqdaar_llm_calls_24h",
                float(llm_calls),
                "Model calls in the last 24 hours",
            )

            llm_failures = db.execute(
                text(
                    "SELECT count(*) FROM ai_telemetry "
                    "WHERE created_at > now() - interval '24 hours' AND succeeded IS FALSE"
                )
            ).scalar() or 0
            counter(
                "haqdaar_llm_failures_24h",
                float(llm_failures),
                "Failed model calls in the last 24 hours",
            )

            heartbeat_age = db.execute(
                text(
                    "SELECT EXTRACT(EPOCH FROM (now() - max(last_seen_at))) "
                    "FROM worker_heartbeats"
                )
            ).scalar()
            gauge(
                "haqdaar_worker_heartbeat_age_seconds",
                float(heartbeat_age) if heartbeat_age is not None else -1.0,
                "Seconds since the newest worker heartbeat, -1 when there has never been one",
            )
        except Exception as exc:  # noqa: BLE001
            # A metric that cannot be read must not take the endpoint down; the
            # `up` gauge already tells the scraper the instance is degraded.
            logger.warning("metrics query failed: %s", type(exc).__name__)
            gauge("haqdaar_metrics_errors", 1, "1 when a metrics query failed")
        finally:
            db.close()

        return Response(
            content="\n".join(lines) + "\n",
            media_type="text/plain; version=0.0.4; charset=utf-8",
        )

    # Serve the built PWA when the multi-stage image copied it in, with SPA history fallback.
    index_file = settings.static_dir / "index.html"
    if settings.static_dir.exists() and index_file.exists():
        from fastapi.staticfiles import StaticFiles

        assets_dir = settings.static_dir / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        @app.get("/", include_in_schema=False)
        def spa_root() -> Response:
            return FileResponse(index_file)

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa_fallback(full_path: str) -> Response:
            if full_path.startswith(("api/", "mock/", "health", "metrics")):
                raise StarletteHTTPException(status_code=404, detail="Not found")
            candidate = (settings.static_dir / full_path).resolve()
            static_root = settings.static_dir.resolve()
            if (
                candidate.is_file()
                and static_root in candidate.parents
            ):
                return FileResponse(candidate)
            return FileResponse(index_file)
    else:

        @app.get("/", include_in_schema=False)
        def root() -> dict[str, Any]:
            return {
                "name": "Haqdaar API",
                "prototype": True,
                "docs": "/api/docs",
                "openapi": "/api/openapi.json",
                "health": "/health",
                "metrics": "/metrics",
            }

    return app


app = create_app()


__all__ = ["PUBLIC_PATH_PREFIXES", "REQUEST_ID_HEADER", "app", "create_app"]
