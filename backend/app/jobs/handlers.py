"""Job handler registry — lazy ``importlib`` so missing teammate modules never crash.

A handler that cannot be imported (module not merged yet) raises
:class:`HandlerUnavailable`, which the worker turns into ``FAILED_RETRY`` with a
clear error message. The API server and the worker always boot.
"""

from __future__ import annotations

import importlib
from collections.abc import Callable, Mapping
from typing import Any

from sqlalchemy.orm import Session

from app.models.enums import JobType

#: ``job_type -> (module_path, function_name)``. Pinned by docs/14 (A1 contracts).
HANDLER_REGISTRY: dict[str, tuple[str, str]] = {
    JobType.PROCESS_CASE.value: ("app.agent.case_agent", "run_case_agent"),
    JobType.CHECK_COMPLAINT.value: ("app.agent.case_agent", "check_complaint_agent"),
    JobType.VERIFY_DOCUMENT.value: ("app.ai.doc_verify", "verify_document"),
    JobType.REINDEX_RAG.value: ("app.ai.rag", "reindex_program_rules"),
    JobType.INITIATE_PAYMENT.value: ("app.jobs.payment_runner", "run_payment"),
}

#: The keyword arguments each pinned handler actually accepts.
#:
#: Job payloads carry queue bookkeeping the handler has no business knowing about:
#: ``tenant_id`` is derivable from the case row, ``parent_case_id`` from the
#: complaint row, ``rule_version_id`` from the program. Passing them straight
#: through raised ``TypeError: run_case_agent() got an unexpected keyword argument
#: 'tenant_id'``, which the worker turned into ``FAILED_RETRY`` — so every case sat
#: in ``SUBMITTED`` forever. The dispatcher filters to these keys instead of
#: widening the handlers' signatures, which would leak queue concerns into the
#: agent layer and break the pinned contract in docs/14.
#:
#: ``client`` is deliberately absent: it is a test-only injection point, and a job
#: payload arrives as JSONB, so a ``client`` key could only ever be a dict.
HANDLER_PAYLOAD_KEYS: dict[str, tuple[str, ...]] = {
    JobType.PROCESS_CASE.value: ("case_id", "correlation_id"),
    JobType.CHECK_COMPLAINT.value: ("case_id", "correlation_id"),
    JobType.VERIFY_DOCUMENT.value: ("document_id",),
    JobType.REINDEX_RAG.value: ("program_id",),
    JobType.INITIATE_PAYMENT.value: ("case_id", "decision_id", "amount_pkr"),
}


class HandlerUnavailable(RuntimeError):
    """The handler module or function is not present in this checkout yet."""


def normalize_payload(job_type: str, payload: Mapping[str, Any] | None) -> dict[str, Any]:
    """Reduce a stored job payload to the keys its pinned handler accepts.

    Unknown job types pass through untouched so a future handler is not silently
    starved of its arguments; the registry lookup will fail loudly anyway.
    """
    accepted = HANDLER_PAYLOAD_KEYS.get(str(job_type))
    if accepted is None:
        return dict(payload or {})
    return {key: value for key, value in (payload or {}).items() if key in accepted}


def resolve_handler(job_type: str) -> Callable[..., Any]:
    """Import and return the handler for ``job_type`` (lazy, cached by importlib)."""
    entry = HANDLER_REGISTRY.get(str(job_type))
    if entry is None:
        raise HandlerUnavailable(f"no handler registered for job_type={job_type!r}")

    module_path, function_name = entry
    try:
        module = importlib.import_module(module_path)
    except ModuleNotFoundError as exc:
        raise HandlerUnavailable(
            f"handler module {module_path!r} for job_type={job_type!r} is not available: {exc}"
        ) from exc

    handler = getattr(module, function_name, None)
    if handler is None or not callable(handler):
        raise HandlerUnavailable(
            f"{module_path}.{function_name} for job_type={job_type!r} is missing or not callable"
        )
    return handler


def run_handler(db: Session, job_type: str, payload: dict[str, Any]) -> Any:
    """Execute one job payload through its registered handler."""
    handler = resolve_handler(job_type)
    return handler(db, **normalize_payload(job_type, payload))


__all__ = [
    "HANDLER_PAYLOAD_KEYS",
    "HANDLER_REGISTRY",
    "HandlerUnavailable",
    "normalize_payload",
    "resolve_handler",
    "run_handler",
]
