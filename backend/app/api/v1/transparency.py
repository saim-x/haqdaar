"""Public transparency endpoint - real vs simulated (docs/05 §3.9, RULE-3).

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

#: docs/15 §1 - the honest Real vs Simulated table shown to judges and citizens.
COMPONENTS: list[dict[str, Any]] = [
    {
        "component": "Auth, JWT, RBAC, Multi-Tenancy, Consent Engine, Audit Hash Chain",
        "name_ur": "تصدیق، رضامندی اور آڈٹ",
        "status": "REAL",
        "details": "Enforced server-side in FastAPI + PostgreSQL 16 (Alembic migrations).",
        "details_ur": "FastAPI اور PostgreSQL 16 میں سرور کی طرف نافذ - JWT، کردار کی بنیاد پر رسائی، رضامندی کا انجن اور آڈٹ کی زنجیر۔",
    },
    {
        "component": (
            "Versioned Rules Engine, Tri-State Evaluator, Entity Resolution, "
            "Confidence Router, Digital Twin"
        ),
        "name_ur": "قواعد انجن اور ڈیجیٹل ٹوئن",
        "status": "REAL",
        "details": "Pure Python deterministic engine (app/engine/) evaluating live DB rules.",
                "details_ur": (
            "خالص Python کا انجن (app/engine/) جو ڈیٹابیس کے قواعد پر فیصلہ کرتا ہے - "
            "تین حالتوں والا جائزہ، ناموں کی تطبیق اور ڈیجیٹل ٹوئن۔"
        ),
    },
    {
        "component": "Offline-First PWA & Idempotent Outbox",
        "name_ur": "آف لائن ایپ",
        "status": "REAL",
        "details": (
            "Workbox Service Worker + Dexie IndexedDB + server-side "
            "Idempotency-Key deduplication."
        ),
                "details_ur": (
            "Workbox سروس ورکر، Dexie IndexedDB اور سرور کی طرف Idempotency-Key کی "
            "جانچ - ایک ہی درخواست دو بار اثر نہیں کرتی۔"
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
                "details_ur": (
            "مصنوعی ڈیٹا پر تربیت یافتہ۔ قواعد، scikit-learn کا TF-IDF/LR ماڈل اور "
            "پیغام کے body_sha256 کی کرپٹوگرافک جانچ۔"
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
                "details_ur": (
            "نمونہ کارڈز پر۔ OpenCV کی دھندلاہٹ جانچ، QRCodeDetector، HMAC-SHA256 "
            "دستخط اور OCR سے موازنہ۔"
        ),
    },
    {
        "component": "Urdu Voice STT/TTS & RAG Policy Q&A",
        "name_ur": "اردو آواز اور پالیسی سوالات",
        "status": "REAL",
        "details": (
            "With fake fallback. Deepgram nova-3 STT + Deepgram Flux pre-recorded Urdu prompts "
            "+ OpenAI gpt-4o-mini & text-embedding-3-small + hybrid Postgres/NumPy retrieval."
        ),
        "details_ur": (
            "fake fallback کے ساتھ۔ Deepgram nova-3 آواز شناخت، Deepgram Flux اردو آڈیو، "
            "OpenAI gpt-4o-mini، text-embedding-3-small اور Postgres/NumPy کی مشترکہ تلاش۔"
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
                "details_ur": (
            "مصنوعی 99900-* شناختی کارڈ نمبروں کے ساتھ mock REST API "
            "(/mock/v1/identity/lookup) اور خرابی کے آزمائشی موڈ۔"
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
                "details_ur": (
            "مصنوعی ڈیٹا کے ساتھ mock REST APIs "
            "(/mock/v1/civil/*، /household/*، /benefits/*)۔"
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
                "details_ur": (
            "mock REST API (/mock/v1/payments/*، /complaints) - ادائیگیاں دہرانے پر "
            "بھی ایک ہی اثر، اور ناکامی کی آزمائش کا راستہ۔"
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
                "details_ur": (
            "پیغامات notifications میں محفوظ ہوتے ہیں اور /staff/device-sim پر فوراً "
            "نظر آتے ہیں؛ کوئی حقیقی ٹیلی کام گیٹ وے نہیں۔"
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
                "details_ur": (
            "مکمل فرضی پاکستانی کردار اور MOCK SPECIMEN کی مہر والے کارڈ۔ کوئی حقیقی "
            "ذاتی معلومات نہیں۔"
        ),
    },
]


@router.get("", summary="Machine-readable Real vs Simulated disclosure")
def transparency(db: DbSession) -> dict[str, Any]:
    """Public: no auth, no consent gate - this is the honesty page (RULE-5/RULE-6)."""
    return {
        "prototype": True,
        "banner": "Haqdaar prototype - simulated government services, synthetic data only",
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
        "mock_services_note_ur": (
            "خرابی کے موجودہ موڈ پلیٹ فارم ایڈمن /api/v1/admin/mocks سے تبدیل کر سکتے ہیں۔"
        ),
    }


__all__ = ["COMPONENTS", "router"]
