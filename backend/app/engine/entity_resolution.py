"""Entity resolution for messy Pakistani records (Challenge 03).

Source of truth: ``docs/06-decision-engine.md`` §5.1 (normalisation pipeline) and
§5.2 (record matching policy).

Two rules govern everything here:

1. **Never match on name alone.** A name-only lookup can only ever produce a
   provisional match or an ambiguity flag, never a confirmed identity.
2. **Never pick a top-1 silently.** Two plausible candidates is an ambiguity for a
   human, not a coin flip for a machine.

``name_sim`` is a frozen cross-team interface: ``app.ai.doc_verify`` calls it for the
OCR-vs-QR cross-check at threshold 0.80 (docs/07 §5.1).

Purity: stdlib + pydantic + rapidfuzz only.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from enum import Enum

from pydantic import BaseModel, ConfigDict
from rapidfuzz import fuzz
from rapidfuzz.distance import JaroWinkler

from app.engine.anomalies import (
    RiskFlag,
    detect_cnic_not_in_registry,
    detect_identity_conflict,
    detect_identity_name_variant,
    detect_possible_duplicate_identity,
    sort_flags,
)
from app.engine.confidence import (
    IDENTITY_PROVISIONAL_NAME_ONLY,
    identity_confidence_for_cnic_match,
    identity_confidence_for_name_only,
)
from app.engine.facts import is_valid_cnic, parse_iso_date

__all__ = [
    "HONORIFICS",
    "IdentityCandidate",
    "IdentityResolution",
    "MatchOutcome",
    "canonical_name",
    "name_sim",
    "normalize_unicode",
    "phonetic_key",
    "resolve_identity",
    "transliterate_urdu",
]

# -- 1. script detection & transliteration -------------------------------
#: Arabic/Urdu codepoint variants that must collapse before comparison.
_CHAR_VARIANTS = {
    "\u064a": "\u06cc",  # ARABIC YEH        -> FARSI YEH
    "\u0643": "\u06a9",  # ARABIC KAF        -> KEHEH
    "\u0629": "\u06c1",  # TEH MARBUTA       -> HEH GOAL
    "\u06c3": "\u06c1",  # TEH MARBUTA GOAL  -> HEH GOAL
    "\u0623": "\u0627",  # ALEF WITH HAMZA   -> ALEF
    "\u0625": "\u0627",
    "\u0622": "\u0627",
    "\u0624": "\u0648",  # WAW WITH HAMZA    -> WAW
    "\u0626": "\u06cc",  # YEH WITH HAMZA    -> FARSI YEH
    "\u0649": "\u06cc",  # ALEF MAKSURA      -> FARSI YEH
}

_DIACRITICS_RE = re.compile(r"[\u064b-\u065f\u0670\u0640]")
_PUNCT_RE = re.compile(r"[^0-9a-z\u0600-\u06ff\s]")
_URDU_RE = re.compile(r"[\u0600-\u06ff]")

#: Deterministic Urdu -> Roman-Urdu word table for common name tokens.
URDU_WORD_MAP: dict[str, str] = {
    "مسماۃ": "mst",
    "مسماه": "mst",
    "مسمات": "mst",
    "محمد": "muhammad",
    "احمد": "ahmed",
    "فاطمہ": "fatima",
    "فاطمۃ": "fatima",
    "عائشہ": "ayesha",
    "عایشہ": "ayesha",
    "حسین": "hussain",
    "حسینہ": "hussain",
    "رسول": "rasool",
    "غلام": "ghulam",
    "اکرم": "akram",
    "بیگم": "begum",
    "بخت": "bakht",
    "زمان": "zaman",
    "شاہ": "shah",
    "ملک": "malik",
    "خاتون": "khatoon",
    "بی": "bibi",
    "سید": "syed",
    "حاجی": "haji",
    "علی": "ali",
    "نور": "noor",
    "جان": "jan",
    "دین": "din",
    "اللہ": "allah",
    "عبد": "abdul",
    "زینب": "zainab",
    "خدیجہ": "khadija",
    "شاہدہ": "shahida",
    "نسرین": "nasreen",
    "پروین": "parveen",
    "زبیدہ": "zubaida",
    "سکینہ": "sakina",
    "ناز": "naz",
    "رانی": "rani",
    "بھٹی": "bhatti",
    "سومرو": "soomro",
    "بلوچ": "baloch",
    "میمن": "memon",
    "شیخ": "shaikh",
    "قریشی": "qureshi",
    "عباسی": "abbasi",
    "لغاری": "laghari",
    "چانڈیو": "chandio",
    "جکھیو": "jokhio",
    "سمو": "samo",
    "ٹونیو": "tunio",
    "پلیجو": "palijo",
    "ناریجو": "narejo",
    "ساہیتو": "sahito",
    "کھوسو": "khoso",
    "مہر": "mehar",
    "گل": "gul",
    "حسن": "hassan",
    "امام": "imam",
    "بخش": "baksh",
}

#: Multi-word phrases resolved before tokenisation (e.g. "بی بی" -> "bibi").
URDU_PHRASE_MAP: dict[str, str] = {
    "بی بی": "bibi",
    "بے بی": "bibi",
    "مسماۃ بی بی": "mst bibi",
    "مسماه بی بی": "mst bibi",
}

_URDU_CHAR_MAP: dict[str, str] = {
    "\u0627": "a",  # ا
    "\u0628": "b",  # ب
    "\u067e": "p",  # پ
    "\u062a": "t",  # ت
    "\u0679": "t",  # ٹ
    "\u062b": "s",  # ث
    "\u062c": "j",  # ج
    "\u0686": "ch",  # چ
    "\u062d": "h",  # ح
    "\u062e": "kh",  # خ
    "\u062f": "d",  # د
    "\u0688": "d",  # ڈ
    "\u0630": "z",  # ذ
    "\u0631": "r",  # ر
    "\u0691": "r",  # ڑ
    "\u0632": "z",  # ز
    "\u0698": "zh",  # ژ
    "\u0633": "s",  # س
    "\u0634": "sh",  # ش
    "\u0635": "s",  # ص
    "\u0636": "z",  # ض
    "\u0637": "t",  # ط
    "\u0638": "z",  # ظ
    "\u0639": "",  # ع (vowel carrier)
    "\u063a": "gh",  # غ
    "\u0641": "f",  # ف
    "\u0642": "q",  # ق
    "\u06a9": "k",  # ک
    "\u06af": "g",  # گ
    "\u0644": "l",  # ل
    "\u0645": "m",  # م
    "\u0646": "n",  # ن
    "\u06ba": "n",  # ں
    "\u0648": "o",  # و
    "\u06c1": "h",  # ہ
    "\u06be": "h",  # ھ
    "\u0621": "",  # ء
    "\u06cc": "i",  # ی
    "\u06d2": "e",  # ے
    "\u06d3": "e",  # ۓ
}

# -- 2. honorific stripping ----------------------------------------------
HONORIFICS: frozenset[str] = frozenset(
    {
        "mst",
        "musammat",
        "bibi",
        "bano",
        "begum",
        "smt",
        "mr",
        "mrs",
        "ms",
        "haji",
        "syed",
        "s",
        "m",
    }
)

# -- 3. phonetic canonicalisation ----------------------------------------
PHONETIC_TOKEN_MAP: dict[str, str] = {
    "muhammad": "muhammad",
    "mohammad": "muhammad",
    "muhammed": "muhammad",
    "mohammed": "muhammad",
    "mohamad": "muhammad",
    "mohamed": "muhammad",
    "mohd": "muhammad",
    "muhd": "muhammad",
    "md": "muhammad",
    "rasool": "rasool",
    "rasul": "rasool",
    "fatima": "fatima",
    "fatimah": "fatima",
    "fatma": "fatima",
    "fatema": "fatima",
    "ayesha": "ayesha",
    "aisha": "ayesha",
    "aysha": "ayesha",
    "aishah": "ayesha",
    "husain": "hussain",
    "hussain": "hussain",
    "hussein": "hussain",
    "hossein": "hussain",
    "hussian": "hussain",
    "abdul": "abdul",
    "abdal": "abdul",
}

_DOUBLE_CONSONANT_RE = re.compile(r"([bcdfghjklmnpqrstvwxyz])\1+")


def normalize_unicode(text: str) -> str:
    """NFC, Arabic/Urdu variant folding, diacritic and tatweel removal."""
    if not text:
        return ""
    normalized = unicodedata.normalize("NFC", text)
    for source, target in _CHAR_VARIANTS.items():
        normalized = normalized.replace(source, target)
    normalized = _DIACRITICS_RE.sub("", normalized)
    return " ".join(normalized.split())


# Lookup tables are keyed on the *normalised* form so a table entry written with
# ARABIC TEH MARBUTA still matches input that normalises to HEH GOAL.
_URDU_WORD_LOOKUP: dict[str, str] = {
    normalize_unicode(key): value for key, value in URDU_WORD_MAP.items()
}
_URDU_PHRASE_LOOKUP: dict[str, str] = {
    normalize_unicode(key): value for key, value in URDU_PHRASE_MAP.items()
}
_URDU_PHRASE_KEYS: tuple[str, ...] = tuple(
    sorted(_URDU_PHRASE_LOOKUP, key=len, reverse=True)
)


def _transliterate_token(token: str) -> str:
    mapped = _URDU_WORD_LOOKUP.get(token)
    if mapped is not None:
        return mapped
    if not _URDU_RE.search(token):
        return token
    out: list[str] = []
    for index, char in enumerate(token):
        if char == "\u06c1" and index == len(token) - 1:
            # Word-final HEH GOAL is the Urdu "a"/"ah" ending: فاطمہ -> fatima.
            out.append("a")
            continue
        out.append(_URDU_CHAR_MAP.get(char, ""))
    return "".join(out)


def transliterate_urdu(text: str) -> str:
    """Deterministic Urdu -> Roman-Urdu mapping so both scripts compare directly."""
    if not text:
        return ""
    working = text
    for phrase in _URDU_PHRASE_KEYS:
        working = working.replace(phrase, _URDU_PHRASE_LOOKUP[phrase])
    return " ".join(_transliterate_token(token) for token in working.split())


def _strip_honorifics(tokens: list[str]) -> list[str]:
    kept = [token for token in tokens if token not in HONORIFICS]
    return kept or tokens


def _phonetic_token(token: str) -> str:
    mapped = PHONETIC_TOKEN_MAP.get(token, token)
    collapsed = _DOUBLE_CONSONANT_RE.sub(r"\1", mapped)
    return (
        collapsed.replace("ee", "i")
        .replace("oo", "u")
        .replace("ph", "f")
        .replace("kh", "k")
        .replace("q", "k")
    )


def canonical_name(name: str | None) -> str:
    """Full normalisation pipeline (docs/06 §5.1 steps 1-3)."""
    if not name:
        return ""
    text = normalize_unicode(name)
    text = transliterate_urdu(text)
    text = text.lower()
    text = _PUNCT_RE.sub(" ", text)
    tokens = [token for token in text.split() if token]
    tokens = _strip_honorifics(tokens)
    tokens = [token for token in (_phonetic_token(token) for token in tokens) if token]
    return " ".join(tokens)


def phonetic_key(name: str | None) -> str:
    """Secondary key with ``z -> s`` folding (docs/06 §5.1 step 3)."""
    return canonical_name(name).replace("z", "s")


def _similarity(left: str, right: str) -> float:
    """``max(jaro_winkler, token_set_ratio / 100)`` over two canonical strings."""
    jaro = JaroWinkler.similarity(left, right)
    token_set = fuzz.token_set_ratio(left, right) / 100.0
    return max(jaro, token_set)


def name_sim(a: str | None, b: str | None) -> float:
    """``min(full, given)`` over canonical forms (docs/06 §5.1, ADR-017).

    ``full`` is ``max(jaro_winkler, token_set_ratio / 100)``. ``given`` is the same
    measure over the first canonical token only, which stops a shared surname from
    carrying a different given name over the 0.80 threshold: ``"Zainab Khan"`` vs
    ``"Sakina Khan"`` scores 0.867 on the full string but 0.778 once the given names
    are compared. The guard can only lower a score, so it can only add human review.

    Honorific stripping already handles the demo cast's shared ``Bibi``
    (``"Zainab Bibi"`` vs ``"Sakina Bibi"`` is 0.778 before the guard), and the
    golden path stays at 1.0 because ``"Mst. Fatima Bibi"`` and ``"Fatima Bibi"``
    canonicalise to the same single token.

    Frozen cross-team interface: ``app.ai.doc_verify`` calls this at threshold 0.80.
    """
    canonical_a = canonical_name(a)
    canonical_b = canonical_name(b)
    if not canonical_a or not canonical_b:
        return 0.0
    full = _similarity(canonical_a, canonical_b)
    given = _similarity(canonical_a.split()[0], canonical_b.split()[0])
    return round(min(full, given), 4)


# -- 4. record matching (docs/06 §5.2) -----------------------------------
class MatchOutcome(str, Enum):
    MATCH = "MATCH"
    SOFT_MATCH = "SOFT_MATCH"
    CONFLICT = "CONFLICT"
    NO_MATCH = "NO_MATCH"
    PROVISIONAL_MATCH = "PROVISIONAL_MATCH"
    AMBIGUOUS = "AMBIGUOUS"
    UNKNOWN = "UNKNOWN"


class IdentityCandidate(BaseModel):
    """One identity-registry record as returned by ``/mock/v1/identity/lookup``."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    cnic_digits: str
    full_name: str
    full_name_ur: str | None = None
    father_or_spouse_name: str | None = None
    dob: str | None = None
    gender: str | None = None
    district: str | None = None
    is_alive: bool | None = None
    cnic_expiry_date: str | None = None
    marital_status: str | None = None


class IdentityResolution(BaseModel):
    """Outcome of matching a declared applicant against registry candidates."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    outcome: MatchOutcome
    confidence: float
    name_similarity: float
    matched: IdentityCandidate | None = None
    candidate_count: int = 0
    flags: tuple[RiskFlag, ...] = ()
    spelling_variant: bool = False
    raw_variant: bool = False
    method: str = "CNIC"
    detail_en: str = ""
    detail_ur: str = ""

    @property
    def is_confirmed(self) -> bool:
        return self.outcome is MatchOutcome.MATCH


def _dob_within_one_year(left: str | None, right: str | None) -> bool:
    left_date = parse_iso_date(left)
    right_date = parse_iso_date(right)
    if left_date is None or right_date is None:
        return False
    return abs(left_date.year - right_date.year) <= 1


def _dob_agrees(left: str | None, right: str | None) -> bool:
    """A CNIC match is not penalised when either DOB is simply unrecorded."""
    left_date = parse_iso_date(left)
    right_date = parse_iso_date(right)
    if left_date is None or right_date is None:
        return True
    return abs(left_date.year - right_date.year) <= 1


def resolve_identity(
    *,
    declared_name: str | None,
    declared_dob: str | None = None,
    declared_district: str | None = None,
    cnic: str | None = None,
    candidates: Sequence[IdentityCandidate] = (),
) -> IdentityResolution:
    """Apply docs/06 §5.2 Case A (CNIC given) or Case B (no CNIC)."""
    if is_valid_cnic(cnic):
        return _resolve_with_cnic(
            declared_name=declared_name,
            declared_dob=declared_dob,
            cnic=cnic,
            candidates=candidates,
        )
    return _resolve_without_cnic(
        declared_name=declared_name,
        declared_dob=declared_dob,
        declared_district=declared_district,
        candidates=candidates,
    )


def _resolve_with_cnic(
    *,
    declared_name: str | None,
    declared_dob: str | None,
    cnic: str,
    candidates: Sequence[IdentityCandidate],
) -> IdentityResolution:
    found = next((c for c in candidates if c.cnic_digits == cnic), None)
    if found is None:
        flag = detect_cnic_not_in_registry(cnic)
        return IdentityResolution(
            outcome=MatchOutcome.NO_MATCH,
            confidence=0.25,
            name_similarity=0.0,
            matched=None,
            candidate_count=len(candidates),
            flags=sort_flags([flag] if flag else []),
            method="CNIC",
            detail_en="CNIC not found in the identity registry.",
            detail_ur="شناختی نمبر شناختی رجسٹری میں موجود نہیں۔",
        )

    similarity = name_sim(declared_name, found.full_name)
    dob_match = _dob_agrees(declared_dob, found.dob)
    confidence = identity_confidence_for_cnic_match(similarity, dob_match=dob_match)
    raw_variant = (declared_name or "").strip().casefold() != found.full_name.strip().casefold()

    flags: list[RiskFlag] = []
    if similarity >= 0.70:
        outcome = MatchOutcome.MATCH
        spelling_variant = similarity < 0.85
        detail_en = (
            "Registry match confirmed; spelling variant recorded."
            if spelling_variant
            else "Registry match confirmed."
        )
        detail_ur = (
            "رجسٹری سے تصدیق ہو گئی؛ ہجے کا فرق ریکارڈ کر لیا گیا۔"
            if spelling_variant
            else "رجسٹری سے تصدیق ہو گئی۔"
        )
    elif similarity >= 0.55:
        outcome = MatchOutcome.SOFT_MATCH
        spelling_variant = True
        variant_flag = detect_identity_name_variant(similarity)
        if variant_flag:
            flags.append(variant_flag)
        detail_en = "CNIC matches but the name is a spelling variant; officer check needed."
        detail_ur = "شناختی نمبر مطابقت رکھتا ہے مگر نام کے ہجے مختلف ہیں؛ افسر کی جانچ ضروری ہے۔"
    else:
        outcome = MatchOutcome.CONFLICT
        spelling_variant = False
        conflict_flag = detect_identity_conflict(similarity)
        if conflict_flag:
            flags.append(conflict_flag)
        detail_en = "CNIC matches but the name is a different person; never merged."
        detail_ur = "شناختی نمبر مطابقت رکھتا ہے مگر نام مختلف شخص کا ہے؛ ضم نہیں کیا گیا۔"

    if not dob_match:
        detail_en += " Date of birth disagrees with the registry record."
        detail_ur += " تاریخ پیدائش رجسٹری کے ریکارڈ سے مختلف ہے۔"

    return IdentityResolution(
        outcome=outcome,
        confidence=confidence,
        name_similarity=similarity,
        matched=found,
        candidate_count=len(candidates),
        flags=sort_flags(flags),
        spelling_variant=spelling_variant,
        raw_variant=raw_variant,
        method="CNIC",
        detail_en=detail_en,
        detail_ur=detail_ur,
    )


def _resolve_without_cnic(
    *,
    declared_name: str | None,
    declared_dob: str | None,
    declared_district: str | None,
    candidates: Sequence[IdentityCandidate],
) -> IdentityResolution:
    if not candidates:
        return IdentityResolution(
            outcome=MatchOutcome.UNKNOWN,
            confidence=identity_confidence_for_name_only(0, 0.0, dob_match=False),
            name_similarity=0.0,
            matched=None,
            candidate_count=0,
            method="NAME_DISTRICT",
            detail_en="No registry candidate matched the name and district; CNIC required.",
            detail_ur="نام اور ضلع سے کوئی ریکارڈ مطابقت نہیں رکھتا؛ شناختی نمبر درکار ہے۔",
        )

    if len(candidates) >= 2:
        flag = detect_possible_duplicate_identity(len(candidates))
        return IdentityResolution(
            outcome=MatchOutcome.AMBIGUOUS,
            confidence=identity_confidence_for_name_only(
                len(candidates), 0.0, dob_match=False
            ),
            name_similarity=0.0,
            matched=None,
            candidate_count=len(candidates),
            flags=sort_flags([flag] if flag else []),
            method="NAME_DISTRICT",
            detail_en=(
                f"{len(candidates)} registry records match; never picking one silently."
            ),
            detail_ur=(
                f"{len(candidates)} ریکارڈ مطابقت رکھتے ہیں؛ خود سے انتخاب نہیں کیا جائے گا۔"
            ),
        )

    single = candidates[0]
    similarity = name_sim(declared_name, single.full_name)
    dob_ok = _dob_within_one_year(declared_dob, single.dob)
    if similarity >= 0.88 and dob_ok:
        return IdentityResolution(
            outcome=MatchOutcome.PROVISIONAL_MATCH,
            confidence=IDENTITY_PROVISIONAL_NAME_ONLY,
            name_similarity=similarity,
            matched=single,
            candidate_count=1,
            method="NAME_DISTRICT",
            detail_en=(
                "Single strong name match; provisional only, CNIC proof or an officer "
                "is still required."
            ),
            detail_ur=(
                "نام سے ایک مضبوط مماثلت ملی؛ یہ صرف عارضی ہے، شناختی نمبر یا افسر درکار ہے۔"
            ),
        )

    return IdentityResolution(
        outcome=MatchOutcome.UNKNOWN,
        confidence=identity_confidence_for_name_only(1, similarity, dob_match=False),
        name_similarity=similarity,
        matched=None,
        candidate_count=1,
        method="NAME_DISTRICT",
        detail_en="Single candidate did not clear the 0.88 name and DOB bar; CNIC required.",
        detail_ur="واحد ریکارڈ نام اور تاریخ پیدائش کی شرط پوری نہیں کرتا؛ شناختی نمبر درکار ہے۔",
    )
