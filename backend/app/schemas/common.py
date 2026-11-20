"""Shared response envelopes (docs/05 §1–2)."""

from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """Pagination envelope: ``{items, total, limit, offset}``."""

    items: list[T]
    total: int
    limit: int = 20
    offset: int = 0


class ErrorBody(BaseModel):
    code: str
    message_en: str
    message_ur: str
    request_id: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorEnvelope(BaseModel):
    """The only error shape the API ever returns (docs/05 §2)."""

    error: ErrorBody


class OkResponse(BaseModel):
    ok: bool = True


class HealthResponse(BaseModel):
    status: str
    database: str
    worker: str
    uploads: str
    detail: dict[str, Any] = Field(default_factory=dict)


__all__ = ["ErrorBody", "ErrorEnvelope", "HealthResponse", "OkResponse", "Page"]
