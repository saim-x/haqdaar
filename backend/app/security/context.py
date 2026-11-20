"""Request-scoped context (``X-Request-ID``) and single-line JSON logging.

docs/03 §6.1: every request gets a request id in a contextvar, echoed in the
response header and in every log line and audit event. Log records are JSON on
one line and pass through :func:`app.security.masking.redact_payload`.
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from app.security.masking import redact_payload, scrub_text

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
actor_id_var: ContextVar[str | None] = ContextVar("actor_id", default=None)
tenant_id_var: ContextVar[str | None] = ContextVar("tenant_id", default=None)


def get_request_id() -> str | None:
    return request_id_var.get()


def set_request_id(value: str) -> None:
    request_id_var.set(value)


def set_actor_context(actor_id: str | None, tenant_id: str | None) -> None:
    actor_id_var.set(actor_id)
    tenant_id_var.set(tenant_id)


class JsonFormatter(logging.Formatter):
    """Single-line JSON log records with PII redaction applied to extras."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
            "request_id": request_id_var.get(),
            "actor_id": actor_id_var.get(),
            "tenant_id": tenant_id_var.get(),
        }
        for key, value in getattr(record, "extra_fields", {}).items():
            payload[key] = value
        if record.exc_info:
            payload["error"] = scrub_text(self.formatException(record.exc_info))
        return json.dumps(redact_payload(payload), ensure_ascii=False, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    # Uvicorn's own access log duplicates our structured request log.
    logging.getLogger("uvicorn.access").disabled = True
    for noisy in ("httpx", "httpcore", "openai"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def log_event(logger: logging.Logger, event: str, level: int = logging.INFO, **fields: Any) -> None:
    """Emit one structured line. ``fields`` are redacted before serialisation."""
    logger.log(level, event, extra={"extra_fields": fields})


__all__ = [
    "JsonFormatter",
    "configure_logging",
    "get_request_id",
    "log_event",
    "request_id_var",
    "set_actor_context",
    "set_request_id",
]
