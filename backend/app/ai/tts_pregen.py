"""Pre-generate the static Urdu prompt library (docs/07 §2.1).

The citizen PWA must speak its wizard questions with **zero latency and zero
network after install**, so every static phrase is rendered once into
``frontend/public/audio/ur/<key>.mp3`` and cached by the service worker.

Run with network access::

    python -m app.ai.tts_pregen            # render anything missing
    python -m app.ai.tts_pregen --force    # re-render everything
    python -m app.ai.tts_pregen --manifest-only

``manifest.json`` is always written — it is the contract the frontend reads
(``{key: text}`` plus metadata). If a render fails the key is marked ``pending``
and the frontend degrades silently to on-screen text, exactly as specified.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

logger = logging.getLogger("haqdaar.ai.tts_pregen")

VOICE = "ur-PK-UzmaNeural"
VOICE_ALT = "ur-PK-AsadNeural"

#: Repo root → ``frontend/public/audio/ur``. This directory is owned by A4.
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = BACKEND_DIR.parent / "frontend" / "public" / "audio" / "ur"

#: ``key -> Urdu text``. The registry is the **merged** one from ADR-018: FE's 31
#: UI keys (the consumer's call sites define the contract) plus DPI's extra keys
#: for status headlines, document feedback, readback and connectivity. FE reads
#: ``manifest.json`` as a flat ``{key: text}`` map and skips non-string values, so
#: ``_meta`` is invisible to it.
PROMPTS: dict[str, str] = {
    # ---- FE: wizard steps (docs/11 §3.2) --------------------------------- #
    "wizard_consent": (
        "حقدار میں خوش آمدید۔ درخواست دینے سے پہلے ہم آپ سے اجازت لیں گے کہ سوشل پروٹیکشن "
        "ڈیپارٹمنٹ آپ کا شناختی کارڈ، گھریلو سروے اور دستاویزات دیکھ سکے۔ آپ کبھی بھی یہ اجازت "
        "واپس لے سکتی ہیں۔"
    ),
    "wizard_applicant_full_name": "براہ کرم اپنا پورا نام بولیں یا لکھیں۔",
    "wizard_applicant_cnic": "براہ کرم اپنے شناختی کارڈ کے تیرہ ہندسے بولیں یا کی پیڈ سے لکھیں۔",
    "wizard_applicant_dob": "براہ کرم اپنی تاریخ پیدائش بتائیں۔",
    "wizard_spouse_full_name": "براہ کرم اپنے شوہر کا نام بولیں یا لکھیں۔",
    "wizard_spouse_cnic": (
        "براہ کرم اپنے شوہر کے شناختی کارڈ کے ہندسے بتائیں۔ اگر معلوم نہ ہو تو "
        "مجھے نہیں معلوم کا بٹن دبا دیں۔"
    ),
    "wizard_applicant_district": "براہ کرم اپنا ضلع منتخب کریں۔",
    "wizard_children_under_18": "آپ کے اٹھارہ سال سے کم کتنے بچے ہیں؟",
    "wizard_household_size": "آپ کے گھر میں کل کتنے افراد رہتے ہیں؟",
    "wizard_monthly_income_pkr": "آپ کے گھر کی ماہانہ آمدنی تقریباً کتنی ہے؟",
    # ``inputs.tsx`` (the shared field component) asks for this shorter alias.
    "wizard_income": "آپ کے گھر کی ماہانہ آمدنی تقریباً کتنی ہے؟",
    "wizard_payout_phone": "وہ موبائل نمبر بتائیں جس پر رقم بھیجنی ہے۔",
    "wizard_cnic_doc": "براہ کرم اپنے شناختی کارڈ کے سامنے والے حصے کی تصویر لیں۔",
    "wizard_death_cert_doc": "براہ کرم اپنے شوہر کے وفات سرٹیفکیٹ کی تصویر لیں۔",
    "wizard_review": "براہ کرم اپنی معلومات ایک بار سن لیں اور پھر درخواست جمع کروائیں۔",
    "wizard_queued": (
        "انٹرنیٹ نہ ہونے کی وجہ سے آپ کی درخواست قطار میں محفوظ ہے اور انٹرنیٹ آنے پر "
        "خود بھیج دی جائے گی۔"
    ),
    "wizard_submitted": "آپ کی درخواست جمع ہو گئی ہے۔ ہم آپ کو پیغام بھیجیں گے۔",
    # ---- FE: home tiles -------------------------------------------------- #
    "home_apply": "نئی درخواست دینے کے لیے یہاں دبائیں۔",
    "home_cases": "اپنی درخواستوں کی حالت دیکھنے کے لیے یہاں دبائیں۔",
    "home_scam": "کسی مشکوک پیغام کی جانچ کے لیے یہاں دبائیں۔",
    "home_data": "آپ کا ڈیٹا اور اجازتیں دیکھنے کے لیے یہاں دبائیں۔",
    # ---- FE: page intros and titles -------------------------------------- #
    "ask_intro": "حقدار کے بارے میں کوئی بھی سوال پوچھیں۔",
    "cases_title": "آپ کی درخواستیں۔",
    "consent_intro": (
        "حقدار میں خوش آمدید۔ درخواست دینے سے پہلے ہم آپ سے اجازت لیں گے کہ سوشل پروٹیکشن "
        "ڈیپارٹمنٹ آپ کا شناختی کارڈ، گھریلو سروے اور دستاویزات دیکھ سکے۔ آپ کبھی بھی یہ اجازت "
        "واپس لے سکتی ہیں۔"
    ),
    "consent_access_log": "یہ ریکارڈ دکھاتا ہے کہ کس نے اور کب آپ کا ڈیٹا دیکھا۔",
    "mydata_intro": "یہ آپ کا ڈیٹا ہے۔ آپ دیکھ سکتی ہیں کہ ہمارے پاس کیا محفوظ ہے۔",
    "scam_intro": (
        "مشکوک پیغام یہاں لکھیں یا اس کی تصویر بھیجیں، ہم بتائیں گے کہ یہ فراڈ ہے یا نہیں۔"
    ),
    "transparency_intro": "یہ صفحہ بتاتا ہے کہ حقدار میں کیا اصلی ہے اور کیا نقلی۔",
    # ---- FE: login and helper app ---------------------------------------- #
    "login_welcome": "حقدار میں خوش آمدید۔ اپنا موبائل نمبر ڈال کر لاگ ان کریں۔",
    "helper_intro": "آپ اپنے گھرانوں کی درخواستیں یہاں سے جمع کروا سکتی ہیں۔",
    "helper_switch": "آپ اب اس گھرانے کی مدد کر رہی ہیں۔",
    "helper_add_family": "نیا گھرانہ شامل کرنے کے لیے یہاں دبائیں۔",
    # ---- FE: my-data categories (docs/04 §4.4 DataCategory) -------------- #
    "mydata_identity": "شناختی معلومات۔",
    "mydata_household": "گھریلو معلومات۔",
    "mydata_documents": "دستاویزات۔",
    "mydata_payment": "ادائیگی کی معلومات۔",
    "mydata_case_history": "درخواستوں کی تاریخ۔",
    # ---- FE: scam verdicts (docs/11 §3.4) -------------------------------- #
    "scam_verified_official": "یہ پیغام حقدار کی سرکاری اطلاع سے مطابقت رکھتا ہے۔ یہ محفوظ ہے۔",
    "scam_likely_scam": "یہ پیغام فراڈ لگتا ہے۔ پیسے نہ بھیجیں، او ٹی پی یا پن شیئر نہ کریں، اور کوئی لنک نہ کھولیں۔",
    "scam_cannot_tell": "ہم اس پیغام کے بارے میں یقین سے نہیں کہہ سکتے۔ کچھ کرنے سے پہلے مددگار یا سرکاری ہیلپ لائن سے تصدیق کریں۔",
    "scam_likely_safe": "اس پیغام میں فراڈ کی عام نشانیاں نہیں ملیں۔ پھر بھی احتیاط رکھیں۔",
    # ---- DPI extras: consent --------------------------------------------- #
    "consent_grant_confirm": "آپ نے اجازت دے دی ہے۔ شکریہ۔ اب ہم آپ کی درخواست شروع کرتے ہیں۔",
    "consent_required": "درخواست جاری رکھنے کے لیے اجازت دینا ضروری ہے۔",
    "consent_withdrawn": "آپ نے اجازت واپس لے لی ہے۔ آپ کی درخواست روک دی گئی ہے۔",
    # ---- DPI extras: voice interaction ----------------------------------- #
    "readback_confirm": "کیا یہ درست ہے؟",
    "needs_retry": "ہم ٹھیک سے سمجھ نہیں سکے۔ براہ کرم دوبارہ بولیں یا کی پیڈ استعمال کریں۔",
    "unknown_ok": "کوئی بات نہیں، آپ بعد میں بھی بتا سکتی ہیں۔",
    "submit_confirm": "آپ کی درخواست جمع ہو گئی ہے۔ ہم آپ کو پیغام بھیجیں گے۔",
    # ---- DPI extras: document verification ------------------------------- #
    "doc_verified": "آپ کی دستاویز درست ہے۔ شکریہ۔",
    "doc_unverifiable": "ہم اس دستاویز کی تصدیق نہیں کر سکے۔ براہ کرم دوبارہ کوشش کریں۔",
    "doc_tamper_review": "اس دستاویز میں کچھ فرق ہے، اس لیے ایک افسر اسے دیکھے گا۔ آپ کو کچھ کرنے کی ضرورت نہیں۔",
    "doc_needs_retake": "اس دستاویز کی تصویر دوبارہ لینا ضروری ہے۔",
    "retake_blurry": "تصویر دھندلی ہے۔ فون کو دونوں ہاتھوں سے سہارا دے کر اچھی روشنی میں دوبارہ تصویر لیں۔",
    "retake_qr_missing": "ہم دستاویز کا سیکیورٹی کوڈ نہیں پڑھ سکے۔ براہ کرم زیادہ واضح تصویر لیں۔",
    "retake_too_small": "تصویر بہت چھوٹی ہے۔ براہ کرم قریب سے واضح تصویر لیں۔",
    # ---- DPI extras: connectivity ---------------------------------------- #
    "offline_saved": "انٹرنیٹ نہیں ہے۔ آپ کی معلومات محفوظ ہو گئی ہیں اور انٹرنیٹ آنے پر خود بھیج دی جائیں گی۔",
    "network_error": "نیٹ ورک میں مسئلہ ہے۔ براہ کرم تھوڑی دیر بعد دوبارہ کوشش کریں۔",
    # ---- DPI extras: case status headlines (docs/04 §3.3) ---------------- #
    "status_draft": "آپ کی درخواست محفوظ ہے۔",
    "status_submitted": "آپ کی درخواست جمع ہو گئی ہے۔ جانچ جاری ہے۔",
    "status_processing": "آپ کی درخواست کی جانچ جاری ہے۔",
    "status_waiting_external": "ایک سرکاری نظام عارضی طور پر سست ہے۔ ہم نے سب کچھ محفوظ کر لیا ہے اور خودکار طور پر جاری رکھیں گے۔",
    "status_needs_info": "آپ کی درخواست مکمل کرنے کے لیے مزید معلومات درکار ہیں۔",
    "status_human_review": "ایک افسر آپ کی درخواست کا جائزہ لے گا۔ آپ کو کچھ کرنے کی ضرورت نہیں۔",
    "status_in_review": "ایک افسر اب آپ کی درخواست دیکھ رہا ہے۔",
    "status_pending_second_approval": "حتمی منظوری جاری ہے۔",
    "status_on_hold_consent": "آپ نے اجازت واپس لی تھی، اس لیے درخواست روکی گئی ہے۔",
    "status_approved": "مبارک ہو! آپ کی درخواست منظور ہو گئی ہے۔ رقم بھیجی جا رہی ہے۔",
    "status_payment_initiated": "رقم بھیجی جا رہی ہے۔",
    "status_paid": "رقم آپ کے اکاؤنٹ میں پہنچ گئی ہے۔",
    "status_payment_failed": "ادائیگی میں مسئلہ آیا ہے۔ ایک افسر آپ سے رابطہ کرے گا۔",
    "status_rejected": "آپ کی درخواست منظور نہیں ہوئی۔ وجوہات درخواست میں لکھی ہیں۔",
    "status_withdrawn": "آپ نے درخواست واپس لے لی ہے۔",
    "status_closed": "آپ کا کیس مکمل ہو گیا ہے۔",
}

#: FE's 31 UI keys (ADR-018). Kept explicit so a rename on either side fails a test
#: instead of silently turning every prompt into a no-op.
FE_KEYS: tuple[str, ...] = (
    "wizard_consent",
    "wizard_applicant_full_name",
    "wizard_applicant_cnic",
    "wizard_applicant_dob",
    "wizard_spouse_full_name",
    "wizard_spouse_cnic",
    "wizard_applicant_district",
    "wizard_children_under_18",
    "wizard_household_size",
    "wizard_monthly_income_pkr",
    "wizard_payout_phone",
    "wizard_cnic_doc",
    "wizard_death_cert_doc",
    "wizard_review",
    "wizard_queued",
    "wizard_submitted",
    "home_apply",
    "home_cases",
    "home_scam",
    "home_data",
    "ask_intro",
    "cases_title",
    "consent_intro",
    "consent_access_log",
    "mydata_intro",
    "scam_intro",
    "transparency_intro",
    "scam_verified_official",
    "scam_likely_safe",
    "scam_cannot_tell",
    "scam_likely_scam",
    # ADR-018 counted 31; the login and helper screens landed afterwards and ask
    # for five more. They are FE call sites, so they belong in the registry.
    "wizard_income",
    "login_welcome",
    "helper_intro",
    "helper_switch",
    "helper_add_family",
)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def _render(text: str, voice: str) -> bytes:
    import edge_tts  # type: ignore

    communicate = edge_tts.Communicate(text, voice)
    chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio":
            chunks.append(chunk["data"])
    return b"".join(chunks)


def build_manifest(statuses: dict[str, str] | None = None) -> dict[str, Any]:
    """Return the canonical manifest: a flat ``{key: text}`` map plus ``_meta``.

    ADR-018 pins this shape. FE reads the file as ``Record<string, string>`` and
    keeps only string values, so ``_meta`` is invisible to it while still carrying
    the voice/language/file data a producer needs.
    """
    statuses = statuses or {}
    manifest: dict[str, Any] = dict(PROMPTS)
    manifest["_meta"] = {
        "voice": VOICE,
        "voice_alt": VOICE_ALT,
        "language": "ur-PK",
        "count": len(PROMPTS),
        "fe_keys": len(FE_KEYS),
        "files": {
            key: {
                "file": f"{key}.mp3",
                "sha256": _sha256(text),
                "status": statuses.get(key, "pending"),
            }
            for key, text in PROMPTS.items()
        },
    }
    return manifest


def generate(
    *,
    force: bool = False,
    manifest_only: bool = False,
    output_dir: Path | None = None,
) -> dict[str, Any]:
    target = output_dir or OUTPUT_DIR
    target.mkdir(parents=True, exist_ok=True)

    statuses: dict[str, str] = {}
    rendered = 0
    failed = 0

    if not manifest_only:
        for key, text in PROMPTS.items():
            path = target / f"{key}.mp3"
            if path.exists() and not force:
                statuses[key] = "cached"
                continue
            try:
                audio = asyncio.run(_render(text, VOICE))
            except Exception as exc:
                logger.warning("TTS render failed for %s: %s", key, exc)
                statuses[key] = "pending"
                failed += 1
                continue
            if not audio:
                statuses[key] = "pending"
                failed += 1
                continue
            path.write_bytes(audio)
            statuses[key] = "rendered"
            rendered += 1

    manifest = build_manifest(statuses)
    (target / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    return {
        "output_dir": str(target),
        "keys": len(PROMPTS),
        "rendered": rendered,
        "failed": failed,
        "manifest": str(target / "manifest.json"),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.ai.tts_pregen")
    parser.add_argument("--force", action="store_true", help="re-render every prompt")
    parser.add_argument(
        "--manifest-only",
        action="store_true",
        help="write manifest.json without touching the audio files",
    )
    parser.add_argument("--out", default=None, help="override the output directory")
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    summary = generate(
        force=args.force,
        manifest_only=args.manifest_only,
        output_dir=Path(args.out) if args.out else None,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    if summary["failed"]:
        print(
            "Some prompts could not be rendered (no network or edge-tts blocked). "
            "The manifest is written; the frontend degrades silently to on-screen text.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())


__all__ = [
    "FE_KEYS",
    "OUTPUT_DIR",
    "PROMPTS",
    "VOICE",
    "build_manifest",
    "generate",
    "main",
]
