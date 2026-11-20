"""Public transparency endpoint — real vs simulated (docs/05 §3.9, RULE-3)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.config import settings

router = APIRouter(prefix="/transparency", tags=["transparency"])

#: The honest Real vs Simulated table shown to judges and citizens.
SUBSYSTEMS: list[dict[str, Any]] = [
    {
        "name": "Identity Registry (NADRA-like)",
        "name_ur": "شناختی رجسٹری",
        "real": False,
        "detail": "Simulated at /mock/v1/identity/lookup. All CNICs use the fictional prefix 99900.",
    },
    {
        "name": "Civil Death Registry",
        "name_ur": "سول رجسٹری (وفات)",
        "real": False,
        "detail": "Simulated at /mock/v1/civil/death-records.",
    },
    {
        "name": "Household Socio-Economic Survey (BISP/NSER-like)",
        "name_ur": "گھریلو سروے",
        "real": False,
        "detail": "Simulated at /mock/v1/household/survey.",
    },
    {
        "name": "Benefits Registry",
        "name_ur": "فوائد رجسٹری",
        "real": False,
        "detail": "Simulated at /mock/v1/benefits/active.",
    },
    {
        "name": "Raast Instant Payment",
        "name_ur": "راست ادائیگی",
        "real": False,
        "detail": "Simulated at /mock/v1/payments/transfer. No real money moves.",
    },
    {
        "name": "Public Complaint Registry",
        "name_ur": "شکایات رجسٹری",
        "real": False,
        "detail": "Simulated at /mock/v1/complaints.",
    },
    {
        "name": "SMS Gateway",
        "name_ur": "ایس ایم ایس",
        "real": False,
        "detail": "Simulated inbox at /mock/v1/sms/inbox/{phone}; no SMS leaves the system.",
    },
    {
        "name": "Decision engine (rules, confidence, routing)",
        "name_ur": "فیصلہ انجن",
        "real": True,
        "detail": "Real deterministic Python engine with versioned rules and hash-chained audit.",
    },
    {
        "name": "Consent enforcement & access log",
        "name_ur": "رضامندی اور رسائی لاگ",
        "real": True,
        "detail": "Real server-side enforcement; denied attempts are persisted before the 403.",
    },
    {
        "name": "Audit hash chain",
        "name_ur": "آڈٹ ہیش چین",
        "real": True,
        "detail": "Real SHA-256 chain over every state mutation, verifiable at /api/v1/auditor/verify-chain.",
    },
    {
        "name": "Scam classifier & document verifier",
        "name_ur": "سکیم اور دستاویز جانچ",
        "real": True,
        "detail": "Real local models (scikit-learn / OpenCV) with deterministic fake mode for tests.",
    },
    {
        "name": "AI provider (LLM, speech, embeddings)",
        "name_ur": "اے آئی سروس",
        "real": settings.ai_provider == "live",
        "detail": (
            "Live OpenAI calls enabled."
            if settings.ai_provider == "live"
            else "Deterministic fake provider — no external AI calls are made."
        ),
    },
]


@router.get("", summary="Machine-readable Real vs Simulated disclosure")
def transparency() -> dict[str, Any]:
    return {
        "prototype": True,
        "banner": "Haqdaar prototype — simulated government services, synthetic data only",
        "synthetic_data": {
            "cnic_prefix": "99900",
            "note": "Every citizen, CNIC, phone number and document in this system is synthetic.",
        },
        "ai_provider": settings.ai_provider,
        "demo_mode": settings.demo_mode,
        "subsystems": SUBSYSTEMS,
        "mock_statuses": {},
        "mock_statuses_note": "Live chaos modes are visible to platform admins at /api/v1/admin/mocks.",
    }


__all__ = ["SUBSYSTEMS", "router"]
