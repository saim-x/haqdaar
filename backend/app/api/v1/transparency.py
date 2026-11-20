"""Public transparency endpoint — real vs simulated (docs/05 §3.9, RULE-3).

The eleven components below are the docs/15 §1 table, in the same order and with
the same wording. ``README.md`` reproduces this table verbatim and the frontend
``/transparency`` page renders it from this payload, so all three must stay in
lockstep: change one, change all three.

``status`` is the three-way badge the UI colours (REAL / SIMULATED / SYNTHETIC).
Where docs/15 §1 qualifies a REAL row ("trained on synthetic data", "on mock
specimens", "with ``fake`` fallback") the qualifier leads ``details`` so it stays
visible without inventing a fourth badge.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.v1.admin_mocks import mock_service_statuses
from app.config import settings
from app.db import get_db

router = APIRouter(prefix="/transparency", tags=["transparency"])

DbSession = Annotated[Session, Depends(get_db)]

#: docs/15 §1 — the honest Real vs Simulated table shown to judges and citizens.
COMPONENTS: list[dict[str, Any]] = [
    {
        "component": "Auth, JWT, RBAC, Multi-Tenancy, Consent Engine, Audit Hash Chain",
        "name_ur": "تصدیق، رضامندی اور آڈٹ",
        "status": "REAL",
        "details": "Enforced server-side in FastAPI + PostgreSQL 16 (Alembic migrations).",
    },
    {
        "component": (
            "Versioned Rules Engine, Tri-State Evaluator, Entity Resolution, "
            "Confidence Router, Digital Twin"
        ),
        "name_ur": "قواعد انجن اور ڈیجیٹل ٹوئن",
        "status": "REAL",
        "details": "Pure Python deterministic engine (app/engine/) evaluating live DB rules.",
    },
    {
        "component": "Offline-First PWA & Idempotent Outbox",
        "name_ur": "آف لائن ایپ",
        "status": "REAL",
        "details": (
            "Workbox Service Worker + Dexie IndexedDB + server-side "
            "Idempotency-Key deduplication."
        ),
    },
    {
        "component": "Scam Classifier & Official Verification Codes",
        "name_ur": "سکیم پیغام کی جانچ",
        "status": "REAL",
        "details": (
            "Trained on synthetic data. Hybrid deterministic rules + calibrated "
            "scikit-learn TF-IDF/LR model + cryptographic SMS body_sha256 lookup."
        ),
    },
    {
        "component": "Document Verification (Blur, Signed QR, OCR Cross-Check)",
        "name_ur": "دستاویز کی جانچ",
        "status": "REAL",
        "details": (
            "On mock specimens. OpenCV Laplacian blur + QRCodeDetector + "
            "HMAC-SHA256 signature + vision OCR comparison."
        ),
    },
    {
        "component": "Urdu Voice STT/TTS & RAG Policy Q&A",
        "name_ur": "اردو آواز اور پالیسی سوالات",
        "status": "REAL",
        "details": (
            "With fake fallback. OpenAI whisper-1 / gpt-4o-mini / "
            "text-embedding-3-small + edge-tts + hybrid Postgres/NumPy retrieval."
        ),
    },
    {
        "component": "Identity Registry (NADRA-like)",
        "name_ur": "شناختی رجسٹری",
        "status": "SIMULATED",
        "details": (
            "Mock REST API (/mock/v1/identity/lookup) with synthetic 99900-* CNICs "
            "& chaos modes."
        ),
    },
    {
        "component": "Civil Death, Household Survey & Benefits Registries",
        "name_ur": "سول، سروے اور فوائد رجسٹریاں",
        "status": "SIMULATED",
        "details": (
            "Mock REST APIs (/mock/v1/civil/*, /household/*, /benefits/*) with "
            "synthetic data."
        ),
    },
    {
        "component": "Instant Payment Rails (Raast-like) & Complaints",
        "name_ur": "راست ادائیگی اور شکایات",
        "status": "SIMULATED",
        "details": (
            "Mock REST API (/mock/v1/payments/*, /complaints) with idempotent "
            "transfers & test failure alias."
        ),
    },
    {
        "component": "SMS / OTP Delivery",
        "name_ur": "ایس ایم ایس اور او ٹی پی",
        "status": "SIMULATED",
        "details": (
            "Stored in notifications & displayed live in /staff/device-sim; no real "
            "telecom gateway."
        ),
    },
    {
        "component": "Citizens, Cases & Documents",
        "name_ur": "شہری، کیس اور دستاویزات",
        "status": "SYNTHETIC",
        "details": (
            "100 % fictional Pakistani personas and watermarked MOCK SPECIMEN cards. "
            "Zero real personal data."
        ),
    },
]


@router.get("", summary="Machine-readable Real vs Simulated disclosure")
def transparency(db: DbSession) -> dict[str, Any]:
    """Public: no auth, no consent gate — this is the honesty page (RULE-5/RULE-6)."""
    return {
        "prototype": True,
        "banner": "Haqdaar prototype — simulated government services, synthetic data only",
        "synthetic_data": {
            "cnic_prefix": "99900",
            "note": "Every citizen, CNIC, phone number and document in this system is synthetic.",
        },
        "ai_provider": settings.ai_provider,
        "demo_mode": settings.demo_mode,
        "components": COMPONENTS,
        # The seven simulated DPI services with their *current* chaos mode, so a judge
        # can see on the public page that a "government rail" is down right now.
        "mock_services": mock_service_statuses(db),
        "mock_services_note": (
            "Live chaos modes are also editable by platform admins at /api/v1/admin/mocks."
        ),
    }


__all__ = ["COMPONENTS", "router"]
