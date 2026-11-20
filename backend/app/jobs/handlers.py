"""Job handler registry — lazy ``importlib`` so missing teammate modules never crash.

A handler that cannot be imported (module not merged yet) raises
:class:`HandlerUnavailable`, which the worker turns into ``FAILED_RETRY`` with a
clear error message. The API server and the worker always boot.
"""

from __future__ import annotations

import importlib
from collections.abc import Callable
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


class HandlerUnavailable(RuntimeError):
    """The handler module or function is not present in this checkout yet."""


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
    return handler(db, **payload)


__all__ = ["HANDLER_REGISTRY", "HandlerUnavailable", "resolve_handler", "run_handler"]
