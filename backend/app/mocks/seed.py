"""Deterministic synthetic seed for the Haqdaar demo world (docs/10 §2).

Creates, in one transaction:

* 2 tenants (``SPD``, ``ZWB``) and 2 config-driven programs
  (``SAHARA_WIDOW_GRANT`` with the exact docs/06 §2.1 rule set, and
  ``GUZARA_ALLOWANCE`` v1 - pure configuration, zero program-specific Python).
* The 9 demo personas with their exact credentials, phones and CNICs.
* Helper Ayesha's 8 linked families with active ``HELPER`` consent grants.
* Mock registries carrying realistic drift: ``Mst. Fatima Bibi`` vs
  ``Fatima Bibi``, the forged-name source, deceased records, the
  ``Muhammad``/``Mohammad`` Akram duplicate pair, the shared-payout-alias trio
  and the dormant alias.
* 60 historical decided SPD cases (Digital Twin fodder: incomes 15k–45k,
  children 0–5, exactly 10 cases in the 35k–40k band so a 40k→35k rule change
  flips a realistic 8–12 cases) plus 10 ZWB cases proving tenant isolation.
* The 6 showcase queue cases ``HQ-2026-000101..106`` with the exact flags,
  severities and confidences from docs/10 §2.

Usage::

    python -m app.mocks.seed --reset      # wipe + reseed (demo reset target)
    python -m app.mocks.seed --if-empty   # seed only when the DB is empty

Everything is deterministic (RNG seed ``20261120``) and every CNIC starts with
the reserved fictional prefix ``99900``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import random
import shutil
import time
import uuid
from collections.abc import Iterable, Sequence
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.mocks import seed_data as sd
from app.mocks.models import (
    MockBenefit,
    MockCivilDeath,
    MockComplaint,
    MockHousehold,
    MockIdentity,
    MockPayment,
    MockServiceConfig,
)
from app.mocks.payout_aliases import DORMANT_ALIAS, SHARED_PAYOUT_ALIAS

logger = logging.getLogger("haqdaar.mocks.seed")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEMO_DOCS_DIR = DATA_DIR / "demo_docs"

#: Child → parent deletion order for a clean demo reset.
_RESET_ORDER: tuple[str, ...] = (
    "audit_events",
    "decisions",
    "case_notes",
    "payments",
    "documents",
    "notifications",
    "scam_checks",
    "consent_access_logs",
    "consent_events",
    "consent_grants",
    "data_correction_requests",
    "simulation_runs",
    "cases",
    "citizens",
    "rule_versions",
    "programs",
    "api_keys",
    "refresh_tokens",
    "otp_challenges",
    "users",
    "tenants",
    "jobs",
    "idempotency_keys",
    "rag_chunks",
    "rag_documents",
    "ai_telemetry",
    "worker_heartbeats",
)


class SeedError(RuntimeError):
    """Raised when the application schema is not available yet."""


# --------------------------------------------------------------------------- #
# schema access (Core-level so A1's class names cannot break the seeder)
# --------------------------------------------------------------------------- #
def _metadata() -> Any:
    try:
        from app.db import Base
    except Exception as exc:  # pragma: no cover - only before A1 lands
        raise SeedError("app.db.Base is not available yet") from exc

    try:
        import app.models  # noqa: F401
    except Exception as exc:  # pragma: no cover
        raise SeedError("app.models is not importable yet") from exc

    try:
        import importlib
        import pkgutil

        import app.models as models_pkg

        if hasattr(models_pkg, "__path__"):
            for module in pkgutil.iter_modules(models_pkg.__path__):
                try:
                    importlib.import_module(f"app.models.{module.name}")
                except Exception:  # pragma: no cover - best effort
                    continue
    except Exception:  # pragma: no cover
        pass
    return Base.metadata


def _table(metadata: Any, name: str) -> Any:
    table = metadata.tables.get(name)
    if table is None:
        raise SeedError(f"table '{name}' is missing from the application metadata")
    return table


def _insert(db: Session, metadata: Any, name: str, rows: Sequence[dict[str, Any]]) -> None:
    if rows:
        db.execute(_table(metadata, name).insert(), list(rows))


def _delete_all(db: Session, metadata: Any, names: Iterable[str]) -> None:
    for name in names:
        table = metadata.tables.get(name)
        if table is not None:
            db.execute(delete(table))


# --------------------------------------------------------------------------- #
# audit helper
# --------------------------------------------------------------------------- #
def _record_audit(
    db: Session,
    metadata: Any,
    *,
    action: str,
    resource_type: str,
    resource_id: str | None,
    payload: dict[str, Any],
    tenant_id: uuid.UUID | None = None,
    actor_type: str = "SYSTEM",
    actor_id: str | None = "seed",
    actor_role: str | None = None,
) -> None:
    """Write one hash-chained audit event, preferring BE's writer."""
    try:  # pragma: no cover - depends on A1 landing
        from app.security import audit as audit_module  # type: ignore

        audit_module.record(
            db,
            tenant_id=tenant_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_role=actor_role,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            payload=payload,
        )
        return
    except Exception:
        pass

    table = metadata.tables.get("audit_events")
    if table is None:  # pragma: no cover
        return
    last = db.execute(
        select(table.c.seq, table.c.event_hash).order_by(table.c.seq.desc()).limit(1)
    ).first()
    prev_hash = last.event_hash if last else "GENESIS"
    seq = (last.seq + 1) if last else 1
    created_at = datetime.now(UTC)
    event_hash = hashlib.sha256(
        "|".join(
            [
                prev_hash,
                str(seq),
                created_at.isoformat(),
                action,
                resource_type,
                resource_id or "",
                sd.canonical_json(payload),
            ]
        ).encode("utf-8")
    ).hexdigest()
    db.execute(
        table.insert(),
        [
            {
                "seq": seq,
                "id": sd.uid(f"audit:{seq}:{action}:{resource_id}"),
                "tenant_id": tenant_id,
                "actor_type": actor_type,
                "actor_id": actor_id,
                "actor_role": actor_role,
                "action": action,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "request_id": None,
                "payload_json": payload,
                "prev_hash": prev_hash,
                "event_hash": event_hash,
                "created_at": created_at,
            }
        ],
    )


# --------------------------------------------------------------------------- #
# seed sections
# --------------------------------------------------------------------------- #
def _seed_tenants(db: Session, metadata: Any) -> dict[str, uuid.UUID]:
    rows = [
        {
            "id": sd.uid(f"tenant:{t['code']}"),
            "code": t["code"],
            "name": t["name"],
            "name_ur": t["name_ur"],
            "is_active": True,
            "created_at": datetime(2026, 11, 20, 13, 0, tzinfo=UTC),
        }
        for t in sd.TENANTS
    ]
    _insert(db, metadata, "tenants", rows)
    return {t["code"]: sd.uid(f"tenant:{t['code']}") for t in sd.TENANTS}


def _seed_users(db: Session, metadata: Any, tenants: dict[str, uuid.UUID]) -> dict[str, uuid.UUID]:
    password_hash = sd.hash_password(sd.DEMO_PASSWORD)
    rows: list[dict[str, Any]] = []
    ids: dict[str, uuid.UUID] = {}
    for persona in sd.PERSONAS:
        user_id = sd.uid(f"user:{persona.key}")
        ids[persona.key] = user_id
        rows.append(
            {
                "id": user_id,
                "tenant_id": tenants.get(persona.tenant_code) if persona.tenant_code else None,
                "role": persona.role,
                "email": persona.email,
                "phone": persona.phone,
                "password_hash": password_hash if persona.email else None,
                "full_name": persona.full_name,
                "preferred_lang": persona.preferred_lang,
                "is_active": True,
                "created_at": datetime(2026, 11, 20, 13, 5, tzinfo=UTC),
            }
        )
    _insert(db, metadata, "users", rows)
    return ids


def _seed_citizens(db: Session, metadata: Any, users: dict[str, uuid.UUID]) -> dict[str, uuid.UUID]:
    """Citizen profiles for the personas plus the demo cast."""
    rows: list[dict[str, Any]] = []
    ids: dict[str, uuid.UUID] = {}
    now = datetime(2026, 11, 20, 13, 10, tzinfo=UTC)

    def add(
        key: str,
        full_name: str,
        *,
        cnic_value: str | None,
        phone: str | None,
        district: str | None,
        user_id: uuid.UUID | None = None,
        dob: str | None = None,
        created_by: uuid.UUID | None = None,
        avatar: str = "#0E6A60",
        profile: dict[str, Any] | None = None,
    ) -> uuid.UUID:
        citizen_id = sd.uid(f"citizen:{key}")
        ids[key] = citizen_id
        rows.append(
            {
                "id": citizen_id,
                "user_id": user_id,
                "full_name": full_name,
                "cnic_digits": cnic_value,
                "phone": phone,
                "district": district,
                "dob": date.fromisoformat(dob) if dob else None,
                "avatar_color": avatar,
                "profile_data": profile or {},
                "created_by_user_id": created_by,
                "created_at": now,
                "updated_at": now,
            }
        )
        return citizen_id

    add(
        "widow_fatima",
        "Fatima Bibi",
        cnic_value=sd.cnic(12),
        phone="+923001000001",
        district="Thatta",
        user_id=users["widow_fatima"],
        dob="1974-05-14",
        profile={
            "spouse_full_name": "Ghulam Rasool",
            "spouse_cnic": sd.cnic(104),
            "children_under_18": 3,
            "household_size": 4,
            "monthly_income_pkr": 28000,
            "payout_phone": "+923001000001",
            "preferred_lang": "ur",
        },
    )
    add(
        "shopkeeper_rasool",
        "Rasool Bakhsh",
        cnic_value=sd.cnic(21),
        phone="+923001000002",
        district="Hyderabad",
        user_id=users["shopkeeper_rasool"],
        dob="1981-03-09",
        profile={"preferred_lang": "ur"},
    )
    add(
        "helper_ayesha",
        "Ayesha Khatoon",
        cnic_value=sd.cnic(32),
        phone="+923001000003",
        district="Thatta",
        user_id=users["helper_ayesha"],
        dob="1992-07-18",
        profile={"preferred_lang": "ur", "helper": True},
    )

    for index, (name, cnic_value, district, phone) in enumerate(sd.AYESHA_FAMILIES):
        add(
            f"family_{index + 1}",
            name,
            cnic_value=cnic_value,
            phone=phone,
            district=district,
            created_by=users["helper_ayesha"],
            avatar=["#B45309", "#7C3AED", "#0E7490", "#BE123C", "#4D7C0F", "#1D4ED8", "#A21CAF"][index],
            profile={
                "children_under_18": index % 4,
                "household_size": 3 + index % 4,
                "monthly_income_pkr": 18000 + index * 1500,
            },
        )

    add(
        "forged_applicant",
        sd.FORGED_APPLICANT[0],
        cnic_value=sd.FORGED_APPLICANT[1],
        phone=sd.FORGED_APPLICANT[3],
        district=sd.FORGED_APPLICANT[2],
        dob="1979-02-11",
        profile={"children_under_18": 2, "household_size": 4, "monthly_income_pkr": 22000},
    )
    add(
        "income_conflict",
        "Sakina Bibi",
        cnic_value=sd.cnic(209),
        phone="+923001000012",
        district="Badin",
        dob="1980-09-02",
        profile={"children_under_18": 3, "household_size": 5, "monthly_income_pkr": 24000},
    )
    add(
        "akram_ambiguous",
        "Muhammad Akram",
        cnic_value=None,
        phone="+923001000013",
        district="Hyderabad",
        dob=None,
        profile={"children_under_18": 1, "household_size": 3, "monthly_income_pkr": 26000},
    )
    for index, (name, cnic_value, district) in enumerate(sd.SHARED_ALIAS_TRIO):
        add(
            f"shared_alias_{index + 1}",
            name,
            cnic_value=cnic_value,
            phone=f"+9230010000{14 + index}",
            district=district,
            dob=f"19{78 + index}-0{index + 3}-1{index}",
            profile={
                "children_under_18": 2,
                "household_size": 4,
                "monthly_income_pkr": 21000,
                "payout_phone": SHARED_PAYOUT_ALIAS,
            },
        )
    add(
        "low_assurance",
        "Shahida Bibi",
        cnic_value=sd.cnic(214),
        phone="+923001000017",
        district="Thatta",
        created_by=users["helper_ayesha"],
        dob="1973-10-14",
        profile={"children_under_18": 4, "household_size": 6, "monthly_income_pkr": 19000},
    )
    add(
        "payment_failed",
        "Razia Bibi",
        cnic_value=sd.cnic(215),
        phone="+923001000018",
        district="Thatta",
        dob="1981-08-09",
        profile={
            "children_under_18": 2,
            "household_size": 4,
            "monthly_income_pkr": 20000,
            "payout_phone": DORMANT_ALIAS,
        },
    )
    _insert(db, metadata, "citizens", rows)
    return ids


def _seed_programs(
    db: Session, metadata: Any, tenants: dict[str, uuid.UUID], admin_id: uuid.UUID
) -> dict[str, dict[str, Any]]:
    now = datetime(2026, 11, 20, 13, 15, tzinfo=UTC)
    specs = [
        {
            "code": "SAHARA_WIDOW_GRANT",
            "tenant": "SPD",
            "name": "Sahara Widow Support Grant",
            "name_ur": "سہارا بیوہ امدادی گرانٹ",
            "description": "Monthly support for widowed women in low-income Sindh households (simulated prototype).",
            "description_ur": "سندھ کے کم آمدنی والے گھرانوں کی بیوہ خواتین کے لیے ماہانہ امداد (نقلی نمونہ)۔",
            "rules": sd.SAHARA_RULES_V1,
            "documents": ["CNIC_FRONT", "SPOUSE_DEATH_CERTIFICATE"],
        },
        {
            "code": "GUZARA_ALLOWANCE",
            "tenant": "ZWB",
            "name": "Guzara Allowance",
            "name_ur": "گزرا الاؤنس",
            "description": "Zakat & Welfare Board subsistence allowance for households below the poverty threshold (simulated prototype).",
            "description_ur": "زکوٰۃ و بہبود بورڈ کا گزر بسر الاؤنس غربت کی حد سے نیچے والے گھرانوں کے لیے (نقلی نمونہ)۔",
            "rules": sd.GUZARA_RULES_V1,
            "documents": ["CNIC_FRONT"],
        },
    ]

    program_rows: list[dict[str, Any]] = []
    rule_rows: list[dict[str, Any]] = []
    out: dict[str, dict[str, Any]] = {}
    for spec in specs:
        program_id = sd.uid(f"program:{spec['code']}")
        rule_id = sd.uid(f"rule:{spec['code']}:v1")
        program_rows.append(
            {
                "id": program_id,
                "tenant_id": tenants[spec["tenant"]],
                "code": spec["code"],
                "name": spec["name"],
                "name_ur": spec["name_ur"],
                "description": spec["description"],
                "description_ur": spec["description_ur"],
                "required_documents": spec["documents"],
                "wizard_schema": sd.wizard_schema(spec["code"]),
                "active_rule_version_id": rule_id,
                "is_active": True,
                "created_at": now,
            }
        )
        rule_rows.append(
            {
                "id": rule_id,
                "tenant_id": tenants[spec["tenant"]],
                "program_id": program_id,
                "version_number": 1,
                "status": "PUBLISHED",
                "rules_json": spec["rules"],
                "content_hash": sd.content_hash(spec["rules"]),
                "change_note": "Initial published rule set (seeded).",
                "created_by_user_id": admin_id,
                "published_by_user_id": admin_id,
                "published_at": now,
                "created_at": now,
            }
        )
        out[spec["code"]] = {
            "id": program_id,
            "rule_id": rule_id,
            "rules": spec["rules"],
            "tenant_id": tenants[spec["tenant"]],
        }

    _insert(db, metadata, "programs", program_rows)
    _insert(db, metadata, "rule_versions", rule_rows)
    return out


def _seed_consent(
    db: Session,
    metadata: Any,
    citizens: dict[str, uuid.UUID],
    users: dict[str, uuid.UUID],
    tenants: dict[str, uuid.UUID],
) -> None:
    now = datetime(2026, 11, 20, 13, 20, tzinfo=UTC)
    grants: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []

    def grant(
        key: str,
        citizen_key: str,
        *,
        recipient_type: str,
        tenant_code: str | None = None,
        helper_key: str | None = None,
        assurance: str = "SELF_OTP",
        categories: Sequence[str] = ("IDENTITY", "HOUSEHOLD", "DOCUMENTS", "PAYMENT", "CASE_HISTORY"),
        purposes: Sequence[str] = ("BENEFIT_APPLICATION", "PAYMENT_DISBURSEMENT"),
        actor_key: str = "widow_fatima",
    ) -> None:
        grant_id = sd.uid(f"grant:{key}")
        grants.append(
            {
                "id": grant_id,
                "citizen_id": citizens[citizen_key],
                "recipient_type": recipient_type,
                "recipient_tenant_id": tenants.get(tenant_code) if tenant_code else None,
                "recipient_user_id": users.get(helper_key) if helper_key else None,
                "categories": list(categories),
                "purposes": list(purposes),
                "status": "ACTIVE",
                "assurance_level": assurance,
                "verbal_audio_path": None,
                "granted_at": now,
                "expires_at": now + timedelta(days=90) if recipient_type == "HELPER" else None,
                "withdrawn_at": None,
                "updated_at": now,
            }
        )
        events.append(
            {
                "id": sd.uid(f"consent-event:{key}"),
                "grant_id": grant_id,
                "citizen_id": citizens[citizen_key],
                "action": "GRANTED",
                "actor_user_id": users[actor_key],
                "snapshot_json": {
                    "categories": list(categories),
                    "purposes": list(purposes),
                    "status": "ACTIVE",
                    "assurance_level": assurance,
                },
                "created_at": now,
            }
        )

    for key in (
        "widow_fatima",
        "forged_applicant",
        "income_conflict",
        "akram_ambiguous",
        "shared_alias_1",
        "shared_alias_2",
        "shared_alias_3",
        "low_assurance",
        "payment_failed",
    ):
        grant(
            f"dept:{key}",
            key,
            recipient_type="DEPARTMENT",
            tenant_code="SPD",
            actor_key=key if key in users else "widow_fatima",
        )

    grant(
        "helper:widow_fatima",
        "widow_fatima",
        recipient_type="HELPER",
        helper_key="helper_ayesha",
        assurance="CITIZEN_OTP",
        purposes=("HELPER_ASSISTANCE", "BENEFIT_APPLICATION"),
        actor_key="widow_fatima",
    )
    for index in range(1, 8):
        grant(
            f"helper:family_{index}",
            f"family_{index}",
            recipient_type="HELPER",
            helper_key="helper_ayesha",
            assurance="VERBAL_WITNESSED" if index == 7 else "CITIZEN_OTP",
            purposes=("HELPER_ASSISTANCE", "BENEFIT_APPLICATION"),
            actor_key="helper_ayesha",
        )
    grant(
        "helper:low_assurance",
        "low_assurance",
        recipient_type="HELPER",
        helper_key="helper_ayesha",
        assurance="VERBAL_WITNESSED",
        purposes=("HELPER_ASSISTANCE", "BENEFIT_APPLICATION"),
        actor_key="helper_ayesha",
    )

    _insert(db, metadata, "consent_grants", grants)
    _insert(db, metadata, "consent_events", events)


def _seed_mock_registries(db: Session) -> None:
    """Populate the simulated DPI registries with realistic drift."""
    identities: list[MockIdentity] = []

    def identity(
        cnic_value: str,
        full_name: str,
        full_name_ur: str,
        *,
        spouse: str | None,
        dob: str | None,
        district: str,
        gender: str = "F",
        alive: bool = True,
        expiry: str | None = "2030-08-01",
        marital: str = "WIDOWED",
        variants: Sequence[str] = (),
    ) -> None:
        identities.append(
            MockIdentity(
                cnic_digits=cnic_value,
                full_name=full_name,
                full_name_ur=full_name_ur,
                father_or_spouse_name=spouse,
                dob=date.fromisoformat(dob) if dob else None,
                gender=gender,
                district=district,
                is_alive=alive,
                cnic_expiry_date=date.fromisoformat(expiry) if expiry else None,
                marital_status=marital,
                variants_json=list(variants),
            )
        )

    identity(
        sd.cnic(12),
        "Mst. Fatima Bibi",
        "مسماۃ فاطمہ بی بی",
        spouse="Ghulam Rasool",
        dob="1974-05-14",
        district="Thatta",
        variants=["Fatima Bibi", "فاطمہ بی بی", "Fatima", "Mst Fatima Bibi"],
    )
    identity(
        sd.cnic(21),
        "Rasool Bakhsh",
        "رسول بخش",
        spouse="Zubaida Bibi",
        dob="1981-03-09",
        district="Hyderabad",
        gender="M",
        marital="MARRIED",
        variants=["Rasul Bakhsh"],
    )
    identity(
        sd.cnic(32),
        "Ayesha Khatoon",
        "عائشہ خاتون",
        spouse="Muhammad Yousuf",
        dob="1992-07-18",
        district="Thatta",
        marital="MARRIED",
        variants=["Aisha Khatoon", "Aysha Khatoon"],
    )
    identity(
        sd.cnic(104),
        "Ghulam Rasool",
        "غلام رسول",
        spouse="Fatima Bibi",
        dob="1968-02-03",
        district="Thatta",
        gender="M",
        alive=False,
        expiry="2025-03-11",
        marital="DECEASED",
        variants=["Ghulam Rasul", "Ghulam Rasool Shah"],
    )
    for index, (name, cnic_value, district, _phone) in enumerate(sd.AYESHA_FAMILIES):
        identity(
            cnic_value,
            name,
            "",
            spouse=f"Muhammad {sd.NAME_POOL[index]}",
            dob=f"19{72 + index}-0{(index % 9) + 1}-1{index % 9}",
            district=district,
            variants=[name.replace("Bibi", "").strip()],
        )
    identity(
        sd.FORGED_APPLICANT[1],
        sd.FORGED_APPLICANT[0],
        "زینب بی بی",
        spouse="Muhammad Ismail",
        dob="1979-02-11",
        district="Thatta",
        variants=["Zainab Bibi"],
    )
    identity(
        sd.cnic(209),
        "Sakina Bibi",
        "سکینہ بی بی",
        spouse="Allah Ditta",
        dob="1980-09-02",
        district="Badin",
        variants=["Sakeena Bibi"],
    )
    for name, cnic_value, district in sd.AKRAM_PAIR:
        identity(
            cnic_value,
            name,
            "محمد اکرم",
            spouse="Bano Bibi",
            dob="1975-06-20",
            district=district,
            gender="M",
            marital="MARRIED",
            variants=["Muhammad Akram", "Mohammad Akram", "Mohd Akram", "Akram"],
        )
    for index, (name, cnic_value, district) in enumerate(sd.SHARED_ALIAS_TRIO):
        identity(
            cnic_value,
            name,
            "",
            spouse=f"Abdul {sd.NAME_POOL[index + 3]}",
            dob=f"19{78 + index}-0{index + 3}-1{index}",
            district=district,
            variants=[name],
        )
    identity(
        sd.cnic(214),
        "Shahida Bibi",
        "شاہدہ بی بی",
        spouse="Muhammad Bux",
        dob="1973-10-14",
        district="Thatta",
        variants=["Shaheeda Bibi"],
    )
    identity(
        sd.cnic(215),
        "Razia Bibi",
        "رضیہ بی بی",
        spouse="Ghulam Hyder",
        dob="1981-08-09",
        district="Thatta",
        variants=["Razia"],
    )
    identity(
        sd.cnic(216),
        "Naseem Bibi",
        "نسیم بی بی",
        spouse="Muhammad Saleh",
        dob="1965-04-04",
        district="Thatta",
        alive=False,
        expiry="2024-01-01",
        variants=["Naseem"],
    )
    identity(
        sd.cnic(217),
        "Jamila Bibi",
        "جمیلہ بی بی",
        spouse="Muhammad Hashim",
        dob="1970-12-12",
        district="Dadu",
        expiry="2025-12-31",
        variants=["Jameela Bibi"],
    )
    db.add_all(identities)

    deaths = [
        MockCivilDeath(
            id=sd.uid("death:ghulam_rasool"),
            deceased_cnic=sd.cnic(104),
            deceased_name="Ghulam Rasool",
            spouse_cnic=sd.cnic(12),
            spouse_name="Fatima Bibi",
            death_date=date(2025, 3, 11),
            district="Thatta",
            certificate_no="THT-DTH-2025-004417",
        ),
        MockCivilDeath(
            id=sd.uid("death:muhammad_ismail"),
            deceased_cnic=sd.cnic(218),
            deceased_name="Muhammad Ismail",
            spouse_cnic=sd.FORGED_APPLICANT[1],
            spouse_name="Zainab Bibi",
            death_date=date(2024, 8, 2),
            district="Thatta",
            certificate_no="THT-DTH-2024-003118",
        ),
        MockCivilDeath(
            id=sd.uid("death:allah_ditta"),
            deceased_cnic=sd.cnic(219),
            deceased_name="Allah Ditta",
            spouse_cnic=sd.cnic(209),
            spouse_name="Sakina Bibi",
            death_date=date(2023, 11, 19),
            district="Badin",
            certificate_no="BDN-DTH-2023-001902",
        ),
        MockCivilDeath(
            id=sd.uid("death:muhammad_bux"),
            deceased_cnic=sd.cnic(220),
            deceased_name="Muhammad Bux",
            spouse_cnic=sd.cnic(214),
            spouse_name="Shahida Bibi",
            death_date=date(2022, 6, 30),
            district="Thatta",
            certificate_no="THT-DTH-2022-000771",
        ),
        MockCivilDeath(
            id=sd.uid("death:ghulam_hyder"),
            deceased_cnic=sd.cnic(221),
            deceased_name="Ghulam Hyder",
            spouse_cnic=sd.cnic(215),
            spouse_name="Razia Bibi",
            death_date=date(2021, 2, 14),
            district="Thatta",
            certificate_no="THT-DTH-2021-000512",
        ),
        MockCivilDeath(
            id=sd.uid("death:akram_1"),
            deceased_cnic=sd.cnic(301),
            deceased_name="Muhammad Akram",
            spouse_cnic=None,
            spouse_name="Bano Bibi",
            death_date=date(2020, 5, 5),
            district="Hyderabad",
            certificate_no="HYD-DTH-2020-000301",
        ),
        MockCivilDeath(
            id=sd.uid("death:akram_2"),
            deceased_cnic=sd.cnic(302),
            deceased_name="Mohammad Akram",
            spouse_cnic=None,
            spouse_name="Bano Bibi",
            death_date=date(2021, 9, 9),
            district="Hyderabad",
            certificate_no="HYD-DTH-2021-000302",
        ),
    ]
    db.add_all(deaths)

    households = [
        MockHousehold(
            id=sd.uid("household:fatima"),
            head_cnic=sd.cnic(12),
            member_cnics=[sd.cnic(12), sd.cnic(104)],
            district="Thatta",
            household_size=4,
            monthly_income_pkr=28000,
            poverty_score=24,
            survey_year=2025,
        ),
        MockHousehold(
            id=sd.uid("household:forged"),
            head_cnic=sd.FORGED_APPLICANT[1],
            member_cnics=[sd.FORGED_APPLICANT[1]],
            district="Thatta",
            household_size=4,
            monthly_income_pkr=22000,
            poverty_score=27,
            survey_year=2025,
        ),
        MockHousehold(
            id=sd.uid("household:income_conflict"),
            head_cnic=sd.cnic(209),
            member_cnics=[sd.cnic(209)],
            district="Badin",
            household_size=5,
            monthly_income_pkr=54000,
            poverty_score=41,
            survey_year=2025,
        ),
        MockHousehold(
            id=sd.uid("household:akram"),
            head_cnic=sd.cnic(301),
            member_cnics=[sd.cnic(301), sd.cnic(302)],
            district="Hyderabad",
            household_size=3,
            monthly_income_pkr=26000,
            poverty_score=29,
            survey_year=2024,
        ),
        MockHousehold(
            id=sd.uid("household:low_assurance"),
            head_cnic=sd.cnic(214),
            member_cnics=[sd.cnic(214)],
            district="Thatta",
            household_size=6,
            monthly_income_pkr=19000,
            poverty_score=18,
            survey_year=2025,
        ),
        MockHousehold(
            id=sd.uid("household:payment_failed"),
            head_cnic=sd.cnic(215),
            member_cnics=[sd.cnic(215)],
            district="Thatta",
            household_size=4,
            monthly_income_pkr=20000,
            poverty_score=21,
            survey_year=2025,
        ),
    ]
    for index, (_name, cnic_value, district) in enumerate(sd.SHARED_ALIAS_TRIO):
        households.append(
            MockHousehold(
                id=sd.uid(f"household:shared_{index + 1}"),
                head_cnic=cnic_value,
                member_cnics=[cnic_value],
                district=district,
                household_size=4,
                monthly_income_pkr=21000,
                poverty_score=23,
                survey_year=2025,
            )
        )
    db.add_all(households)

    db.add_all(
        [
            MockBenefit(
                id=sd.uid("benefit:conflict"),
                cnic_digits=sd.cnic(217),
                program_name="BISP Benazir Income Support (Mock)",
                monthly_amount_pkr=10500,
                is_active=True,
                started_at=date(2024, 1, 15),
            ),
            MockBenefit(
                id=sd.uid("benefit:expired"),
                cnic_digits=sd.cnic(12),
                program_name="Ehsaas Emergency Cash (Mock)",
                monthly_amount_pkr=12000,
                is_active=False,
                started_at=date(2020, 4, 1),
            ),
        ]
    )

    for service in ("identity", "civil", "household", "benefits", "payment", "complaint", "sms"):
        db.merge(
            MockServiceConfig(
                service_name=service,
                mode="NORMAL",
                latency_ms=4000,
                failure_rate=0.50,
                updated_at=datetime.now(UTC),
            )
        )
    db.flush()


# --------------------------------------------------------------------------- #
# case builders
# --------------------------------------------------------------------------- #
def _case_row(
    *,
    key: str,
    reference_code: str,
    tenant_id: uuid.UUID,
    program_id: uuid.UUID,
    citizen_id: uuid.UUID,
    submitted_by: uuid.UUID,
    status: str,
    priority_score: int,
    priority_band: str,
    confidence: float | None,
    route: str | None,
    rule_version_id: uuid.UUID,
    amount: int | None,
    flags: Sequence[dict[str, Any]],
    facts: dict[str, Any],
    explanation: dict[str, Any],
    ai_note: dict[str, Any] | None,
    submitted_at: datetime,
    decided_at: datetime | None,
    via_helper: bool = False,
    assigned_officer_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    return {
        "id": sd.uid(f"case:{key}"),
        "reference_code": reference_code,
        "tenant_id": tenant_id,
        "program_id": program_id,
        "citizen_id": citizen_id,
        "submitted_by_user_id": submitted_by,
        "submitted_via_helper": via_helper,
        "case_type": "BENEFIT_APPLICATION",
        "parent_case_id": None,
        "status": status,
        "previous_status": None,
        "assigned_officer_id": assigned_officer_id,
        "first_approver_id": None,
        "priority_score": priority_score,
        "priority_band": priority_band,
        "latest_confidence": confidence,
        "latest_route": route,
        "latest_rule_version_id": rule_version_id,
        "approved_amount_pkr": amount,
        "ask_more_rounds": 0,
        "wizard_step": "review_submit",
        "draft_answers": {
            fact_key: {
                "value": value["value"],
                "confirmed": True,
                "entered_by": value["entered_by"],
                "missing_reason": value["missing_reason"],
            }
            for fact_key, value in sd.public_facts(facts).items()
        },
        "flags_json": list(flags),
        "ai_case_note": ai_note,
        "citizen_explanation": explanation,
        "submitted_at": submitted_at,
        "decided_at": decided_at,
        "created_at": submitted_at,
        "updated_at": decided_at or submitted_at,
    }


def _decision_row(
    *,
    key: str,
    tenant_id: uuid.UUID,
    case_id: uuid.UUID,
    rule_version_id: uuid.UUID,
    rules: dict[str, Any],
    facts: dict[str, Any],
    confidence: dict[str, float],
    route: str,
    outcome: str,
    reasons: Sequence[str],
    amount: int | None,
    explanation: dict[str, Any],
    created_at: datetime,
) -> dict[str, Any]:
    snapshot = sd.public_facts(facts)
    return {
        "id": sd.uid(f"decision:{key}"),
        "tenant_id": tenant_id,
        "case_id": case_id,
        "decision_source": "AI_ENGINE",
        "actor_user_id": None,
        "rule_version_id": rule_version_id,
        "rule_content_hash": sd.content_hash(rules),
        "input_snapshot_json": snapshot,
        "input_snapshot_hash": sd.sha256_text(sd.canonical_json(snapshot)),
        "rule_trace_json": sd.rule_trace(rules, facts),
        "confidence_components": confidence,
        "confidence_overall": confidence["overall"],
        "route_action": route,
        "outcome_status": outcome,
        "escalation_reasons": list(reasons),
        "model_versions": {
            "engine": "1.0.0",
            "ocr": "fake-1.0.0",
            "stt": "fake-1.0.0",
            "explainer": "template-1.0.0",
        },
        "citizen_explanation": explanation,
        "computed_amount_pkr": amount,
        "officer_reason_codes": None,
        "officer_note": None,
        "is_override": False,
        "created_at": created_at,
    }


def _seed_historical_cases(
    db: Session,
    metadata: Any,
    *,
    tenants: dict[str, uuid.UUID],
    programs: dict[str, dict[str, Any]],
    users: dict[str, uuid.UUID],
    rng: random.Random,
) -> dict[str, Any]:
    """60 decided SPD cases + 10 ZWB cases (Digital Twin fodder)."""
    now = datetime(2026, 11, 20, 14, 0, tzinfo=UTC)
    spd = programs["SAHARA_WIDOW_GRANT"]
    zwb = programs["GUZARA_ALLOWANCE"]

    # Exactly 10 cases sit in the 35,001–40,000 band so a 40k→35k change flips 8–12.
    incomes: list[int] = [
        36000, 37000, 38000, 39000, 40000, 35500, 36500, 37500, 38500, 39500,
        15000, 16000, 17000, 18000, 19000, 20000, 21000, 22000, 23000, 24000,
        25000, 26000, 27000, 28000, 29000, 30000, 31000, 32000, 33000, 34000,
        41000, 42000, 43000, 44000, 45000, 41500, 42500, 43500, 44500, 40500,
        15500, 17500, 19500, 21500, 23500, 25500, 27500, 29500, 31500, 33500,
        34500, 35000, 40200, 40800, 41200, 41800, 42200, 42800, 43200, 43800,
    ]

    citizen_rows: list[dict[str, Any]] = []
    case_rows: list[dict[str, Any]] = []
    decision_rows: list[dict[str, Any]] = []
    note_rows: list[dict[str, Any]] = []
    payment_rows: list[dict[str, Any]] = []
    notification_rows: list[dict[str, Any]] = []
    grant_rows: list[dict[str, Any]] = []
    audit_specs: list[dict[str, Any]] = []

    def build(
        index: int,
        *,
        program: dict[str, Any],
        tenant_id: uuid.UUID,
        reference_code: str,
        income: int,
        children: int,
        district: str,
        prefix: str,
        decided_days_ago: int,
    ) -> None:
        name = f"{sd.NAME_POOL[index % len(sd.NAME_POOL)]} Bibi"
        cnic_value = sd.cnic(600 + index) if prefix == "spd" else sd.cnic(700 + index)
        citizen_id = sd.uid(f"citizen:{prefix}_{index}")
        dob = f"19{70 + (index % 25)}-0{(index % 9) + 1}-1{index % 9}"
        household_size = children + 2
        poverty_score = 12 + (index % 25)
        payout = f"+92300{2000000 + index:07d}"
        spouse = f"Muhammad {sd.NAME_POOL[(index + 5) % len(sd.NAME_POOL)]}"
        spouse_cnic = sd.cnic(800 + index)

        citizen_rows.append(
            {
                "id": citizen_id,
                "user_id": None,
                "full_name": name,
                "cnic_digits": cnic_value,
                "phone": payout,
                "district": district,
                "dob": date.fromisoformat(dob),
                "avatar_color": "#0E6A60",
                "profile_data": {
                    "children_under_18": children,
                    "household_size": household_size,
                    "monthly_income_pkr": income,
                    "payout_phone": payout,
                },
                "created_by_user_id": None,
                "created_at": now - timedelta(days=decided_days_ago + 1),
                "updated_at": now - timedelta(days=decided_days_ago),
            }
        )
        grant_rows.append(
            {
                "id": sd.uid(f"grant:{prefix}_{index}"),
                "citizen_id": citizen_id,
                "recipient_type": "DEPARTMENT",
                "recipient_tenant_id": tenant_id,
                "recipient_user_id": None,
                "categories": ["IDENTITY", "HOUSEHOLD", "DOCUMENTS", "PAYMENT", "CASE_HISTORY"],
                "purposes": ["BENEFIT_APPLICATION", "PAYMENT_DISBURSEMENT"],
                "status": "ACTIVE",
                "assurance_level": "SELF_OTP",
                "verbal_audio_path": None,
                "granted_at": now - timedelta(days=decided_days_ago + 2),
                "expires_at": None,
                "withdrawn_at": None,
                "updated_at": now - timedelta(days=decided_days_ago + 2),
            }
        )

        facts = sd.build_facts(
            cnic_value=cnic_value,
            full_name=name,
            dob=dob,
            district=district,
            income=income,
            children=children,
            household_size=household_size,
            poverty_score=poverty_score,
            payout_phone=payout,
            spouse_name=spouse,
            spouse_cnic=spouse_cnic,
        )
        rules = program["rules"]
        amount = sd.amount_for(rules["benefit_formula"], children)
        income_cap = next(r["value"] for r in rules["eligibility_rules"] if r["id"] == "R05_INCOME_CAP")
        eligible = income <= income_cap

        if eligible:
            status, route, outcome = "APPROVED", "AUTO_APPROVE", "APPROVED"
            conf = sd.confidence(identity=0.93, documents=0.95, data_consistency=0.98, consent=1.0)
            reasons: list[str] = []
            expl = sd.explanation(
                outcome="APPROVED",
                amount=amount,
                reasons_en=[
                    "Your CNIC and widow status were verified.",
                    f"Household income is within the limit (PKR {income:,}).",
                    f"With {children} children, your total grant is PKR {amount:,}.",
                ],
                reasons_ur=[
                    "آپ کا شناختی کارڈ اور بیوہ ہونے کی تصدیق ہو گئی۔",
                    f"گھریلو آمدنی حد کے اندر ہے ({income:,} روپے)۔",
                    f"{children} بچوں کے ساتھ کل رقم {amount:,} روپے بنتی ہے۔",
                ],
                next_en="Payment will be sent to your Raast number with a verification code SMS.",
                next_ur="رقم آپ کے راسط نمبر پر بھیجی جائے گی اور تصدیقی کوڈ کے ساتھ پیغام ملے گا۔",
            )
            ai_note = None
        else:
            status, route, outcome = "HUMAN_REVIEW", "HUMAN_REVIEW", "HUMAN_REVIEW"
            conf = sd.confidence(identity=0.93, documents=0.95, data_consistency=0.72, consent=1.0)
            reasons = ["RULE_FAIL_R05_INCOME_CAP"]
            expl = sd.explanation(
                outcome="HUMAN_REVIEW",
                amount=None,
                reasons_en=[f"Recorded household income (PKR {income:,}) is above the program limit."],
                reasons_ur=[f"ریکارڈ شدہ گھریلو آمدنی ({income:,} روپے) پروگرام کی حد سے زیادہ ہے۔"],
                next_en="An officer will review your application. You do not need to do anything.",
                next_ur="ایک افسر آپ کی درخواست کا جائزہ لے گا۔ آپ کو کچھ کرنے کی ضرورت نہیں۔",
            )
            ai_note = {
                "verified": ["Identity registry match", "Widow status verified via civil registry"],
                "uncertain": ["Recorded income exceeds the program cap"],
                "suggested_checks": ["Confirm household income with the survey record and the applicant"],
                "summary_en": "Income above the program limit; officer decision required.",
                "summary_ur": "آمدنی پروگرام کی حد سے زیادہ ہے؛ افسر کا فیصلہ درکار ہے۔",
            }

        submitted_at = now - timedelta(days=decided_days_ago, hours=2)
        decided_at = now - timedelta(days=decided_days_ago)
        case_id = sd.uid(f"case:{prefix}_{index}")
        case_rows.append(
            _case_row(
                key=f"{prefix}_{index}",
                reference_code=reference_code,
                tenant_id=tenant_id,
                program_id=program["id"],
                citizen_id=citizen_id,
                submitted_by=users["widow_fatima"] if prefix == "spd" else users["officer_zakat"],
                status=status,
                priority_score=30 if eligible else 65,
                priority_band="LOW" if eligible else "HIGH",
                confidence=conf["overall"],
                route=route,
                rule_version_id=program["rule_id"],
                amount=amount if eligible else None,
                flags=[],
                facts=facts,
                explanation=expl,
                ai_note=ai_note,
                submitted_at=submitted_at,
                decided_at=decided_at,
            )
        )
        decision_rows.append(
            _decision_row(
                key=f"{prefix}_{index}",
                tenant_id=tenant_id,
                case_id=case_id,
                rule_version_id=program["rule_id"],
                rules=rules,
                facts=facts,
                confidence=conf,
                route=route,
                outcome=outcome,
                reasons=reasons,
                amount=amount if eligible else None,
                explanation=expl,
                created_at=decided_at,
            )
        )
        note_rows.append(
            {
                "id": sd.uid(f"note:{prefix}_{index}"),
                "tenant_id": tenant_id,
                "case_id": case_id,
                "author_user_id": None,
                "note_type": "AGENT_STEP",
                "body": "assemble_facts_and_decide completed",
                "metadata_json": {
                    "tool": "engine.evaluate_and_route",
                    "latency_ms": 12 + (index % 9),
                    "status": "OK",
                    "route": route,
                },
                "is_visible_to_citizen": False,
                "created_at": decided_at,
            }
        )
        if eligible:
            payment_rows.append(
                {
                    "id": sd.uid(f"payment:{prefix}_{index}"),
                    "tenant_id": tenant_id,
                    "case_id": case_id,
                    "citizen_id": citizen_id,
                    "amount_pkr": amount,
                    "payout_alias": payout,
                    "status": "COMPLETED",
                    "external_ref": f"RAAST-{80000 + index}",
                    "failure_reason": None,
                    "attempt_count": 1,
                    "created_at": decided_at,
                    "updated_at": decided_at,
                }
            )
            code = sd.verification_code(rng)
            body_en = (
                f"Haqdaar: PKR {amount:,} has been sent to {payout} for case {reference_code}. "
                f"Verification code {code}. Never share your PIN or OTP."
            )
            body_ur = (
                f"حقدار: کیس {reference_code} کے لیے {amount:,} روپے {payout} پر بھیجے گئے ہیں۔ "
                f"تصدیقی کوڈ {code}۔ اپنا پن یا او ٹی پی کبھی شیئر نہ کریں۔"
            )
            notification_rows.append(
                {
                    "id": sd.uid(f"notification:{prefix}_{index}"),
                    "tenant_id": tenant_id,
                    "citizen_id": citizen_id,
                    "user_id": None,
                    "phone": payout,
                    "channel": "SMS_SIMULATED",
                    "title_ur": "ادائیگی بھیج دی گئی",
                    "title_en": "Payment sent",
                    "body_ur": body_ur,
                    "body_en": body_en,
                    "verification_code": code,
                    "body_sha256": sd.sha256_text(body_en.strip()),
                    "case_id": case_id,
                    "read_at": None,
                    "created_at": decided_at,
                }
            )
        audit_specs.append(
            {
                "action": "decision.recorded",
                "resource_type": "case",
                "resource_id": reference_code,
                "tenant_id": tenant_id,
                "payload": {"route": route, "outcome": outcome, "confidence": conf["overall"]},
            }
        )

    for index, income in enumerate(incomes):
        build(
            index,
            program=spd,
            tenant_id=tenants["SPD"],
            reference_code=f"HQ-2026-{200 + index:06d}",
            income=income,
            children=index % 6,
            district=sd.SINDH_DISTRICTS[index % len(sd.SINDH_DISTRICTS)],
            prefix="spd",
            decided_days_ago=3 + index,
        )

    for index in range(10):
        build(
            index,
            program=zwb,
            tenant_id=tenants["ZWB"],
            reference_code=f"HQ-2026-{300 + index:06d}",
            income=16000 + index * 1200,
            children=index % 4,
            district=sd.SINDH_DISTRICTS[(index + 2) % len(sd.SINDH_DISTRICTS)],
            prefix="zwb",
            decided_days_ago=5 + index,
        )

    _insert(db, metadata, "citizens", citizen_rows)
    _insert(db, metadata, "consent_grants", grant_rows)
    _insert(db, metadata, "cases", case_rows)
    _insert(db, metadata, "decisions", decision_rows)
    _insert(db, metadata, "case_notes", note_rows)
    _insert(db, metadata, "payments", payment_rows)
    _insert(db, metadata, "notifications", notification_rows)
    for spec in audit_specs:
        _record_audit(db, metadata, **spec)

    return {
        "historical_cases": len(case_rows),
        "historical_decisions": len(decision_rows),
        "historical_payments": len(payment_rows),
    }


# --------------------------------------------------------------------------- #
# demo documents + orchestration
# --------------------------------------------------------------------------- #
def upload_dir() -> Path:
    """The upload root, resolved exactly as the document writer resolves it (D-2b)."""
    from app.ai import paths

    return paths.upload_dir()


def _stage_demo_documents() -> dict[str, Any]:
    """Copy the generated specimen cards into ``UPLOAD_DIR/demo_docs``."""
    target = upload_dir() / "demo_docs"
    target.mkdir(parents=True, exist_ok=True)
    copied = 0
    if DEMO_DOCS_DIR.is_dir():
        for source in sorted(DEMO_DOCS_DIR.iterdir()):
            if source.is_file():
                shutil.copyfile(source, target / source.name)
                if source.suffix.lower() in {".jpg", ".jpeg", ".png"}:
                    copied += 1
    return {"demo_documents": copied, "demo_documents_dir": str(target)}


def _clear_mock_tables(db: Session) -> None:
    for model in (
        MockPayment,
        MockComplaint,
        MockBenefit,
        MockHousehold,
        MockCivilDeath,
        MockIdentity,
        MockServiceConfig,
    ):
        db.execute(delete(model))


def seed_all(
    db: Session,
    *,
    reset: bool = False,
    with_rag: bool = True,
) -> dict[str, Any]:
    """Seed the whole demo world. Deterministic and idempotent.

    ``reset=True`` wipes application + mock state first (the demo-reset target).
    """
    started = time.perf_counter()
    metadata = _metadata()
    rng = random.Random(sd.SEED_RNG_SEED)

    if reset:
        _delete_all(db, metadata, _RESET_ORDER)
        _clear_mock_tables(db)
        db.flush()

    summary: dict[str, Any] = {}
    tenants = _seed_tenants(db, metadata)
    users = _seed_users(db, metadata, tenants)
    citizens = _seed_citizens(db, metadata, users)
    programs = _seed_programs(db, metadata, tenants, users["admin_platform"])
    _seed_consent(db, metadata, citizens, users, tenants)
    _seed_mock_registries(db)
    summary.update(
        _seed_historical_cases(
            db, metadata, tenants=tenants, programs=programs, users=users, rng=rng
        )
    )
    from app.mocks.seed_showcase import seed_showcase_cases

    summary.update(
        seed_showcase_cases(
            db,
            metadata,
            tenants=tenants,
            programs=programs,
            users=users,
            citizens=citizens,
            rng=rng,
        )
    )
    summary.update(_stage_demo_documents())

    if with_rag:
        try:  # pragma: no cover - RAG lands later in the sprint
            from app.ai.rag import reindex_all  # type: ignore

            summary["rag"] = reindex_all(db)
        except Exception as exc:
            logger.info("RAG reindex skipped during seed: %s", exc)
            summary["rag"] = {"skipped": True}

    db.commit()
    summary.update(
        {
            "tenants": len(tenants),
            "users": len(users),
            "citizens": len(citizens),
            "programs": len(programs),
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
            "rng_seed": sd.SEED_RNG_SEED,
        }
    )
    logger.info("seed complete in %.1f ms: %s", summary["elapsed_ms"], summary)
    return summary


def reset_and_seed(db: Session, *, with_rag: bool = True) -> dict[str, Any]:
    """Wipe and reseed - the ``POST /admin/demo/reset`` target."""
    return seed_all(db, reset=True, with_rag=with_rag)


def is_seeded(db: Session) -> bool:
    """True when the demo world is already present."""
    try:
        metadata = _metadata()
    except SeedError:
        return False
    table = metadata.tables.get("tenants")
    if table is None:
        return False
    return bool(db.execute(select(func.count()).select_from(table)).scalar_one())


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.mocks.seed")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--reset", action="store_true", help="wipe and reseed everything")
    group.add_argument("--if-empty", action="store_true", help="seed only when empty")
    parser.add_argument("--no-rag", action="store_true", help="skip the RAG reindex")
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    try:
        from app.db import SessionLocal  # type: ignore
    except Exception as exc:  # pragma: no cover - only before A1 lands
        raise SystemExit(f"app.db.SessionLocal is not available yet: {exc}") from exc

    with SessionLocal() as db:
        if args.if_empty and is_seeded(db):
            print(json.dumps({"seeded": False, "reason": "already seeded"}))
            return 0
        summary = seed_all(db, reset=args.reset, with_rag=not args.no_rag)
    print(json.dumps({"seeded": True, **summary}, default=str))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())


__all__ = ["SeedError", "is_seeded", "main", "reset_and_seed", "seed_all", "upload_dir"]
