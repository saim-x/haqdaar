"""Urdu / Roman-Urdu text normalisation for field-scoped parsing (docs/07 §2.2).

Pure Python, no dependencies, no I/O. Everything here is deterministic so the
``FakeDeterministicProvider`` can parse *"اٹھائیس ہزار روپے"* → ``28000`` and
*"ataees hazaar"* → ``28000`` without a network call.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

# --------------------------------------------------------------------------- #
# digits
# --------------------------------------------------------------------------- #
_EASTERN_ARABIC = "۰۱۲۳۴۵۶۷۸۹"
_WESTERN_ARABIC = "٠١٢٣٤٥٦٧٨٩"
_DIGIT_MAP = {ord(ch): str(i) for i, ch in enumerate(_EASTERN_ARABIC)}
_DIGIT_MAP.update({ord(ch): str(i) for i, ch in enumerate(_WESTERN_ARABIC)})

#: Urdu/Arabic punctuation that confuses naive tokenisers.
_PUNCT_MAP = {
    ord("۔"): ".",
    ord("،"): ",",
    ord("؛"): ";",
    ord("؟"): "?",
    ord("٪"): "%",
    ord("\u200c"): "",  # zero-width non-joiner
    ord("\u200d"): "",  # zero-width joiner
    ord("\u200e"): "",
    ord("\u200f"): "",
    ord("\ufeff"): "",
}

#: Arabic-form letters that Urdu writes differently. OCR engines and Arabic
#: keyboards emit the left-hand form; the registry stores the right-hand form.
#: Without this, "يك" and "یک" score as different words and a genuine name fails
#: the 0.80 cross-check.
#:
#: Deliberately narrow: ``ئ``, ``ؤ``, ``آ`` and ``أ`` are distinct Urdu letters,
#: not variants. Folding them corrupts real words - "اٹھائیس" (28) and "آٹھ" (8)
#: both stop parsing.
_LETTER_MAP = {
    ord("ي"): "ی",  # Arabic yeh -> Urdu yeh
    ord("ى"): "ی",  # alef maksura -> Urdu yeh
    ord("ك"): "ک",  # Arabic kaf -> Urdu kaf
    ord("ة"): "ہ",  # teh marbuta -> Urdu heh
    ord("ۀ"): "ہ",
    ord("ۃ"): "ہ",
}


def normalize_digits(text: str) -> str:
    """Convert Eastern/Western Arabic-Indic digits to ASCII and strip ZWJ marks."""
    if not text:
        return ""
    return text.translate(_DIGIT_MAP).translate(_PUNCT_MAP)


def normalize_text(text: str) -> str:
    """NFKC-normalise, unify digits and letter variants, collapse whitespace."""
    if not text:
        return ""
    out = unicodedata.normalize("NFKC", text)
    out = normalize_digits(out)
    out = out.translate(_LETTER_MAP)
    out = re.sub(r"\s+", " ", out)
    return out.strip()


# --------------------------------------------------------------------------- #
# number words
# --------------------------------------------------------------------------- #
URDU_UNITS: dict[str, int] = {
    "صفر": 0,
    "ایک": 1,
    "دو": 2,
    "تین": 3,
    "چار": 4,
    "پانچ": 5,
    "چھ": 6,
    "چھے": 6,
    "سات": 7,
    "آٹھ": 8,
    "اٹھ": 8,
    "نو": 9,
    "دس": 10,
    "گیارہ": 11,
    "بارہ": 12,
    "تیرہ": 13,
    "چودہ": 14,
    "پندرہ": 15,
    "سولہ": 16,
    "سترہ": 17,
    "اٹھارہ": 18,
    "انیس": 19,
    "بیس": 20,
    "اکیس": 21,
    "بائیس": 22,
    "تئیس": 23,
    "چوبیس": 24,
    "پچیس": 25,
    "چھبیس": 26,
    "ستائیس": 27,
    "اٹھائیس": 28,
    "انتیس": 29,
    "تیس": 30,
    "اکتیس": 31,
    "بتیس": 32,
    "تینتیس": 33,
    "چونتیس": 34,
    "پینتیس": 35,
    "چھتیس": 36,
    "سینتیس": 37,
    "اڑتیس": 38,
    "انتالیس": 39,
    "چالیس": 40,
    "اکتالیس": 41,
    "بیالیس": 42,
    "تینتالیس": 43,
    "چوالیس": 44,
    "پینتالیس": 45,
    "چھیالیس": 46,
    "سینتالیس": 47,
    "اڑتالیس": 48,
    "انچاس": 49,
    "پچاس": 50,
    "اکاون": 51,
    "باون": 52,
    "ترپن": 53,
    "چون": 54,
    "پچپن": 55,
    "چھپن": 56,
    "ستاون": 57,
    "اٹھاون": 58,
    "انسٹھ": 59,
    "ساٹھ": 60,
    "اکسٹھ": 61,
    "باسٹھ": 62,
    "تریسٹھ": 63,
    "چونسٹھ": 64,
    "پینسٹھ": 65,
    "چھیاسٹھ": 66,
    "سڑسٹھ": 67,
    "اڑسٹھ": 68,
    "انہتر": 69,
    "ستر": 70,
    "اکہتر": 71,
    "بہتر": 72,
    "تہتر": 73,
    "چوہتر": 74,
    "پچہتر": 75,
    "چھہتر": 76,
    "ستتر": 77,
    "اٹھہتر": 78,
    "اناسی": 79,
    "اسی": 80,
    "اکیاسی": 81,
    "بیاسی": 82,
    "تراسی": 83,
    "چوراسی": 84,
    "پچاسی": 85,
    "چھیاسی": 86,
    "ستاسی": 87,
    "اٹھاسی": 88,
    "نواسی": 89,
    "نوے": 90,
    "اکانوے": 91,
    "بانوے": 92,
    "ترانوے": 93,
    "چورانوے": 94,
    "پچانوے": 95,
    "چھیانوے": 96,
    "ستانوے": 97,
    "اٹھانوے": 98,
    "ننانوے": 99,
    "سو": 100,
}

ROMAN_UNITS: dict[str, int] = {
    "sifar": 0,
    "zero": 0,
    "ek": 1,
    "aik": 1,
    "one": 1,
    "do": 2,
    "two": 2,
    "teen": 3,
    "tin": 3,
    "three": 3,
    "char": 4,
    "chaar": 4,
    "four": 4,
    "panch": 5,
    "paanch": 5,
    "five": 5,
    "chay": 6,
    "che": 6,
    "chh": 6,
    "six": 6,
    "saat": 7,
    "sat": 7,
    "seven": 7,
    "aath": 8,
    "ath": 8,
    "eight": 8,
    "nau": 9,
    "no": 9,
    "nine": 9,
    "das": 10,
    "dus": 10,
    "ten": 10,
    "gyarah": 11,
    "gyara": 11,
    "eleven": 11,
    "barah": 12,
    "bara": 12,
    "twelve": 12,
    "terah": 13,
    "tera": 13,
    "thirteen": 13,
    "chaudah": 14,
    "choda": 14,
    "fourteen": 14,
    "pandrah": 15,
    "pandra": 15,
    "fifteen": 15,
    "solah": 16,
    "sola": 16,
    "sixteen": 16,
    "satrah": 17,
    "satra": 17,
    "seventeen": 17,
    "atharah": 18,
    "athara": 18,
    "eighteen": 18,
    "unees": 19,
    "unis": 19,
    "nineteen": 19,
    "bees": 20,
    "bis": 20,
    "twenty": 20,
    "ikees": 21,
    "ekees": 21,
    "twentyone": 21,
    "baees": 22,
    "bais": 22,
    "tayees": 23,
    "teis": 23,
    "chaubees": 24,
    "chobis": 24,
    "pachees": 25,
    "pachis": 25,
    "chhabees": 26,
    "chabis": 26,
    "sataees": 27,
    "satais": 27,
    "ataees": 28,
    "athais": 28,
    "atthais": 28,
    "atees": 28,
    "untees": 29,
    "untis": 29,
    "tees": 30,
    "tis": 30,
    "thirty": 30,
    "iktees": 31,
    "battees": 32,
    "taintees": 33,
    "chauntees": 34,
    "paintees": 35,
    "chhattees": 36,
    "saintees": 37,
    "artees": 38,
    "untalees": 39,
    "chalees": 40,
    "chalis": 40,
    "forty": 40,
    "iktalees": 41,
    "beyalees": 42,
    "taintalees": 43,
    "chawalees": 44,
    "paintalees": 45,
    "chhiyalees": 46,
    "saintalees": 47,
    "artalees": 48,
    "unchaas": 49,
    "pachaas": 50,
    "pachas": 50,
    "fifty": 50,
    "ikawan": 51,
    "bawan": 52,
    "tarpan": 53,
    "chawan": 54,
    "pachpan": 55,
    "chhappan": 56,
    "sattawan": 57,
    "atthawan": 58,
    "unsath": 59,
    "saath": 60,
    "sath": 60,
    "sixty": 60,
    "iksath": 61,
    "basath": 62,
    "tirsath": 63,
    "chonsath": 64,
    "painsath": 65,
    "chhiyasath": 66,
    "sarsath": 67,
    "arsath": 68,
    "unhattar": 69,
    "sattar": 70,
    "seventy": 70,
    "ikhattar": 71,
    "behattar": 72,
    "tihattar": 73,
    "chohattar": 74,
    "pachattar": 75,
    "chhihattar": 76,
    "satattar": 77,
    "athhattar": 78,
    "unasi": 79,
    "assi": 80,
    "eighty": 80,
    "ikyasi": 81,
    "biyasi": 82,
    "tirasi": 83,
    "chourasi": 84,
    "pachasi": 85,
    "chhiyasi": 86,
    "satasi": 87,
    "athasi": 88,
    "unansi": 89,
    "nawwe": 90,
    "nawway": 90,
    "ninety": 90,
    "ikyanwe": 91,
    "banwe": 92,
    "tiranwe": 93,
    "chouranwe": 94,
    "pachanwe": 95,
    "chhiyanwe": 96,
    "sattanwe": 97,
    "atthanwe": 98,
    "ninyanwe": 99,
    "sau": 100,
    "hundred": 100,
}

#: Multipliers. ``None`` means "multiply the running subtotal".
URDU_SCALES: dict[str, int] = {
    "سو": 100,
    "ہزار": 1_000,
    "ہزاروں": 1_000,
    "لاکھ": 100_000,
    "لاکھوں": 100_000,
    "کروڑ": 10_000_000,
}

ROMAN_SCALES: dict[str, int] = {
    "sau": 100,
    "hundred": 100,
    "hazar": 1_000,
    "hazaar": 1_000,
    "hzar": 1_000,
    "thousand": 1_000,
    "hazaroon": 1_000,
    "lakh": 100_000,
    "lac": 100_000,
    "lakhs": 100_000,
    "crore": 10_000_000,
    "k": 1_000,
}

#: Words that mean "I do not know" - mapped to ``USER_UNKNOWN``, never to 0.
UNKNOWN_MARKERS: tuple[str, ...] = (
    "نہیں معلوم",
    "نہیں پتہ",
    "پتہ نہیں",
    "معلوم نہیں",
    "نہیں جانتا",
    "نہیں جانتی",
    "nahi maloom",
    "nahin maloom",
    "maloom nahi",
    "pata nahi",
    "pata nahin",
    "nahi pata",
    "nahin pata",
    "dont know",
    "don't know",
    "do not know",
    "not sure",
    "unknown",
    "skip",
    "chhor do",
    "chor do",
)

#: Filler words ignored while scanning for numbers.
_FILLERS = {
    "روپے",
    "روپہ",
    "rupay",
    "rupees",
    "rupee",
    "rs",
    "pkr",
    "تھا",
    "تھی",
    "تھے",
    "ہے",
    "ہیں",
    "hai",
    "hain",
    "tha",
    "thi",
    "the",
    "about",
    "lagbhag",
    "لگ بھگ",
    "تقریبا",
    "approximately",
    "around",
    "per",
    "month",
    "mahina",
    "mahinay",
    "مہینہ",
    "مہینے",
    "ماہانہ",
    "mahana",
    "monthly",
    "and",
    "aur",
    "اور",
    "only",
    "sirf",
    "صرف",
    "total",
    "کل",
}


def is_unknown(text: str) -> bool:
    """True when the utterance means "I do not know"."""
    normalized = normalize_text(text).lower()
    if not normalized:
        return True
    return any(marker in normalized for marker in UNKNOWN_MARKERS)


def _tokens(text: str) -> list[str]:
    normalized = normalize_text(text).lower()
    normalized = re.sub(r"[^\w\u0600-\u06ff\s.]", " ", normalized)
    return [token for token in normalized.split() if token]


def _word_value(token: str) -> int | None:
    if token in URDU_UNITS:
        return URDU_UNITS[token]
    if token in ROMAN_UNITS:
        return ROMAN_UNITS[token]
    return None


def _scale_value(token: str) -> int | None:
    if token in URDU_SCALES:
        return URDU_SCALES[token]
    if token in ROMAN_SCALES:
        return ROMAN_SCALES[token]
    return None


def parse_number(text: str) -> int | None:
    """Parse an integer from digits or Urdu/Roman-Urdu/English number words.

    ``"اٹھائیس ہزار روپے"`` → 28000, ``"ataees hazaar"`` → 28000,
    ``"28,000"`` → 28000, ``"ایک لاکھ پچیس ہزار"`` → 125000.
    """
    if not text:
        return None
    normalized = normalize_text(text)

    digits = re.search(r"\d[\d,]*(?:\.\d+)?", normalized)
    if digits:
        raw = digits.group(0).replace(",", "")
        try:
            return int(float(raw))
        except ValueError:
            return None

    total = 0
    current = 0
    seen = False
    for token in _tokens(normalized):
        if token in _FILLERS:
            continue
        scale = _scale_value(token)
        if scale is not None:
            seen = True
            if scale == 100:
                current = (current or 1) * 100
            else:
                total += (current or 1) * scale
                current = 0
            continue
        value = _word_value(token)
        if value is not None:
            seen = True
            current += value
            continue
    if not seen:
        return None
    return total + current


# --------------------------------------------------------------------------- #
# CNIC
# --------------------------------------------------------------------------- #
_DIGIT_WORDS_EN = dict(zip(
    ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"),
    range(10),
    strict=True,
))


def parse_digit_sequence(text: str) -> str | None:
    """Join numeric groups and spoken single digits, preserving leading zeros."""
    runs: list[list[str]] = []
    current: list[str] = []
    for token in re.findall(r"\w+", normalize_text(text).lower()):
        if token.isascii() and token.isdecimal():
            current.append(token)
            continue
        digit = _DIGIT_WORDS_EN.get(token, _word_value(token))
        if digit is not None and 0 <= digit <= 9:
            current.append(str(digit))
        elif current:
            runs.append(current)
            current = []
    if current:
        runs.append(current)
    return "".join(runs[0]) if len(runs) == 1 else None


def parse_cnic(text: str) -> str | None:
    """Read a complete CNIC without guessing or dropping digits."""
    digits = parse_digit_sequence(text)
    return digits if digits is not None and len(digits) == 13 else None


def format_cnic(digits: str) -> str:
    """``9990010000012`` → ``99900-1000001-2``."""
    if len(digits) != 13 or not digits.isdigit():
        return digits
    return f"{digits[:5]}-{digits[5:12]}-{digits[12]}"


# --------------------------------------------------------------------------- #
# dates
# --------------------------------------------------------------------------- #
URDU_MONTHS: dict[str, int] = {
    "جنوری": 1,
    "فروری": 2,
    "مارچ": 3,
    "اپریل": 4,
    "مئی": 5,
    "جون": 6,
    "جولائی": 7,
    "اگست": 8,
    "ستمبر": 9,
    "اکتوبر": 10,
    "نومبر": 11,
    "دسمبر": 12,
}

ENGLISH_MONTHS: dict[str, int] = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}


#: Formal Urdu ordinals used when speaking a date ("یکم مارچ" = the 1st of March).
_URDU_ORDINAL_DAYS: dict[str, int] = {
    "یکم": 1,
    "پہلی": 1,
    "دوم": 2,
    "سوئم": 3,
    "چہارم": 4,
    "پنجم": 5,
    "ششم": 6,
    "ہفتم": 7,
    "ہشتم": 8,
    "نہم": 9,
    "دہم": 10,
}


def parse_date(text: str) -> str | None:
    """Parse a date into ISO ``YYYY-MM-DD``; returns ``None`` when unsure."""
    if not text:
        return None
    normalized = normalize_text(text)

    iso = re.search(r"(?<!\d)(\d{4})[-/. ]+(\d{1,2})[-/. ]+(\d{1,2})(?!\d)", normalized)
    if iso:
        return _safe_iso(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))

    numeric = re.search(
        r"(?<!\d)(\d{1,2})[/.\- ]+(\d{1,2})[/.\- ]+(\d{4}|\d{2})(?!\d)",
        normalized,
    )
    if numeric:
        day, month, year = (int(part) for part in numeric.groups())
        if year < 100:
            year += 1900 if year > 30 else 2000
        return _safe_iso(year, month, day)

    lowered = normalized.lower()
    for name, month in {**URDU_MONTHS, **ENGLISH_MONTHS}.items():
        position = lowered.find(name)
        if position < 0:
            continue
        # Split around the month name so the year can never be read as the day.
        before = lowered[:position]
        after = lowered[position + len(name) :]
        day = _spoken_day(before)
        year = _spoken_year(after)
        if day is not None and year is not None:
            return _safe_iso(year, month, day)
        return None
    return None


def _spoken_day(text: str) -> int | None:
    """Read a day-of-month from digits or Urdu number words; ``None`` if unsure."""
    digits = re.search(r"(?<!\d)(\d{1,2})(?!\d)", text)
    if digits:
        value = int(digits.group(1))
        return value if 1 <= value <= 31 else None
    for word, value in _URDU_ORDINAL_DAYS.items():
        if word in text:
            return value
    words = parse_number(text)
    if words is not None and 1 <= words <= 31:
        return words
    return None


def _spoken_year(text: str) -> int | None:
    """Read a four-digit year from digits or Urdu number words; ``None`` if unsure."""
    digits = re.search(r"(?<!\d)(\d{4})(?!\d)", text)
    if digits:
        value = int(digits.group(1))
        return value if 1900 <= value <= 2100 else None
    words = parse_number(text)
    if words is not None and 1900 <= words <= 2100:
        return words
    return None


def _safe_iso(year: int, month: int, day: int) -> str | None:
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
# districts
# --------------------------------------------------------------------------- #
#: Mirrors docs/10 §2 (Sindh districts used by the demo). Kept local because
#: ``app/ai`` must never import ``app.mocks``.
SINDH_DISTRICTS: tuple[str, ...] = (
    "Badin",
    "Dadu",
    "Ghotki",
    "Hyderabad",
    "Jacobabad",
    "Jamshoro",
    "Karachi",
    "Kashmore",
    "Khairpur",
    "Larkana",
    "Matiari",
    "Mirpurkhas",
    "Naushahro Feroze",
    "Qambar Shahdadkot",
    "Sanghar",
    "Shaheed Benazirabad",
    "Shikarpur",
    "Sujawal",
    "Sukkur",
    "Tando Allahyar",
    "Tando Muhammad Khan",
    "Tharparkar",
    "Thatta",
    "Umerkot",
)

_DISTRICT_ALIASES: dict[str, str] = {
    "thata": "Thatta",
    "thatta": "Thatta",
    "ٹھٹھہ": "Thatta",
    "hyderabadd": "Hyderabad",
    "hyd": "Hyderabad",
    "حیدرآباد": "Hyderabad",
    "badin": "Badin",
    "بدین": "Badin",
    "sukkur": "Sukkur",
    "سکھر": "Sukkur",
    "larkana": "Larkana",
    "لاڑکانہ": "Larkana",
    "karachi": "Karachi",
    "کراچی": "Karachi",
    "dadu": "Dadu",
    "دادو": "Dadu",
    "sanghar": "Sanghar",
    "سانگھڑ": "Sanghar",
    "umerkot": "Umerkot",
    "عمرکوٹ": "Umerkot",
    "thar": "Tharparkar",
    "تھر": "Tharparkar",
    "mirpurkhas": "Mirpurkhas",
    "mirpur khas": "Mirpurkhas",
    "میرپور خاص": "Mirpurkhas",
    "jamshoro": "Jamshoro",
    "جامشورو": "Jamshoro",
    "matiari": "Matiari",
    "مٹیاری": "Matiari",
    "shikarpur": "Shikarpur",
    "شکارپور": "Shikarpur",
    "khairpur": "Khairpur",
    "خیرپور": "Khairpur",
    "ghotki": "Ghotki",
    "گھوٹکی": "Ghotki",
    "jacobabad": "Jacobabad",
    "جیکب آباد": "Jacobabad",
    "kashmore": "Kashmore",
    "naushahro": "Naushahro Feroze",
    "naushahro feroze": "Naushahro Feroze",
    "benazirabad": "Shaheed Benazirabad",
    "nawabshah": "Shaheed Benazirabad",
    "qambar": "Qambar Shahdadkot",
    "shahdadkot": "Qambar Shahdadkot",
    "sujawal": "Sujawal",
    "سجاول": "Sujawal",
    "tando allahyar": "Tando Allahyar",
    "tando muhammad khan": "Tando Muhammad Khan",
}


def _similarity(a: str, b: str) -> float:
    try:  # pragma: no cover - rapidfuzz is a hard dependency in practice
        from rapidfuzz.fuzz import ratio

        return ratio(a, b) / 100.0
    except Exception:  # pragma: no cover
        import difflib

        return difflib.SequenceMatcher(None, a, b).ratio()


def parse_district(text: str) -> str | None:
    """Resolve a spoken district to its canonical English spelling."""
    if not text:
        return None
    normalized = normalize_text(text).lower()
    if not normalized:
        return None

    for alias, canonical in _DISTRICT_ALIASES.items():
        if alias in normalized:
            return canonical

    best: tuple[float, str] | None = None
    for district in SINDH_DISTRICTS:
        score = _similarity(normalized, district.lower())
        if best is None or score > best[0]:
            best = (score, district)
    if best and best[0] >= 0.72:
        return best[1]
    return None


# --------------------------------------------------------------------------- #
# names
# --------------------------------------------------------------------------- #
_NAME_NOISE = {
    "mera",
    "meri",
    "naam",
    "name",
    "hai",
    "ہے",
    "میرا",
    "میری",
    "نام",
    "my",
    "is",
    "the",
    "ji",
    "ji,",
}


def parse_name(text: str) -> str | None:
    """Extract a person name from a spoken answer, preserving Urdu script."""
    if not text:
        return None
    if is_unknown(text):
        # "نہیں معلوم" is an answer, not a name. Recording it would put a phrase
        # into the fact bundle where a person's name belongs.
        return None
    normalized = normalize_text(text)
    normalized = re.sub(r"[^\w\u0600-\u06ff\s]", " ", normalized)
    words = [word for word in normalized.split() if word.lower() not in _NAME_NOISE]
    if not words:
        return None
    return " ".join(words).strip() or None


def title_case_name(name: str) -> str:
    if not name:
        return name
    if any("\u0600" <= ch <= "\u06ff" for ch in name):
        return name
    return " ".join(part.capitalize() for part in name.split())


# --------------------------------------------------------------------------- #
# readback
# --------------------------------------------------------------------------- #
def format_pkr(amount: int) -> str:
    return f"{amount:,}"


def urdu_number_words(value: int) -> str:
    """Best-effort Urdu rendering for readback prompts (0 – 9,999,999)."""
    if value < 0:
        return str(value)
    if value == 0:
        return "صفر"
    parts: list[str] = []
    for scale, label in ((100_000, "لاکھ"), (1_000, "ہزار"), (100, "سو")):
        if value >= scale:
            count, value = divmod(value, scale)
            parts.append(f"{_urdu_under_100(count)} {label}")
    if value:
        parts.append(_urdu_under_100(value))
    return " ".join(part for part in parts if part)


_URDU_LOOKUP = {v: k for k, v in URDU_UNITS.items() if v <= 100}


def _urdu_under_100(value: int) -> str:
    if value in _URDU_LOOKUP:
        return _URDU_LOOKUP[value]
    tens, units = divmod(value, 10)
    tens_word = _URDU_LOOKUP.get(tens * 10, "")
    unit_word = _URDU_LOOKUP.get(units, "")
    return f"{tens_word} {unit_word}".strip()


@dataclass(frozen=True)
class NumberParse:
    value: int | None
    unknown: bool
    confidence: float


def parse_amount(text: str, *, minimum: int = 0, maximum: int = 10_000_000) -> NumberParse:
    """Parse a PKR amount with an explicit unknown path and a confidence score."""
    if is_unknown(text):
        return NumberParse(value=None, unknown=True, confidence=0.95)
    value = parse_number(text)
    if value is None:
        return NumberParse(value=None, unknown=False, confidence=0.0)
    if not minimum <= value <= maximum:
        # Out of range is a failed parse, not a low-confidence answer: returning
        # 50,000 for a field capped at 30,000 would put an impossible income into
        # the fact bundle. The wizard asks again instead.
        return NumberParse(value=None, unknown=False, confidence=0.0)
    has_digits = bool(re.search(r"\d", normalize_text(text)))
    return NumberParse(value=value, unknown=False, confidence=0.97 if has_digits else 0.88)


def first_match(text: str, options: Iterable[str], *, threshold: float = 0.80) -> str | None:
    """Return the option that best matches ``text`` above ``threshold``."""
    normalized = normalize_text(text).lower()
    best: tuple[float, str] | None = None
    for option in options:
        score = _similarity(normalized, option.lower())
        if best is None or score > best[0]:
            best = (score, option)
    if best and best[0] >= threshold:
        return best[1]
    return None


def tokens(text: str) -> Sequence[str]:
    return _tokens(text)


__all__ = [
    "ENGLISH_MONTHS",
    "ROMAN_SCALES",
    "ROMAN_UNITS",
    "SINDH_DISTRICTS",
    "UNKNOWN_MARKERS",
    "URDU_MONTHS",
    "URDU_SCALES",
    "URDU_UNITS",
    "NumberParse",
    "first_match",
    "format_cnic",
    "format_pkr",
    "is_unknown",
    "normalize_digits",
    "normalize_text",
    "parse_amount",
    "parse_cnic",
    "parse_date",
    "parse_district",
    "parse_name",
    "parse_number",
    "title_case_name",
    "tokens",
    "urdu_number_words",
]
