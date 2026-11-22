"""Hybrid scam classifier and official-message verification (docs/07 §3).

Four stages, in order:

1. **Verification-code check.** A message containing an ``HQ-…`` code is looked
   up against ``notifications`` (by ``verification_code`` or the case reference).
   A code that resolves *and* whose body matches is ``VERIFIED_OFFICIAL``. A code
   that resolves but whose text was altered is ``RF_CODE_MISMATCH``; a code that
   does not exist is ``RF_FAKE_CODE``. Both are hard flags.
2. **Deterministic red flags** - the ``RF_*`` table from docs/07 §3.2.
3. **Calibrated ML** - ``TfidfVectorizer(char_wb, (1,2))`` +
   ``CalibratedClassifierCV(LogisticRegression(C=2.0), cv=5, sigmoid)``, trained
   deterministically on the committed dataset. The deterministic flags are fed in
   as extra feature tokens so a hard flag can never be diluted away.
4. **Combine and threshold** - ``p >= 0.75`` or ``>= 2`` hard flags →
   ``LIKELY_SCAM``; ``0.35 <= p < 0.75`` or text shorter than 15 characters →
   ``CANNOT_TELL``; otherwise ``LIKELY_SAFE``.

The verdict is **strictly advisory**. Nothing here blocks an account, deletes a
message, or touches ``cases.status``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.ai import guardrails, urdu_nlp

logger = logging.getLogger("haqdaar.ai.scam")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATASET_PATH = DATA_DIR / "scam_dataset.jsonl"
MODEL_VERSION = "scam-tfidf-lr-v1.0.0"
TRAIN_SEED = 20261120

VERIFIED_OFFICIAL = "VERIFIED_OFFICIAL"
LIKELY_SAFE = "LIKELY_SAFE"
CANNOT_TELL = "CANNOT_TELL"
LIKELY_SCAM = "LIKELY_SCAM"

#: docs/07 §3.1 thresholds - frozen.
SCAM_THRESHOLD = 0.75
UNSURE_THRESHOLD = 0.35
MIN_MEANINGFUL_CHARS = 15
#: A message with fewer words than this carries too little signal to clear.
MIN_MEANINGFUL_WORDS = 5
HARD_FLAG_COUNT_FOR_SCAM = 2

#: Highest benefit the demo programs can pay; anything above is a red flag.
PROGRAM_AMOUNT_CAP = 20_000

#: Body similarity above which a code-bearing message counts as unaltered.
BODY_SIMILARITY_THRESHOLD = 0.85

_CODE_PATTERN = re.compile(r"\bHQ-[A-Z0-9]{4,}(?:-[A-Z0-9]{2,})?\b", re.IGNORECASE)


# --------------------------------------------------------------------------- #
# red flags
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class RedFlag:
    code: str
    label_en: str
    label_ur: str
    severity: str  # HARD | MEDIUM | LOW

    def as_dict(self) -> dict[str, str]:
        return {
            "code": self.code,
            "label_en": self.label_en,
            "label_ur": self.label_ur,
            "severity": self.severity,
        }


FLAGS: dict[str, RedFlag] = {
    "RF_ASKS_FEE": RedFlag(
        "RF_ASKS_FEE",
        "Asks you to pay a fee to receive money",
        "رقم حاصل کرنے کے لیے فیس مانگ رہا ہے",
        "HARD",
    ),
    "RF_ASKS_PIN_OTP": RedFlag(
        "RF_ASKS_PIN_OTP",
        "Asks for your OTP, PIN or password",
        "آپ کا او ٹی پی، پن یا پاس ورڈ مانگ رہا ہے",
        "HARD",
    ),
    "RF_FAKE_CODE": RedFlag(
        "RF_FAKE_CODE",
        "Uses a verification code that Haqdaar never issued",
        "ایسا تصدیقی کوڈ استعمال کر رہا ہے جو حقدار نے جاری نہیں کیا",
        "HARD",
    ),
    "RF_CODE_MISMATCH": RedFlag(
        "RF_CODE_MISMATCH",
        "Uses a real code but the message text was changed",
        "اصل کوڈ استعمال کیا ہے لیکن پیغام کا متن بدلا گیا ہے",
        "HARD",
    ),
    "RF_SUSPICIOUS_LINK": RedFlag(
        "RF_SUSPICIOUS_LINK",
        "Contains a shortened or unofficial link",
        "مختصر یا غیر سرکاری لنک موجود ہے",
        "MEDIUM",
    ),
    "RF_AMOUNT_MISMATCH": RedFlag(
        "RF_AMOUNT_MISMATCH",
        "Promises an amount larger than any real program pays",
        "کسی حقیقی پروگرام سے زیادہ رقم کا وعدہ کر رہا ہے",
        "MEDIUM",
    ),
    "RF_URGENCY_THREAT": RedFlag(
        "RF_URGENCY_THREAT",
        "Pressures you with a deadline or a threat",
        "آخری تاریخ یا دھمکی دے کر دباؤ ڈال رہا ہے",
        "LOW",
    ),
    "RF_PERSONAL_NUMBER": RedFlag(
        "RF_PERSONAL_NUMBER",
        "Tells you to call a personal mobile number for government relief",
        "سرکاری امداد کے لیے ذاتی موبائل نمبر پر کال کرنے کو کہتا ہے",
        "MEDIUM",
    ),
    "RF_SCAM_KEYWORDS": RedFlag(
        "RF_SCAM_KEYWORDS",
        "Contains explicit scam, lottery, or fake prize phrasing",
        "اس میں فراڈ، لاٹری یا جعلی انعام کے واضح الفاظ موجود ہیں",
        "HARD",
    ),
}

_FEE_WORDS = re.compile(
    r"\b(?:fee|fees|charges|charge|tax|advance|registration|processing|file\s+charges|"
    r"verification\s+charges|group\s+fee|card\s+fee)\b|فیس|چارجز|ٹیکس|ایڈوانس",
    re.IGNORECASE,
)
_PAY_VERBS = re.compile(
    r"\b(?:bhej\w*|send|pay|paid|deposit|transfer|jama\s+kar\w*|jama\s+kara\w*|"
    r"jama\s+karen|submit)\b|بھیج|جمع|ادا",
    re.IGNORECASE,
)
_FEE_EXCLUSIONS = re.compile(
    r"\b(?:receipt|raseed|branch|counter|no\s+fee|no\s+charges|koi\s+fee\s+nahi|"
    r"koi\s+charge\s+nahi|free|muft|official\s+fee)\b|رسید|برانچ|مفت|کوئی\s+فیس\s+نہیں",
    re.IGNORECASE,
)

_CREDENTIAL_WORDS = re.compile(
    r"\b(?:otp|o\.t\.p|pin|mpin|m-pin|password|passcode|bank\s+code|atm\s+pin|cvv|"
    r"secret\s+code|verification\s+code|6\s*digit\s+code|4\s*digit\s+code)\b|او\s*ٹی\s*پی|پن\s*کوڈ|پاس\s*ورڈ",
    re.IGNORECASE,
)
_CREDENTIAL_REQUEST = re.compile(
    r"\b(?:bata\w*|batayen|share|send|bhej\w*|reply|darj\s+kar\w*|confirm|provide|"
    r"give|enter|likh\w*)\b|بتائیں|بھیجیں|درج\s+کریں|شیئر",
    re.IGNORECASE,
)
_CREDENTIAL_SAFETY = re.compile(
    r"\b(?:never|do\s+not|don'?t|kisi\s+ko\s+na|na\s+bata\w*|mat\s+bata\w*|"
    r"apne\s+tak|keep\s+it\s+(?:private|secret)|expires)\b|کسی\s+کو\s+نہ|نہ\s+بتائیں",
    re.IGNORECASE,
)

_SHORTENERS = re.compile(
    r"\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|cut\.ly|rb\.gy|is\.gd|shorturl\.at|"
    r"cutt\.ly|rebrand\.ly|tiny\.cc|ow\.ly|buff\.ly|s\.id|tr\.im)\b",
    re.IGNORECASE,
)
_ANY_URL = re.compile(r"https?://[^\s]+|\bwww\.[^\s]+", re.IGNORECASE)
_OFFICIAL_DOMAINS = ("haqdaar.gov.pk", "haqdaar.mock", "spd.gov.pk", "zwb.gov.pk", "gov.pk")

_AMOUNT = re.compile(r"(?:rs\.?|pkr|rupees?|rupay|روپے)\s*([\d,]{3,})|([\d,]{4,})\s*(?:rs|rupees?|rupay|روپے)", re.IGNORECASE)
_RELIEF_CONTEXT = re.compile(
    r"\b(?:relief|grant|inaam|prize|scheme|madad|ehsaas|bisp|benazir|sahara|guzara|"
    r"compensation|muawza|zakat|subsidy|allowance)\b|امداد|ریلیف|انعام|اسکیم|معاوضہ|گرانٹ",
    re.IGNORECASE,
)

_URGENCY = re.compile(
    r"\b(?:aaj\s+aakhri\s+din|aakhri\s+din|last\s+day|fori\s+rabta|foran|immediately|"
    r"urgent|account\s+block\s+ho\s+jayega|block\s+ho\s+jayega|cancel\s+ho\s+jayega|"
    r"band\s+ho\s+jayega|expire\s+ho\s+jayega|within\s+24\s+hours|2\s+hours)\b|"
    r"آخری\s+دن|فوری\s+رابطہ|بند\s+ہو\s+جائے\s+گا|منسوخ\s+ہو\s+جائے\s+گا",
    re.IGNORECASE,
)

_MOBILE = re.compile(r"(?<!\d)(?:\+?92[\s-]?|0)3\d{2}[\s-]?\d{7}(?!\d)")
_CONTACT_VERB = re.compile(
    r"\b(?:call|rabta|contact|whatsapp|phone|dial)\b|کال|رابطہ|واٹس\s*ایپ", re.IGNORECASE
)
_SCAM_KEYWORDS = re.compile(
    r"\b(?:scam\s+message|scam|scammer|phishing|fraudulent|fraud\s+message|lottery|"
    r"lucky\s+draw|jackpot|prize\s+won|won\s+(?:a\s+)?(?:prize|lottery|cash|money|reward)|"
    r"free\s+(?:cash|money|grant|prize)|claim\s+(?:your\s+)?(?:prize|reward|lottery))\b|"
    r"فراڈ|دھوکہ|لاٹری|انعام\s+نکلا|قرعہ\s*اندازی",
    re.IGNORECASE,
)
_SCAM_SAFETY = re.compile(
    r"\b(?:beware\s+of|avoid|report|never|don'?t|do\s+not|not\s+a\s+scam|"
    r"protect\s+yourself|warning\s+about|stay\s+safe\s+from)\b|بچیں|رپورٹ|خبردار|اطلاع\s+دیں",
    re.IGNORECASE,
)
_LINK_ACTION = re.compile(
    r"\b(?:click|open|tap|visit|verify|claim|login|sign\s+in|update)\b|کلک|کھولیں|تصدیق",
    re.IGNORECASE,
)


def _amounts(text: str) -> list[int]:
    values: list[int] = []
    for match in _AMOUNT.finditer(text):
        raw = (match.group(1) or match.group(2) or "").replace(",", "")
        if raw.isdigit():
            values.append(int(raw))
    return values


def detect_red_flags(text: str) -> list[RedFlag]:
    """Stage 2: the deterministic ``RF_*`` table (docs/07 §3.2)."""
    if not text:
        return []

    flags: list[RedFlag] = []
    normalized = urdu_nlp.normalize_text(text)

    if _FEE_WORDS.search(normalized) and _PAY_VERBS.search(normalized) and not _FEE_EXCLUSIONS.search(normalized):
        flags.append(FLAGS["RF_ASKS_FEE"])

    if _CREDENTIAL_WORDS.search(normalized) and _CREDENTIAL_REQUEST.search(normalized) and not _CREDENTIAL_SAFETY.search(normalized):
        flags.append(FLAGS["RF_ASKS_PIN_OTP"])

    if _SHORTENERS.search(normalized):
        flags.append(FLAGS["RF_SUSPICIOUS_LINK"])
    else:
        for url in _ANY_URL.findall(normalized):
            if not any(domain in url.lower() for domain in _OFFICIAL_DOMAINS):
                flags.append(FLAGS["RF_SUSPICIOUS_LINK"])
                break

    if _RELIEF_CONTEXT.search(normalized) and any(value > PROGRAM_AMOUNT_CAP for value in _amounts(normalized)):
        flags.append(FLAGS["RF_AMOUNT_MISMATCH"])

    if _URGENCY.search(normalized):
        flags.append(FLAGS["RF_URGENCY_THREAT"])

    if _MOBILE.search(normalized) and _CONTACT_VERB.search(normalized) and _RELIEF_CONTEXT.search(normalized):
        flags.append(FLAGS["RF_PERSONAL_NUMBER"])

    if _SCAM_KEYWORDS.search(normalized) and not _SCAM_SAFETY.search(normalized):
        flags.append(FLAGS["RF_SCAM_KEYWORDS"])

    return flags


# --------------------------------------------------------------------------- #
# stage 1 - verification codes
# --------------------------------------------------------------------------- #
@dataclass
class NotificationRecord:
    id: Any
    verification_code: str
    body_sha256: str
    body_en: str = ""
    body_ur: str = ""
    reference_code: str | None = None


def extract_code(text: str) -> str | None:
    match = _CODE_PATTERN.search(text or "")
    return match.group(0).upper() if match else None


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    try:
        from rapidfuzz.fuzz import ratio

        return ratio(a, b) / 100.0
    except Exception:  # pragma: no cover
        import difflib

        return difflib.SequenceMatcher(None, a, b).ratio()


def _numeric_tokens(text: str) -> list[str]:
    return re.findall(r"\d[\d,]*", text or "")


def _body_matches(text: str, record: NotificationRecord) -> bool:
    canonical = (text or "").strip()
    if record.body_sha256 and hashlib.sha256(canonical.encode("utf-8")).hexdigest() == record.body_sha256:
        return True
    text_nums = _numeric_tokens(canonical)
    for body in (record.body_en, record.body_ur):
        cleaned_body = (body or "").strip()
        if not cleaned_body:
            continue
        if canonical == cleaned_body:
            return True
        if _similarity(canonical, cleaned_body) >= BODY_SIMILARITY_THRESHOLD:
            # Never let an edited phone number or grant amount slip through fuzzy similarity.
            body_nums = _numeric_tokens(cleaned_body)
            if not body_nums or text_nums == body_nums:
                return True
    return False


def load_notifications(db: Any) -> list[NotificationRecord]:
    """Read the notification index from the application DB (never ``mock_*``)."""
    try:
        from app.db import Base  # type: ignore

        notifications = Base.metadata.tables.get("notifications")
        cases = Base.metadata.tables.get("cases")
    except Exception:  # pragma: no cover
        return []
    if notifications is None:
        return []

    columns = [notifications.c.id, notifications.c.verification_code, notifications.c.body_sha256]
    for name in ("body_en", "body_ur", "case_id"):
        if name in notifications.c:
            columns.append(notifications.c[name])

    rows = db.execute(notifications.select().with_only_columns(*columns)).mappings().all()

    reference_by_case: dict[Any, str] = {}
    if cases is not None and "case_id" in notifications.c:
        try:
            case_rows = db.execute(
                cases.select().with_only_columns(cases.c.id, cases.c.reference_code)
            ).mappings().all()
            reference_by_case = {row["id"]: row["reference_code"] for row in case_rows}
        except Exception:  # pragma: no cover
            reference_by_case = {}

    records: list[NotificationRecord] = []
    for row in rows:
        records.append(
            NotificationRecord(
                id=row["id"],
                verification_code=(row.get("verification_code") or "").upper(),
                body_sha256=row.get("body_sha256") or "",
                body_en=row.get("body_en") or "",
                body_ur=row.get("body_ur") or "",
                reference_code=reference_by_case.get(row.get("case_id")),
            )
        )
    return records


def _find_record(code: str, records: Sequence[NotificationRecord]) -> NotificationRecord | None:
    for record in records:
        if record.verification_code == code:
            return record
    for record in records:
        if record.reference_code and record.reference_code.upper() == code:
            return record
    return None


# --------------------------------------------------------------------------- #
# stage 3 - calibrated ML
# --------------------------------------------------------------------------- #
@dataclass
class TrainedModel:
    vectorizer: Any
    classifier: Any
    metrics: dict[str, Any]
    train_size: int
    test_size: int


_MODEL: TrainedModel | None = None
_MODEL_LOCK = threading.Lock()


def load_dataset(path: Path | None = None) -> list[dict[str, Any]]:
    target = path or DATASET_PATH
    if not target.exists():
        return []
    rows: list[dict[str, Any]] = []
    with target.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def _feature_text(text: str, flags: Sequence[RedFlag]) -> str:
    """Append deterministic flag tokens so a hard flag is never diluted."""
    tokens = " ".join(f"__{flag.code.lower()}" for flag in flags)
    return f"{text} {tokens}".strip()


def _train(rows: Sequence[dict[str, Any]]) -> TrainedModel:
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import confusion_matrix, precision_recall_fscore_support
    from sklearn.pipeline import FeatureUnion, Pipeline

    labelled = [row for row in rows if row["label"] in {"SCAM", "LEGIT"}]
    train = [row for row in labelled if row["split"] == "train"]
    test = [row for row in labelled if row["split"] == "test"]

    def featurize(subset: Sequence[dict[str, Any]]) -> tuple[list[str], list[int]]:
        texts = [_feature_text(row["text"], detect_red_flags(row["text"])) for row in subset]
        labels = [1 if row["label"] == "SCAM" else 0 for row in subset]
        return texts, labels

    train_texts, train_labels = featurize(train)
    test_texts, test_labels = featurize(test)

    pipeline = Pipeline(
        [
            (
                "tfidf",
                FeatureUnion(
                    [
                        (
                            "word",
                            TfidfVectorizer(
                                analyzer="word",
                                ngram_range=(1, 2),
                                min_df=2,
                                sublinear_tf=True,
                            ),
                        ),
                        (
                            "char",
                            TfidfVectorizer(
                                analyzer="char_wb",
                                ngram_range=(3, 5),
                                min_df=2,
                                sublinear_tf=True,
                            ),
                        ),
                    ]
                ),
            ),
            (
                "clf",
                CalibratedClassifierCV(
                    LogisticRegression(C=2.0, max_iter=2000, random_state=TRAIN_SEED),
                    cv=5,
                    method="sigmoid",
                ),
            ),
        ]
    )
    pipeline.fit(train_texts, train_labels)

    predictions = pipeline.predict(test_texts)
    precision, recall, f1, _ = precision_recall_fscore_support(
        test_labels, predictions, average="binary", zero_division=0
    )
    matrix = confusion_matrix(test_labels, predictions, labels=[0, 1]).tolist()

    hard_negative_indices = [
        index
        for index, row in enumerate(test)
        if row["bucket"] == "HARD_NEGATIVE"
    ]
    hard_negative_fpr = 0.0
    if hard_negative_indices:
        flagged = sum(1 for index in hard_negative_indices if predictions[index] == 1)
        hard_negative_fpr = round(flagged / len(hard_negative_indices), 4)

    metrics = {
        "test_size": len(test),
        "train_size": len(train),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1": round(float(f1), 4),
        "false_positive_rate": round(
            (matrix[0][1] / (matrix[0][0] + matrix[0][1])) if (matrix[0][0] + matrix[0][1]) else 0.0,
            4,
        ),
        "hard_negative_fpr": hard_negative_fpr,
        "confusion_matrix": matrix,
        "model_version": MODEL_VERSION,
    }
    return TrainedModel(
        vectorizer=pipeline,
        classifier=pipeline,
        metrics=metrics,
        train_size=len(train),
        test_size=len(test),
    )


def get_model() -> TrainedModel:
    """Train once per process (~0.4 s) and cache."""
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is not None:
            return _MODEL
        rows = load_dataset()
        if not rows:
            raise RuntimeError(f"scam dataset missing at {DATASET_PATH}")
        _MODEL = _train(rows)
        logger.info("scam model trained: %s", _MODEL.metrics)
        return _MODEL


def reset_model() -> None:
    global _MODEL
    _MODEL = None


def _probability(text: str, flags: Sequence[RedFlag]) -> float:
    model = get_model()
    features = _feature_text(text, flags)
    probabilities = model.classifier.predict_proba([features])[0]
    return float(probabilities[1])


# --------------------------------------------------------------------------- #
# verdict
# --------------------------------------------------------------------------- #
@dataclass
class ScamVerdict:
    verdict: str
    confidence: float
    red_flags: list[RedFlag] = field(default_factory=list)
    matched_notification_id: Any = None
    explanation_en: str = ""
    explanation_ur: str = ""
    stage: str = "ML"
    probability: float = 0.0
    code: str | None = None
    model_version: str = MODEL_VERSION

    @property
    def is_scam(self) -> bool:
        return self.verdict == LIKELY_SCAM

    def as_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict,
            "confidence": round(self.confidence, 3),
            "red_flags": [flag.as_dict() for flag in self.red_flags],
            "matched_notification_id": str(self.matched_notification_id)
            if self.matched_notification_id
            else None,
            "explanation_en": self.explanation_en,
            "explanation_ur": self.explanation_ur,
            "stage": self.stage,
            "probability": round(self.probability, 4),
            "code": self.code,
            "model_version": self.model_version,
        }


_EXPLANATIONS: dict[str, tuple[str, str]] = {
    VERIFIED_OFFICIAL: (
        "This message matches an official Haqdaar notification exactly. It is safe.",
        "یہ پیغام حقدار کی سرکاری اطلاع سے بالکل مطابقت رکھتا ہے۔ یہ محفوظ ہے۔",
    ),
    LIKELY_SCAM: (
        "This message looks like a scam. Do not send money, do not share your OTP or PIN, "
        "and do not open any link. Haqdaar never asks for a fee.",
        "یہ پیغام فراڈ لگتا ہے۔ پیسے نہ بھیجیں، اپنا او ٹی پی یا پن شیئر نہ کریں، اور کوئی لنک نہ کھولیں۔ "
        "حقدار کبھی فیس نہیں مانگتا۔",
    ),
    CANNOT_TELL: (
        "We are not sure about this message. Please check it with a helper or call the "
        "official helpline before doing anything.",
        "ہم اس پیغام کے بارے میں یقین سے نہیں کہہ سکتے۔ براہ کرم کچھ کرنے سے پہلے مددگار سے یا سرکاری ہیلپ لائن سے تصدیق کریں۔",
    ),
    LIKELY_SAFE: (
        "We did not find the usual signs of a scam in this message. Stay careful anyway.",
        "اس پیغام میں فراڈ کی عام نشانیاں نہیں ملیں۔ پھر بھی احتیاط رکھیں۔",
    ),
}


def _explain(verdict: str) -> tuple[str, str]:
    return _EXPLANATIONS.get(verdict, _EXPLANATIONS[CANNOT_TELL])


def classify(
    text: str,
    *,
    db: Any = None,
    notifications: Sequence[NotificationRecord] | None = None,
) -> ScamVerdict:
    """Run the four-stage pipeline on one message."""
    raw = (text or "").strip()
    if not raw:
        explanation_en, explanation_ur = _explain(CANNOT_TELL)
        return ScamVerdict(
            verdict=CANNOT_TELL,
            confidence=0.0,
            explanation_en=explanation_en,
            explanation_ur=explanation_ur,
            stage="EMPTY",
        )

    # Guardrails: strip injection attempts before anything else looks at the text.
    scan = guardrails.scan_injection(raw)
    cleaned = scan.cleaned if scan.triggered else raw
    if scan.triggered:
        guardrails.record_guardrail_event(
            db,
            kind="scam_message_injection",
            code=scan.primary_code,
            resource_type="scam_check",
            excerpt=scan.matches[0] if scan.matches else None,
        )

    records = list(notifications) if notifications is not None else (load_notifications(db) if db is not None else [])

    # ---- stage 1: verification code ------------------------------------- #
    code = extract_code(cleaned)
    if code:
        record = _find_record(code, records)
        if record is None:
            explanation_en, explanation_ur = _explain(LIKELY_SCAM)
            return ScamVerdict(
                verdict=LIKELY_SCAM,
                confidence=0.96,
                red_flags=[FLAGS["RF_FAKE_CODE"]],
                explanation_en=explanation_en,
                explanation_ur=explanation_ur,
                stage="CODE_CHECK",
                probability=0.96,
                code=code,
            )
        if _body_matches(cleaned, record):
            explanation_en, explanation_ur = _explain(VERIFIED_OFFICIAL)
            return ScamVerdict(
                verdict=VERIFIED_OFFICIAL,
                confidence=0.99,
                red_flags=[],
                matched_notification_id=record.id,
                explanation_en=explanation_en,
                explanation_ur=explanation_ur,
                stage="CODE_CHECK",
                probability=0.01,
                code=code,
            )
        explanation_en, explanation_ur = _explain(LIKELY_SCAM)
        return ScamVerdict(
            verdict=LIKELY_SCAM,
            confidence=0.96,
            red_flags=[FLAGS["RF_CODE_MISMATCH"]],
            matched_notification_id=record.id,
            explanation_en=explanation_en,
            explanation_ur=explanation_ur,
            stage="CODE_CHECK",
            probability=0.96,
            code=code,
        )

    # ---- stage 2: deterministic flags ----------------------------------- #
    flags = detect_red_flags(cleaned)
    hard_flags = [flag for flag in flags if flag.severity == "HARD"]

    # ---- stage 3: calibrated ML ----------------------------------------- #
    model_available = True
    try:
        probability = _probability(cleaned, flags)
    except Exception as exc:  # pragma: no cover - model must never break the API
        logger.warning("scam model unavailable (%s) - falling back to flags only", exc)
        probability = 0.0
        model_available = False

    # ---- stage 4: combine and threshold --------------------------------- #
    has_suspicious_link = any(flag.code == "RF_SUSPICIOUS_LINK" for flag in flags)
    strong_link_scam = has_suspicious_link and (
        len(flags) >= 2 or bool(_LINK_ACTION.search(urdu_nlp.normalize_text(cleaned)))
    )
    too_short = (
        len(cleaned) < MIN_MEANINGFUL_CHARS
        or len(cleaned.split()) < MIN_MEANINGFUL_WORDS
    )

    if not model_available:
        # Without the model we cannot judge a clean message, so we never call it
        # safe. One hard flag is enough to warn, and anything else is "cannot
        # tell" - the citizen is told to check, not told she is fine.
        if hard_flags or strong_link_scam:
            verdict = LIKELY_SCAM
            confidence = 0.85
            probability = max(probability, 0.85)
        else:
            verdict = CANNOT_TELL
            confidence = 0.5
    elif (
        probability >= SCAM_THRESHOLD
        or len(hard_flags) >= 1
        or strong_link_scam
    ):
        verdict = LIKELY_SCAM
        floor = 0.90 if len(hard_flags) >= HARD_FLAG_COUNT_FOR_SCAM else 0.85
        probability = max(probability, floor)
        confidence = probability
    elif UNSURE_THRESHOLD <= probability < SCAM_THRESHOLD or too_short:
        verdict = CANNOT_TELL
        confidence = max(probability, 0.5)
    else:
        verdict = LIKELY_SAFE
        confidence = 1.0 - probability

    explanation_en, explanation_ur = _explain(verdict)
    if verdict == LIKELY_SCAM and flags:
        reasons_en = "; ".join(flag.label_en for flag in flags[:2])
        reasons_ur = "، ".join(flag.label_ur for flag in flags[:2])
        explanation_en = f"Likely scam: {reasons_en}. Do not send money, share codes, or open links."
        explanation_ur = f"یہ فراڈ لگتا ہے: {reasons_ur}۔ پیسے نہ بھیجیں، کوڈ شیئر نہ کریں، اور لنک نہ کھولیں۔"
    elif verdict == CANNOT_TELL and too_short and not flags:
        explanation_en = (
            "This message is too short to verify on its own. Paste the full SMS or WhatsApp "
            "message, or check with a helper before acting."
        )
        explanation_ur = (
            "یہ پیغام تصدیق کے لیے بہت مختصر ہے۔ پورا ایس ایم ایس یا واٹس ایپ پیغام درج کریں، "
            "یا کچھ کرنے سے پہلے مددگار سے پوچھ لیں۔"
        )
    return ScamVerdict(
        verdict=verdict,
        confidence=round(min(confidence, 0.99), 3),
        red_flags=flags,
        explanation_en=explanation_en,
        explanation_ur=explanation_ur,
        stage="RULES_ML",
        probability=round(min(probability, 0.99), 4),
    )


def metrics() -> dict[str, Any]:
    """Held-out metrics for the eval dashboard (docs/07 §8)."""
    return dict(get_model().metrics)


__all__ = [
    "CANNOT_TELL",
    "DATASET_PATH",
    "FLAGS",
    "LIKELY_SAFE",
    "LIKELY_SCAM",
    "MIN_MEANINGFUL_CHARS",
    "MIN_MEANINGFUL_WORDS",
    "MODEL_VERSION",
    "PROGRAM_AMOUNT_CAP",
    "SCAM_THRESHOLD",
    "UNSURE_THRESHOLD",
    "VERIFIED_OFFICIAL",
    "NotificationRecord",
    "RedFlag",
    "ScamVerdict",
    "classify",
    "detect_red_flags",
    "extract_code",
    "get_model",
    "load_dataset",
    "load_notifications",
    "metrics",
    "reset_model",
]
