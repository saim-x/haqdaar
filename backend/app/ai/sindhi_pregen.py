"""Render fixed Sindhi prompts with Gemini. Requires the build-time lameenc package.

Run from the checkout: python -m app.ai.sindhi_pregen
Use --espeak espeak-ng for offline rendering or --upgrade-espeak to replace
offline clips with Gemini when quota is available.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import subprocess
import wave
from pathlib import Path

from app.ai.provider import ProviderError
from app.ai.sindhi import _synthesize_gemini
from app.config import get_settings

FRONTEND = Path(__file__).resolve().parents[3] / "frontend"
OUTPUT = FRONTEND / "public/audio/sd"
# Store MP3 bytes as app assets so browser download managers see non-media URLs.
CLIP_SUFFIX = ".clip"

PROMPTS = {
    "wizard_consent": "درخواست جانچڻ لاءِ سماجي بهبود کاتي کي توهان جي سڃاڻپ، گهريلو معلومات ۽ دستاويز ڏسڻ جي اجازت ڏيو. توهان ڪنهن به وقت اجازت واپس وٺي سگهو ٿا.",
    "wizard_applicant_full_name": "مهرباني ڪري پنهنجو پورو نالو ڳالهايو يا لکو.",
    "wizard_applicant_cnic": "پنهنجي سڃاڻپ ڪارڊ جا تيرهن انگ هڪ هڪ ڪري چئو يا ڪي پيڊ سان لکو.",
    "wizard_applicant_dob": "مهرباني ڪري پنهنجي ڄم جي تاريخ ٻڌايو.",
    "wizard_spouse_full_name": "مهرباني ڪري پنهنجي مڙس جو پورو نالو ٻڌايو يا لکو.",
    "wizard_spouse_cnic": "پنهنجي مڙس جي سڃاڻپ ڪارڊ جا انگ ٻڌايو. جيڪڏهن خبر ناهي ته مون کي خبر ناهي وارو بٽڻ دٻايو.",
    "wizard_applicant_district": "مهرباني ڪري پنهنجو ضلعو چونڊيو.",
    "wizard_children_under_18": "توهان جا ارڙهن سالن کان ننڍا ڪيترا ٻار آهن؟",
    "wizard_household_size": "توهان جي گهر ۾ ڪيترا ماڻهو رهن ٿا؟",
    "wizard_monthly_income_pkr": "توهان جي گهر جي ماهوار آمدني ڪيتري آهي؟",
    "wizard_payout_phone": "اهو موبائل نمبر ٻڌايو جنهن تي امداد موڪلڻي آهي. نمبر توهان جي نالي تي هجي.",
    "wizard_cnic_doc": "پنهنجي سڃاڻپ ڪارڊ جي سامهون واري پاسي جي صاف تصوير وٺو.",
    "wizard_death_cert_doc": "پنهنجي مڙس جي وفات جي سرٽيفڪيٽ جي تصوير وٺو.",
    "wizard_review": "درخواست جمع ڪرڻ کان اڳ پنهنجا جواب چيڪ ڪريو.",
    "wizard_queued": "توهان جي درخواست محفوظ آهي. انٽرنيٽ اچڻ تي پاڻ موڪلي ويندي.",
    "wizard_submitted": "توهان جي درخواست جمع ٿي وئي آهي. توهان کي پيغام ملندو.",
    "home_apply": "نئين درخواست ڏيڻ لاءِ هتي دٻايو.",
    "home_cases": "پنهنجين درخواستن جي حالت ڏسڻ لاءِ هتي دٻايو.",
    "home_scam": "شڪي پيغام چيڪ ڪرڻ لاءِ هتي دٻايو.",
    "home_data": "پنهنجي معلومات ۽ اجازتون ڏسڻ لاءِ هتي دٻايو.",
    "ask_intro": "حقدار بابت پنهنجو سوال لکو يا ڳالهايو.",
    "cases_title": "منهنجون درخواستون.",
    "consent_intro": "هتي ڏسو ته توهان جي معلومات ڪير ڏسي سگهي ٿو. توهان ڪنهن به وقت اجازت واپس وٺي سگهو ٿا.",
    "consent_access_log": "هن رڪارڊ ۾ ڏسو ته توهان جي معلومات ڪنهن ۽ ڪڏهن ڏٺي.",
    "mydata_intro": "هتي ڏسو ته توهان جي ڪهڙي معلومات محفوظ آهي.",
    "scam_intro": "شڪي پيغام لکو، ان جي تصوير موڪليو يا پڙهي ٻڌايو ته جيئن ان جي چڪاس ٿئي.",
    "transparency_intro": "هن صفحي تي ڏسو ته حقدار ۾ ڇا اصلي آهي ۽ ڇا نقلي آهي.",
    "login_welcome": "حقدار ۾ ڀليڪار. لاگ ان ڪرڻ لاءِ پنهنجو موبائل نمبر لکو.",
    "helper_intro": "هتان توهان پنهنجن خاندانن جي درخواستن ۾ مدد ڪري سگهو ٿا.",
    "helper_switch": "توهان هاڻي هن خاندان جي مدد ڪري رهيا آهيو.",
    "helper_add_family": "نئون خاندان شامل ڪرڻ لاءِ هتي دٻايو.",
    "mydata_identity": "سڃاڻپ جي معلومات.",
    "mydata_household": "گهريلو معلومات.",
    "mydata_documents": "دستاويز.",
    "mydata_payment": "ادائيگي جي معلومات.",
    "mydata_case_history": "درخواستن جو رڪارڊ.",
    "scam_verified_official": "هي پيغام حقدار جي تصديق ٿيل اطلاع سان ملي ٿو.",
    "scam_likely_scam": "هي پيغام جعلي لڳي ٿو. پئسا نه موڪليو، تصديقي ڪوڊ يا پن نه ڏيو ۽ لنڪ نه کوليو.",
    "scam_cannot_tell": "هن پيغام بابت پڪ سان نٿو چئي سگهجي. ڪجهه ڪرڻ کان اڳ مددگار يا سرڪاري ذريعي کان تصديق ڪريو.",
    "scam_likely_safe": "هن پيغام ۾ فريب جون عام نشانيون نه مليون. پوءِ به احتياط ڪريو.",
    "consent_grant_confirm": "توهان اجازت ڏئي ڇڏي آهي. مهرباني. هاڻي درخواست شروع ڪريون ٿا.",
    "consent_required": "درخواست جاري رکڻ لاءِ اجازت گهربل آهي.",
    "consent_withdrawn": "توهان اجازت واپس ورتي آهي. درخواست روڪي وئي آهي.",
    "readback_confirm": "ڇا هي درست آهي؟",
    "wizard_input_empty": "هي خانو خالي آهي.",
    "needs_retry": "سمجهه ۾ نه آيو. مهرباني ڪري وري ڳالهايو يا ڪي پيڊ استعمال ڪريو.",
    "unknown_ok": "ڪا ڳالهه ناهي. پوءِ ٻڌائي سگهو ٿا.",
    "doc_verified": "توهان جو دستاويز درست آهي. مهرباني.",
    "doc_unverifiable": "اسان دستاويز جي تصديق نه ڪري سگهياسين. مهرباني ڪري ٻيهر ڪوشش ڪريو.",
    "doc_tamper_review": "دستاويز ۾ ڪجهه فرق آهي، تنهنڪري آفيسر ان جو جائزو وٺندو.",
    "doc_needs_retake": "هن دستاويز جي تصوير ٻيهر وٺو.",
    "retake_blurry": "تصوير ڌنڌلي آهي. فون ٻنهي هٿن سان جهلي سٺي روشني ۾ ٻيهر تصوير وٺو.",
    "retake_qr_missing": "دستاويز جو حفاظتي ڪوڊ پڙهي نه سگهياسين. مهرباني ڪري وڌيڪ صاف تصوير وٺو.",
    "retake_too_small": "تصوير تمام ننڍي آهي. مهرباني ڪري ويجهو ٿي صاف تصوير وٺو.",
    "offline_saved": "انٽرنيٽ ناهي. معلومات محفوظ آهي ۽ انٽرنيٽ اچڻ تي پاڻ موڪلي ويندي.",
    "network_error": "انٽرنيٽ ۾ مسئلو آهي. ٿوري دير کان پوءِ ٻيهر ڪوشش ڪريو.",
    "status_draft": "توهان جي درخواست محفوظ آهي.",
    "status_submitted": "توهان جي درخواست جمع ٿي وئي آهي. جاچ جاري آهي.",
    "status_processing": "توهان جي درخواست جي جاچ جاري آهي.",
    "status_waiting_external": "هڪ سرڪاري نظام جو انتظار آهي. توهان جي معلومات محفوظ آهي ۽ ڪم پاڻ جاري ٿيندو.",
    "status_needs_info": "توهان جي درخواست لاءِ وڌيڪ معلومات گهرجي.",
    "status_human_review": "هڪ آفيسر توهان جي درخواست جو جائزو وٺندو.",
    "status_in_review": "هڪ آفيسر هاڻي توهان جي درخواست ڏسي رهيو آهي.",
    "status_pending_second_approval": "آخري منظوري جاري آهي.",
    "status_on_hold_consent": "اجازت واپس وٺڻ سبب توهان جي درخواست روڪي وئي آهي.",
    "status_approved": "مبارڪون. توهان جي درخواست منظور ٿي وئي آهي ۽ رقم موڪلي پئي وڃي.",
    "status_payment_initiated": "رقم موڪلي پئي وڃي.",
    "status_paid": "رقم توهان جي اڪائونٽ ۾ پهچي وئي آهي.",
    "status_payment_failed": "ادائيگي ۾ مسئلو آهي. هڪ آفيسر توهان سان رابطو ڪندو.",
    "status_rejected": "توهان جي درخواست منظور نه ٿي. سبب درخواست ۾ لکيل آهن.",
    "status_withdrawn": "توهان پنهنجي درخواست واپس ورتي آهي.",
    "status_closed": "توهان جي درخواست مڪمل ٿي وئي آهي.",
}
PROMPTS["wizard_income"] = PROMPTS["wizard_monthly_income_pkr"]
PROMPTS["submit_confirm"] = PROMPTS["wizard_submitted"]
PROMPTS["wizard_welcome"] = PROMPTS["wizard_consent"]


def _prompts() -> dict[str, str]:
    tour = json.loads((FRONTEND / "src/shared/audio/sindhiTour.json").read_text(encoding="utf-8"))
    prompts = dict(PROMPTS)
    for key, (title, body, *_) in tour.items():
        prompts[f"tour_{key}"] = f"{title}. {body}"
        prompts[f"tour_{key}_title"] = title
        prompts[f"tour_{key}_body"] = body
    return prompts


def _mp3(wav: bytes) -> bytes:
    import lameenc  # type: ignore[import-not-found]

    with wave.open(io.BytesIO(wav), "rb") as audio:
        encoder = lameenc.Encoder()
        encoder.set_in_sample_rate(audio.getframerate())
        encoder.set_channels(audio.getnchannels())
        encoder.set_bit_rate(40)
        encoder.set_quality(2)
        return encoder.encode(audio.readframes(audio.getnframes())) + encoder.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--espeak", metavar="EXE", help="render missing clips with eSpeak NG")
    source.add_argument("--upgrade-espeak", action="store_true", help="replace eSpeak clips with Gemini")
    args = parser.parse_args()
    key = get_settings().gemini_api_key.strip()
    if not args.espeak and not key:
        raise SystemExit("Set GEMINI_API_KEY before generating Sindhi clips")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUTPUT / "manifest.json"
    old = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
    prompts = _prompts()
    groups: dict[str, list[str]] = {}
    for name, text in prompts.items():
        groups.setdefault(text, []).append(name)

    def save_manifest() -> None:
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Preserve the entries and files from previous runs, including the ones
    # after a rate limit stops this pass.
    manifest = {name: old[name] for name in prompts if name in old}
    failed = 0
    for text, names in groups.items():
        digest = hashlib.sha256(text.encode()).hexdigest()
        paths = [OUTPUT / f"{name}{CLIP_SUFFIX}" for name in names]
        existing = next(
            (
                (name, path)
                for name, path in zip(names, paths, strict=True)
                if old.get(name, {}).get("sha256") == digest
                and path.is_file()
                and (not args.upgrade_espeak or old[name].get("source") != "espeak-ng")
            ),
            None,
        )
        if existing:
            existing_name, existing_path = existing
            data = existing_path.read_bytes()
            voice = old[existing_name].get("source", "gemini")
        else:
            try:
                if args.espeak:
                    # The executable is selected by the operator. Speech text is stdin only.
                    wav = subprocess.run(  # noqa: S603
                        [args.espeak, "-v", "sd", "-b", "1", "-s", "145", "--stdin", "--stdout"],
                        input=text.encode(),
                        stdout=subprocess.PIPE,
                        check=True,
                    ).stdout
                    voice = "espeak-ng"
                else:
                    wav = _synthesize_gemini(text, key)
                    voice = "gemini"
                data = _mp3(wav)
            except ProviderError as exc:
                failed += len(names)
                print(f"{names[0]}: {exc.code}", flush=True)
                if exc.code == "HTTP_429":
                    break
                continue
        for name, path in zip(names, paths, strict=True):
            if not existing or path != existing[1]:
                path.write_bytes(data)
            manifest[name] = {"text": prompts[name], "sha256": digest, "source": voice}
        save_manifest()
    ready = sum(
        manifest.get(name, {}).get("sha256") == hashlib.sha256(text.encode()).hexdigest()
        and (OUTPUT / f"{name}{CLIP_SUFFIX}").is_file()
        for name, text in prompts.items()
    )
    print(f"{ready}/{len(prompts)} Sindhi clips ready", flush=True)
    return int(bool(failed) or ready != len(prompts))


if __name__ == "__main__":
    raise SystemExit(main())
