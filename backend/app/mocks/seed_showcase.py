"""The 6 showcase queue cases ``HQ-2026-000101..106`` (docs/10 §2).

Each case demonstrates one technical challenge in Officer Sana's queue with the
exact flag codes, severities, priority bands and confidences from the frozen
spec. Kept in its own module so the main seeder stays readable.
"""

from __future__ import annotations

import hashlib
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Sequence

from sqlalchemy.orm import Session

from app.mocks import seed_data as sd
from app.mocks.payout_aliases import DORMANT_ALIAS, SHARED_PAYOUT_ALIAS
from app.mocks.seed import _case_row, _decision_row, _insert, _record_audit

DEMO_DOCS_DIR = Path(__file__).resolve().parent.parent / "data" / "demo_docs"


def _demo_file_meta(filename: str) -> tuple[int, str]:
    path = DEMO_DOCS_DIR / filename
    if not path.exists():
        return 0, "0" * 64
    return path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest()


def seed_showcase_cases(
    db: Session,
    metadata: Any,
    *,
    tenants: dict[str, uuid.UUID],
    programs: dict[str, dict[str, Any]],
    users: dict[str, uuid.UUID],
    citizens: dict[str, uuid.UUID],
    rng: random.Random,
) -> dict[str, Any]:
    now = datetime(2026, 11, 20, 15, 0, tzinfo=timezone.utc)
    spd = programs["SAHARA_WIDOW_GRANT"]
    rules = spd["rules"]
    tenant_id = tenants["SPD"]

    case_rows: list[dict[str, Any]] = []
    decision_rows: list[dict[str, Any]] = []
    note_rows: list[dict[str, Any]] = []
    document_rows: list[dict[str, Any]] = []
    payment_rows: list[dict[str, Any]] = []
    notification_rows: list[dict[str, Any]] = []
    audit_specs: list[dict[str, Any]] = []

    def add_case(
        *,
        number: int,
        citizen_key: str,
        status: str,
        priority_score: int,
        priority_band: str,
        conf: dict[str, float],
        route: str,
        outcome: str,
        flags: Sequence[dict[str, Any]],
        reasons: Sequence[str],
        facts: dict[str, Any],
        amount: int | None,
        expl: dict[str, Any],
        ai_note: dict[str, Any],
        submitted_hours_ago: int,
        via_helper: bool = False,
    ) -> uuid.UUID:
        reference = f"HQ-2026-{number:06d}"
        case_id = sd.uid(f"case:showcase_{number}")
        submitted_at = now - timedelta(hours=submitted_hours_ago)
        case_rows.append(
            _case_row(
                key=f"showcase_{number}",
                reference_code=reference,
                tenant_id=tenant_id,
                program_id=spd["id"],
                citizen_id=citizens[citizen_key],
                submitted_by=users["helper_ayesha"] if via_helper else users["widow_fatima"],
                status=status,
                priority_score=priority_score,
                priority_band=priority_band,
                confidence=conf["overall"],
                route=route,
                rule_version_id=spd["rule_id"],
                amount=amount,
                flags=flags,
                facts=facts,
                explanation=expl,
                ai_note=ai_note,
                submitted_at=submitted_at,
                decided_at=submitted_at + timedelta(minutes=2),
                via_helper=via_helper,
            )
        )
        decision_rows.append(
            _decision_row(
                key=f"showcase_{number}",
                tenant_id=tenant_id,
                case_id=case_id,
                rule_version_id=spd["rule_id"],
                rules=rules,
                facts=facts,
                confidence=conf,
                route=route,
                outcome=outcome,
                reasons=reasons,
                amount=amount,
                explanation=expl,
                created_at=submitted_at + timedelta(minutes=2),
            )
        )
        note_rows.append(
            {
                "id": sd.uid(f"note:showcase_{number}"),
                "tenant_id": tenant_id,
                "case_id": case_id,
                "author_user_id": None,
                "note_type": "AI_HANDOFF",
                "body": ai_note["summary_en"],
                "metadata_json": {
                    "verified": ai_note["verified"],
                    "uncertain": ai_note["uncertain"],
                    "suggested_checks": ai_note["suggested_checks"],
                },
                "is_visible_to_citizen": False,
                "created_at": submitted_at + timedelta(minutes=2),
            }
        )
        audit_specs.append(
            {
                "action": "decision.recorded",
                "resource_type": "case",
                "resource_id": reference,
                "tenant_id": tenant_id,
                "payload": {
                    "route": route,
                    "outcome": outcome,
                    "confidence": conf["overall"],
                    "flags": [flag["code"] for flag in flags],
                },
            }
        )
        return case_id

    # ------------------------------------------------------------------ 101
    # TAMPER_SUSPECTED — forged CNIC name vs signed QR. URGENT.
    facts_101 = sd.build_facts(
        cnic_value=sd.FORGED_APPLICANT[1],
        full_name=sd.FORGED_APPLICANT[0],
        dob="1979-02-11",
        district="Thatta",
        income=22000,
        children=3,
        household_size=5,
        poverty_score=27,
        payout_phone=sd.FORGED_APPLICANT[3],
        spouse_name="Muhammad Ismail",
        spouse_cnic=sd.cnic(218),
        cnic_doc_verified=False,
    )
    case_101 = add_case(
        number=101,
        citizen_key="forged_applicant",
        status="HUMAN_REVIEW",
        priority_score=90,
        priority_band="URGENT",
        conf=sd.confidence(identity=0.93, documents=0.10, data_consistency=0.20, consent=1.0),
        route="HUMAN_REVIEW",
        outcome="HUMAN_REVIEW",
        flags=[
            {
                "code": "TAMPER_SUSPECTED",
                "severity": "HIGH",
                "detail": (
                    "Printed CNIC name 'Zainab Bibi' does not match the signed QR payload "
                    "('Fatima Bibi', 9990010000012)."
                ),
            }
        ],
        reasons=["TAMPER_SUSPECTED"],
        facts=facts_101,
        amount=None,
        expl=sd.explanation(
            outcome="HUMAN_REVIEW",
            amount=None,
            reasons_en=["Your documents need a quick check by an officer."],
            reasons_ur=["آپ کی دستاویزات کا ایک افسر مختصر جائزہ لے گا۔"],
            next_en="An officer will review your application — usually within 2 days. You do not need to do anything.",
            next_ur="ایک افسر آپ کی درخواست کا جائزہ لے گا — عام طور پر 2 دن میں۔ آپ کو کچھ کرنے کی ضرورت نہیں۔",
        ),
        ai_note={
            "verified": ["Identity registry match for the declared CNIC", "Widow status verified via civil registry"],
            "uncertain": ["CNIC image printed name does not match the signed QR payload"],
            "suggested_checks": [
                "Compare the printed name on the CNIC image against the signed QR payload",
                "Ask the applicant to re-upload an unedited CNIC photo",
            ],
            "summary_en": "Document tamper suspected: printed name and signed QR disagree.",
            "summary_ur": "دستاویز میں تبدیلی کا شبہ: چھپا ہوا نام اور دستخط شدہ کیو آر میچ نہیں کرتے۔",
        },
        submitted_hours_ago=6,
    )
    size_101, sha_101 = _demo_file_meta("fatima_cnic_forged_name.jpg")
    document_rows.append(
        {
            "id": sd.uid("document:showcase_101"),
            "tenant_id": tenant_id,
            "citizen_id": citizens["forged_applicant"],
            "case_id": case_101,
            "doc_type": "CNIC_FRONT",
            "storage_path": "demo_docs/fatima_cnic_forged_name.jpg",
            "mime_type": "image/jpeg",
            "size_bytes": size_101,
            "sha256_hash": sha_101,
            "verify_status": "TAMPER_SUSPECTED",
            "verify_confidence": 0.10,
            "extracted_fields": {
                "cnic": sd.FORGED_APPLICANT[1],
                "full_name": sd.FORGED_APPLICANT[0],
                "dob": "1979-02-11",
                "qr_payload": {
                    "doc_type": "CNIC_FRONT",
                    "cnic": sd.cnic(12),
                    "full_name": "Fatima Bibi",
                    "dob": "1974-05-14",
                    "issuer": "MOCK_IDENTITY_REGISTRY",
                },
                "ocr_fields": {
                    "cnic": sd.FORGED_APPLICANT[1],
                    "full_name": sd.FORGED_APPLICANT[0],
                    "dob": "1979-02-11",
                },
            },
            "verify_checks": [
                {"check": "image_quality", "passed": True, "value": 4244.7, "threshold": 65.0, "detail": "sharp"},
                {"check": "qr_signature", "passed": True, "value": "valid", "threshold": "valid", "detail": "HMAC verified"},
                {
                    "check": "ocr_vs_qr",
                    "passed": False,
                    "value": {"cnic_match": False, "name_similarity": 0.31},
                    "threshold": {"cnic_match": True, "name_similarity": 0.80},
                    "detail": "printed name/CNIC disagree with the signed QR",
                },
            ],
            "retake_reason_ur": None,
            "retake_reason_en": None,
            "uploaded_by_user_id": users["widow_fatima"],
            "created_at": now - timedelta(hours=6),
        }
    )

    # ------------------------------------------------------------------ 102
    # DATA_CONFLICT_INCOME — self-declared 24k vs survey 54k. HIGH.
    facts_102 = sd.build_facts(
        cnic_value=sd.cnic(209),
        full_name="Sakina Bibi",
        dob="1980-09-02",
        district="Badin",
        income=54000,
        children=3,
        household_size=5,
        poverty_score=41,
        payout_phone="+923001000012",
        spouse_name="Allah Ditta",
        spouse_cnic=sd.cnic(219),
        self_declared_income=24000,
        income_conflict=True,
    )
    add_case(
        number=102,
        citizen_key="income_conflict",
        status="HUMAN_REVIEW",
        priority_score=60,
        priority_band="HIGH",
        conf=sd.confidence(identity=0.93, documents=0.95, data_consistency=0.72, consent=1.0),
        route="HUMAN_REVIEW",
        outcome="HUMAN_REVIEW",
        flags=[
            {
                "code": "DATA_CONFLICT_INCOME",
                "severity": "MEDIUM",
                "detail": "Self-declared PKR 24,000 vs household survey PKR 54,000 (125% difference).",
            }
        ],
        reasons=["LOW_CONFIDENCE", "DATA_CONFLICT_INCOME"],
        facts=facts_102,
        amount=None,
        expl=sd.explanation(
            outcome="HUMAN_REVIEW",
            amount=None,
            reasons_en=["Two income records disagree; an officer will confirm the correct amount."],
            reasons_ur=["آمدنی کے دو ریکارڈ مختلف ہیں؛ افسر درست رقم کی تصدیق کرے گا۔"],
            next_en="An officer will review your application. You do not need to do anything.",
            next_ur="ایک افسر آپ کی درخواست کا جائزہ لے گا۔ آپ کو کچھ کرنے کی ضرورت نہیں۔",
        ),
        ai_note={
            "verified": ["Identity registry match", "Widow status verified", "CNIC document verified"],
            "uncertain": ["Self-declared income PKR 24,000 conflicts with survey income PKR 54,000"],
            "suggested_checks": ["Confirm the household income with the survey record and the applicant"],
            "summary_en": "Income conflict between self-declaration and the household survey.",
            "summary_ur": "خود بیان کردہ آمدنی اور گھریلو سروے کے درمیان تضاد۔",
        },
        submitted_hours_ago=5,
    )

    # ------------------------------------------------------------------ 103
    # POSSIBLE_DUPLICATE_IDENTITY — Muhammad / Mohammad Akram, no CNIC. HIGH.
    facts_103 = sd.build_facts(
        cnic_value=None,
        full_name="Muhammad Akram",
        dob="1975-06-20",
        district="Hyderabad",
        income=26000,
        children=1,
        household_size=3,
        poverty_score=29,
        payout_phone="+923001000013",
        spouse_name="Bano Bibi",
        spouse_cnic=None,
    )
    add_case(
        number=103,
        citizen_key="akram_ambiguous",
        status="HUMAN_REVIEW",
        priority_score=65,
        priority_band="HIGH",
        conf=sd.confidence(identity=0.25, documents=0.95, data_consistency=0.30, consent=1.0),
        route="HUMAN_REVIEW",
        outcome="HUMAN_REVIEW",
        flags=[
            {
                "code": "POSSIBLE_DUPLICATE_IDENTITY",
                "severity": "HIGH",
                "detail": (
                    "Name+district search returned 2 registry records "
                    "(Muhammad Akram / Mohammad Akram) with no CNIC to disambiguate."
                ),
            }
        ],
        reasons=["POSSIBLE_DUPLICATE_IDENTITY"],
        facts=facts_103,
        amount=None,
        expl=sd.explanation(
            outcome="HUMAN_REVIEW",
            amount=None,
            reasons_en=["We found more than one matching record and need an officer to confirm which one is yours."],
            reasons_ur=["ہمیں ایک سے زیادہ مماثل ریکارڈ ملے ہیں؛ افسر تصدیق کرے گا کہ کون سا آپ کا ہے۔"],
            next_en="An officer will review your application. You do not need to do anything.",
            next_ur="ایک افسر آپ کی درخواست کا جائزہ لے گا۔ آپ کو کچھ کرنے کی ضرورت نہیں۔",
        ),
        ai_note={
            "verified": ["Household survey record found", "District is eligible"],
            "uncertain": ["No CNIC supplied; two registry records match the name and district"],
            "suggested_checks": [
                "Ask the applicant for their CNIC number to disambiguate",
                "Compare date of birth and spouse name against both registry records",
            ],
            "summary_en": "Ambiguous identity: two registry candidates, no CNIC to disambiguate.",
            "summary_ur": "شناخت مبہم: دو ممکنہ ریکارڈ، شناختی کارڈ نمبر کے بغیر فیصلہ ممکن نہیں۔",
        },
        submitted_hours_ago=4,
    )

    # ------------------------------------------------------------------ 104
    # PAYOUT_ACCOUNT_SHARED — 3 unrelated applicants, one alias. HIGH.
    facts_104 = sd.build_facts(
        cnic_value=sd.cnic(401),
        full_name="Nasreen Bibi",
        dob="1978-03-10",
        district="Thatta",
        income=21000,
        children=2,
        household_size=4,
        poverty_score=23,
        payout_phone=SHARED_PAYOUT_ALIAS,
        spouse_name="Abdul Karim",
        spouse_cnic=sd.cnic(222),
    )
    add_case(
        number=104,
        citizen_key="shared_alias_1",
        status="HUMAN_REVIEW",
        priority_score=65,
        priority_band="HIGH",
        conf=sd.confidence(identity=0.93, documents=0.95, data_consistency=0.20, consent=1.0),
        route="HUMAN_REVIEW",
        outcome="HUMAN_REVIEW",
        flags=[
            {
                "code": "PAYOUT_ACCOUNT_SHARED",
                "severity": "HIGH",
                "detail": f"Payout alias {SHARED_PAYOUT_ALIAS} is used by 3 unrelated applicants.",
            }
        ],
        reasons=["PAYOUT_ACCOUNT_SHARED"],
        facts=facts_104,
        amount=None,
        expl=sd.explanation(
            outcome="HUMAN_REVIEW",
            amount=None,
            reasons_en=["The payout number is linked to more than one application, so an officer will check it."],
            reasons_ur=["ادائیگی کا نمبر ایک سے زیادہ درخواستوں سے منسلک ہے، اس لیے افسر جانچ کرے گا۔"],
            next_en="An officer will review your application. You do not need to do anything.",
            next_ur="ایک افسر آپ کی درخواست کا جائزہ لے گا۔ آپ کو کچھ کرنے کی ضرورت نہیں۔",
        ),
        ai_note={
            "verified": ["Identity registry match", "Widow status verified", "Income within limit"],
            "uncertain": [f"Payout alias {SHARED_PAYOUT_ALIAS} shared by 3 unrelated applicants"],
            "suggested_checks": [
                "Confirm the payout number belongs to the applicant",
                "Check whether a shopkeeper or helper collected multiple families' numbers",
            ],
            "summary_en": "Shared payout alias across three unrelated applicants.",
            "summary_ur": "تین غیر متعلق درخواست گزار ایک ہی ادائیگی نمبر استعمال کر رہے ہیں۔",
        },
        submitted_hours_ago=3,
    )

    # ------------------------------------------------------------------ 105
    # LOW_ASSURANCE_CONSENT — helper verbal consent 0.82 < 0.90. NORMAL.
    facts_105 = sd.build_facts(
        cnic_value=sd.cnic(214),
        full_name="Shahida Bibi",
        dob="1973-10-14",
        district="Thatta",
        income=19000,
        children=4,
        household_size=6,
        poverty_score=18,
        payout_phone="+923001000017",
        spouse_name="Muhammad Bux",
        spouse_cnic=sd.cnic(220),
        consent_assurance="VERBAL_WITNESSED",
    )
    add_case(
        number=105,
        citizen_key="low_assurance",
        status="HUMAN_REVIEW",
        priority_score=45,
        priority_band="NORMAL",
        conf=sd.confidence(identity=0.93, documents=0.95, data_consistency=0.98, consent=0.82),
        route="HUMAN_REVIEW",
        outcome="HUMAN_REVIEW",
        flags=[
            {
                "code": "LOW_ASSURANCE_CONSENT",
                "severity": "MEDIUM",
                "detail": "Helper captured witnessed verbal consent (assurance 0.82 < 0.90 threshold).",
            }
        ],
        reasons=["LOW_CONFIDENCE", "LOW_ASSURANCE_CONSENT"],
        facts=facts_105,
        amount=None,
        expl=sd.explanation(
            outcome="HUMAN_REVIEW",
            amount=None,
            reasons_en=["Your helper recorded your permission by voice, so an officer will confirm it."],
            reasons_ur=["آپ کی مددگار نے آپ کی اجازت آواز میں ریکارڈ کی ہے، اس لیے افسر تصدیق کرے گا۔"],
            next_en="An officer will review your application. You do not need to do anything.",
            next_ur="ایک افسر آپ کی درخواست کا جائزہ لے گا۔ آپ کو کچھ کرنے کی ضرورت نہیں۔",
        ),
        ai_note={
            "verified": ["Identity registry match", "Widow status verified", "Income within limit"],
            "uncertain": [
                "Consent was captured as witnessed verbal consent (0.82), below the 0.90 auto-approve threshold"
            ],
            "suggested_checks": [
                "Confirm consent with the citizen by phone OTP if possible",
                "Listen to the witnessed verbal consent recording",
            ],
            "summary_en": "Verbal-only helper consent caps confidence at 0.82; officer confirmation required.",
            "summary_ur": "صرف زبانی اجازت کی وجہ سے اعتماد 0.82 ہے؛ افسر کی تصدیق درکار ہے۔",
        },
        submitted_hours_ago=2,
        via_helper=True,
    )

    # ------------------------------------------------------------------ 106
    # PAYMENT_FAILED on a dormant account. HIGH (Journey J-9).
    facts_106 = sd.build_facts(
        cnic_value=sd.cnic(215),
        full_name="Razia Bibi",
        dob="1981-08-09",
        district="Thatta",
        income=20000,
        children=2,
        household_size=4,
        poverty_score=21,
        payout_phone=DORMANT_ALIAS,
        spouse_name="Ghulam Hyder",
        spouse_cnic=sd.cnic(221),
    )
    case_106 = add_case(
        number=106,
        citizen_key="payment_failed",
        status="PAYMENT_FAILED",
        priority_score=65,
        priority_band="HIGH",
        conf=sd.confidence(identity=0.93, documents=0.95, data_consistency=0.98, consent=1.0),
        route="AUTO_APPROVE",
        outcome="APPROVED",
        flags=[
            {
                "code": "PAYMENT_FAILED",
                "severity": "HIGH",
                "detail": f"Raast transfer to {DORMANT_ALIAS} failed: ACCOUNT_DORMANT.",
            }
        ],
        reasons=[],
        facts=facts_106,
        amount=13000,
        expl=sd.explanation(
            outcome="APPROVED",
            amount=13000,
            reasons_en=[
                "Your CNIC and widow status were verified.",
                "Household income is within the limit (PKR 20,000).",
                "With 2 children, your total grant is PKR 13,000.",
            ],
            reasons_ur=[
                "آپ کا شناختی کارڈ اور بیوہ ہونے کی تصدیق ہو گئی۔",
                "گھریلو آمدنی حد کے اندر ہے (20,000 روپے)۔",
                "2 بچوں کے ساتھ کل رقم 13,000 روپے بنتی ہے۔",
            ],
            next_en="The payment could not be delivered because the account is dormant. An officer will contact you.",
            next_ur="اکاؤنٹ غیر فعال ہونے کی وجہ سے رقم نہیں پہنچ سکی۔ افسر آپ سے رابطہ کرے گا۔",
        ),
        ai_note={
            "verified": ["Identity registry match", "Widow status verified", "Income within limit"],
            "uncertain": ["Raast transfer failed with ACCOUNT_DORMANT"],
            "suggested_checks": [
                "Contact the citizen to confirm an active Raast number",
                "Retry the payment after the alias is corrected",
            ],
            "summary_en": "Approved but the Raast transfer failed on a dormant account.",
            "summary_ur": "منظور شدہ درخواست، لیکن غیر فعال اکاؤنٹ کی وجہ سے ادائیگی ناکام ہوئی۔",
        },
        submitted_hours_ago=26,
    )
    payment_rows.append(
        {
            "id": sd.uid("payment:showcase_106"),
            "tenant_id": tenant_id,
            "case_id": case_106,
            "citizen_id": citizens["payment_failed"],
            "amount_pkr": 13000,
            "payout_alias": DORMANT_ALIAS,
            "status": "FAILED",
            "external_ref": "RAAST-99106",
            "failure_reason": "ACCOUNT_DORMANT",
            "attempt_count": 3,
            "created_at": now - timedelta(hours=25),
            "updated_at": now - timedelta(hours=24),
        }
    )
    code_106 = sd.verification_code(rng)
    body_en_106 = (
        f"Haqdaar: your application HQ-2026-000106 is approved for PKR 13,000. "
        f"Verification code {code_106}. Never share your PIN or OTP."
    )
    notification_rows.append(
        {
            "id": sd.uid("notification:showcase_106"),
            "tenant_id": tenant_id,
            "citizen_id": citizens["payment_failed"],
            "user_id": None,
            "phone": "+923001000018",
            "channel": "SMS_SIMULATED",
            "title_ur": "درخواست منظور",
            "title_en": "Application approved",
            "body_ur": (
                f"حقدار: آپ کی درخواست HQ-2026-000106 کے لیے 13,000 روپے منظور ہوئے۔ "
                f"تصدیقی کوڈ {code_106}۔ اپنا پن یا او ٹی پی کبھی شیئر نہ کریں۔"
            ),
            "body_en": body_en_106,
            "verification_code": code_106,
            "body_sha256": sd.sha256_text(body_en_106.strip()),
            "case_id": case_106,
            "read_at": None,
            "created_at": now - timedelta(hours=25),
        }
    )

    _insert(db, metadata, "cases", case_rows)
    _insert(db, metadata, "decisions", decision_rows)
    _insert(db, metadata, "case_notes", note_rows)
    _insert(db, metadata, "documents", document_rows)
    _insert(db, metadata, "payments", payment_rows)
    _insert(db, metadata, "notifications", notification_rows)
    for spec in audit_specs:
        _record_audit(db, metadata, **spec)

    return {"showcase_cases": len(case_rows)}


__all__ = ["seed_showcase_cases"]
