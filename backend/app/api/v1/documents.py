"""Document upload, verification and consent-gated download — docs/05 §3.3."""

from __future__ import annotations

import hashlib
import importlib
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings, upload_root
from app.db import get_db
from app.jobs.queue import enqueue_job
from app.models.cases import Case, Document
from app.models.enums import (
    ConsentPurpose,
    DataCategory,
    DocumentType,
    DocVerifyStatus,
    JobType,
    UserRole,
)
from app.schemas.serializers import document_to_dict
from app.security import audit
from app.security.consent import enforce_consent
from app.security.errors import (
    FileTooLargeError,
    NotFoundError,
    UnsupportedMediaTypeError,
    ValidationError,
)
from app.security.idempotency import get_idempotency_key, remember, replay
from app.security.rbac import (
    ActorContext,
    assert_tenant_scope,
    get_act_for_citizen,
    require_roles,
    resolve_citizen_scope,
)

router = APIRouter(prefix="/documents", tags=["documents"])

DbSession = Annotated[Session, Depends(get_db)]
UploaderActor = Annotated[ActorContext, Depends(require_roles(UserRole.CITIZEN, UserRole.HELPER))]
DocumentReader = Annotated[
    ActorContext,
    Depends(require_roles(UserRole.CITIZEN, UserRole.HELPER, UserRole.OFFICER, UserRole.AUDITOR)),
]

ALLOWED_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp", "application/pdf"})
SYNC_VERIFY_BUDGET_SECONDS = 4.0


def _now() -> datetime:
    return datetime.now(UTC)


def _audit_actor(actor: ActorContext) -> dict[str, Any]:
    return {
        "actor_type": actor.actor_type,
        "actor_id": actor.actor_id_str,
        "actor_role": actor.role_value,
    }


def _storage_root() -> Path:
    """The one upload directory — the same one ``app/ai/doc_verify.py`` reads."""
    return upload_root()


def _load_document(db: Session, document_id: uuid.UUID) -> Document:
    document = db.get(Document, document_id)
    if document is None:
        raise NotFoundError()
    return document


def _authorise_document_read(
    db: Session, document: Document, actor: ActorContext, *, act_for: uuid.UUID | None
) -> None:
    role = actor.role_value
    if role in {UserRole.CITIZEN.value, UserRole.HELPER.value}:
        citizen_id = resolve_citizen_scope(db, actor, act_for)
        if document.citizen_id != citizen_id:
            raise NotFoundError()
        purpose = (
            ConsentPurpose.HELPER_ASSISTANCE
            if role == UserRole.HELPER.value
            else ConsentPurpose.BENEFIT_APPLICATION
        )
    else:
        assert_tenant_scope(
            db, actor, document.tenant_id, resource_type="document", resource_id=document.id
        )
        purpose = ConsentPurpose.BENEFIT_APPLICATION

    enforce_consent(
        db,
        citizen_id=document.citizen_id,
        actor=actor,
        category=DataCategory.DOCUMENTS,
        purpose=purpose,
        resource_ref=f"document:{document.id}",
    )


def _try_sync_verify(db: Session, document: Document) -> dict[str, Any] | None:
    """Run A4's verifier inline when it is importable and finishes inside the budget.

    ``app.ai.doc_verify.verify_document(db, document_id)`` persists the outcome
    itself, so the caller only has to refresh the row. A missing module or a slow
    run degrades to the ``VERIFY_DOCUMENT`` job — upload never fails because of it.
    """
    try:
        module = importlib.import_module("app.ai.doc_verify")
    except Exception:  # noqa: BLE001 - absent module is an expected state
        return None

    verify = getattr(module, "verify_document", None)
    if verify is None:
        return None

    started = time.monotonic()
    try:
        result = verify(db, document.id)
    except Exception:  # noqa: BLE001 - a verifier crash degrades to async
        return None

    if time.monotonic() - started > SYNC_VERIFY_BUDGET_SECONDS:
        return None
    return result if isinstance(result, dict) else None


@router.post("", status_code=201, summary="Upload a document and verify it")
async def upload_document(
    request: Request,
    response: Response,
    actor: UploaderActor,
    db: DbSession,
    file: Annotated[UploadFile, File()],
    doc_type: Annotated[str, Form()],
    case_id: Annotated[str | None, Form()] = None,
) -> dict[str, Any]:
    settings = get_settings()

    if doc_type not in {item.value for item in DocumentType}:
        raise ValidationError(
            details={"fields": [{"field": "doc_type", "reason": "INVALID_VALUE"}]}
        )

    act_for = get_act_for_citizen(request)
    citizen_id = resolve_citizen_scope(db, actor, act_for)

    case: Case | None = None
    if case_id:
        try:
            case_uuid = uuid.UUID(case_id)
        except ValueError as exc:
            raise ValidationError(
                details={"fields": [{"field": "case_id", "reason": "INVALID_UUID"}]}
            ) from exc
        case = db.get(Case, case_uuid)
        if case is None or case.citizen_id != citizen_id:
            raise NotFoundError()

    idem_key = get_idempotency_key(request)
    idem_payload = {"doc_type": doc_type, "case_id": case_id, "filename": file.filename}
    path_key = "/api/v1/documents"
    cached = replay(
        db, key=idem_key, user_id=actor.user_id, method="POST", path=path_key, payload=idem_payload
    )
    if cached is not None:
        response.status_code = cached.status_code
        return cached.body

    enforce_consent(
        db,
        citizen_id=citizen_id,
        actor=actor,
        category=DataCategory.DOCUMENTS,
        purpose=ConsentPurpose.HELPER_ASSISTANCE
        if actor.role_value == UserRole.HELPER.value
        else ConsentPurpose.BENEFIT_APPLICATION,
        resource_ref=f"case:{case.id}" if case else f"citizen:{citizen_id}",
    )

    mime_type = (file.content_type or "").split(";")[0].strip().lower()
    if mime_type not in ALLOWED_MIME_TYPES:
        raise UnsupportedMediaTypeError(details={"content_type": mime_type or None})

    raw = await file.read()
    if len(raw) > settings.max_image_upload_bytes:
        raise FileTooLargeError(
            details={"size_bytes": len(raw), "max_bytes": settings.max_image_upload_bytes}
        )
    if not raw:
        raise ValidationError(
            details={"fields": [{"field": "file", "reason": "EMPTY_FILE"}]}
        )

    tenant_id = case.tenant_id if case else _tenant_for_citizen(db, citizen_id)
    document_id = uuid.uuid4()
    suffix = Path(file.filename or "").suffix.lower()[:8] or ".bin"
    relative = Path(str(tenant_id)) / str(citizen_id) / f"{document_id}{suffix}"
    absolute = _storage_root() / relative
    absolute.parent.mkdir(parents=True, exist_ok=True)
    absolute.write_bytes(raw)

    document = Document(
        id=document_id,
        tenant_id=tenant_id,
        citizen_id=citizen_id,
        case_id=case.id if case else None,
        doc_type=doc_type,
        storage_path=str(relative).replace("\\", "/"),
        mime_type=mime_type,
        size_bytes=len(raw),
        sha256_hash=hashlib.sha256(raw).hexdigest(),
        verify_status=DocVerifyStatus.PENDING.value,
        extracted_fields={},
        verify_checks=[],
        uploaded_by_user_id=actor.user_id,
    )
    db.add(document)
    db.flush()

    audit.record(
        db,
        action="document.uploaded",
        resource_type="document",
        resource_id=document.id,
        tenant_id=document.tenant_id,
        payload={
            "document_id": str(document.id),
            "case_id": str(document.case_id) if document.case_id else None,
            "doc_type": document.doc_type,
            "size_bytes": document.size_bytes,
            "sha256": document.sha256_hash,
        },
        **_audit_actor(actor),
    )

    result = _try_sync_verify(db, document)
    if result is not None:
        db.refresh(document)
        audit.record(
            db,
            action="document.verified",
            resource_type="document",
            resource_id=document.id,
            tenant_id=document.tenant_id,
            payload={
                "document_id": str(document.id),
                "verify_status": document.verify_status,
                "mode": "SYNC",
            },
            actor_type="SYSTEM",
            actor_role="SYSTEM",
        )
    else:
        enqueue_job(
            db,
            JobType.VERIFY_DOCUMENT.value,
            {
                "document_id": str(document.id),
                "case_id": str(document.case_id) if document.case_id else None,
                "tenant_id": str(document.tenant_id),
            },
            dedup_key=f"VERIFY_DOCUMENT:{document.id}",
        )

    body = document_to_dict(document)
    body["verification_mode"] = "SYNC" if result is not None else "ASYNC"
    remember(
        db,
        key=idem_key,
        user_id=actor.user_id,
        method="POST",
        path=path_key,
        payload=idem_payload,
        status_code=201,
        body=body,
    )
    db.commit()
    response.status_code = 201
    return body


def _tenant_for_citizen(db: Session, citizen_id: uuid.UUID) -> uuid.UUID:
    """Tenant of the citizen's most recent case, else the first active tenant."""
    from app.models.identity import Tenant

    tenant_id = db.execute(
        select(Case.tenant_id)
        .where(Case.citizen_id == citizen_id)
        .order_by(Case.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if tenant_id is not None:
        return tenant_id
    fallback = db.execute(
        select(Tenant.id).where(Tenant.is_active.is_(True)).order_by(Tenant.code.asc()).limit(1)
    ).scalar_one_or_none()
    if fallback is None:
        raise NotFoundError()
    return fallback


@router.get("/{document_id}", summary="Document metadata and verification checks")
def get_document(
    document_id: uuid.UUID,
    request: Request,
    actor: DocumentReader,
    db: DbSession,
) -> dict[str, Any]:
    document = _load_document(db, document_id)
    act_for = get_act_for_citizen(request)
    _authorise_document_read(db, document, actor, act_for=act_for)
    body = document_to_dict(document)
    db.commit()
    return body


@router.get("/{document_id}/file", summary="Stream the stored image (consent-gated)")
def download_document(
    document_id: uuid.UUID,
    request: Request,
    actor: DocumentReader,
    db: DbSession,
) -> FileResponse:
    document = _load_document(db, document_id)
    act_for = get_act_for_citizen(request)
    _authorise_document_read(db, document, actor, act_for=act_for)

    absolute = _storage_root() / document.storage_path
    if not absolute.is_file():
        raise NotFoundError()

    audit.record(
        db,
        action="document.downloaded",
        resource_type="document",
        resource_id=document.id,
        tenant_id=document.tenant_id,
        payload={"document_id": str(document.id), "case_id": str(document.case_id) if document.case_id else None},
        **_audit_actor(actor),
    )
    db.commit()

    return FileResponse(
        path=absolute,
        media_type=document.mime_type,
        filename=f"{document.doc_type.lower()}{absolute.suffix}",
        headers={"Cache-Control": "private, no-store"},
    )


__all__ = ["router"]
