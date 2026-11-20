"""Program catalogue — docs/05 §3.2."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.enums import UserRole
from app.models.identity import Program
from app.security.rbac import ActorContext, require_roles

router = APIRouter(prefix="/programs", tags=["programs"])

DbSession = Annotated[Session, Depends(get_db)]
AnyActor = Annotated[
    ActorContext,
    Depends(
        require_roles(
            UserRole.CITIZEN,
            UserRole.HELPER,
            UserRole.OFFICER,
            UserRole.ADMIN,
            UserRole.AUDITOR,
        )
    ),
]


def _program_json(program: Program) -> dict[str, Any]:
    return {
        "id": str(program.id),
        "code": program.code,
        "name": program.name,
        "name_ur": program.name_ur,
        "description": program.description,
        "description_ur": program.description_ur,
        "required_documents": program.required_documents or [],
        "wizard_schema": program.wizard_schema or {},
        "active_rule_version_id": str(program.active_rule_version_id)
        if program.active_rule_version_id
        else None,
        "tenant_id": str(program.tenant_id),
    }


@router.get("", summary="List active programs with wizard schema")
def list_programs(actor: AnyActor, db: DbSession) -> dict[str, Any]:
    query = select(Program).where(Program.is_active.is_(True))
    # Staff see their own tenant's programmes; citizens/helpers/auditors see all.
    if actor.role_value in (UserRole.OFFICER.value, UserRole.ADMIN.value) and not actor.is_platform_admin:
        if actor.tenant_id is not None:
            query = query.where(Program.tenant_id == actor.tenant_id)
    programs = db.execute(query.order_by(Program.created_at.asc())).scalars().all()
    return {"items": [_program_json(program) for program in programs], "total": len(programs)}


__all__ = ["router"]
