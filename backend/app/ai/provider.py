"""The single gateway to every external AI capability (docs/07 §1).

Nothing in ``app/ai`` talks to OpenAI, Whisper or edge-tts directly — it all goes
through an :class:`AIProvider`. Two implementations ship:

* :class:`LiveOpenAIProvider` — ``gpt-4o-mini`` (strict JSON Schema),
  ``whisper-1``, ``text-embedding-3-small`` and ``edge-tts`` Urdu neural voices.
* :class:`FakeDeterministicProvider` — zero network, < 20 ms, deterministic,
  keyed by fixture hashes and keywords. Used by every test and by the circuit
  breaker when the live provider misbehaves.

Every call writes an ``ai_telemetry`` row and an ``ai.call`` audit event through
:func:`telemetry`, so the eval dashboard can report real latency, token and cost
numbers (docs/07 §8).
"""

from __future__ import annotations

import base64
import contextlib
import contextvars
import hashlib
import json
import logging
import math
import os
import re
import struct
import time
import uuid
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

import httpx

from app.ai import guardrails, paths, urdu_nlp
from app.config import get_settings

logger = logging.getLogger("haqdaar.ai.provider")

PROMPT_VERSION = "v1.0.0"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

#: USD per 1M tokens (or per minute for Whisper) — used for honest cost reporting.
COST_TABLE: dict[str, tuple[float, float]] = {
    "gpt-4o-mini": (0.15, 0.60),
    "whisper-1": (0.006, 0.0),  # per minute, not per token
    "text-embedding-3-small": (0.02, 0.0),
    "edge-tts": (0.0, 0.0),
    "fake": (0.0, 0.0),
}

EMBEDDING_DIM = 64


# --------------------------------------------------------------------------- #
# result types
# --------------------------------------------------------------------------- #
@dataclass
class STTResult:
    transcript: str
    language: str = "ur"
    confidence: float = 0.0
    duration_s: float = 0.0
    provider: str = "fake"
    model: str = "fake-stt"
    available: bool = True


@dataclass
class ParsedFieldResult:
    field_key: str
    value: Any = None
    confidence: float = 0.0
    missing_reason: str | None = None
    normalized: str | None = None
    provider: str = "fake"
    model: str = "fake-parse"
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def is_unknown(self) -> bool:
        return self.missing_reason == "USER_UNKNOWN"


@dataclass
class OCRResult:
    fields: dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.0
    raw_text: str | None = None
    provider: str = "fake"
    model: str = "fake-ocr"
    available: bool = True


@dataclass
class RAGSynthesisResult:
    answer: str
    citations: list[str] = field(default_factory=list)
    confidence: float = 0.0
    provider: str = "fake"
    model: str = "fake-rag"
    available: bool = True


@dataclass
class TTSResult:
    audio: bytes
    mime_type: str = "audio/mpeg"
    voice: str = "ur-PK-UzmaNeural"
    cached: bool = False
    provider: str = "fake"


class ProviderError(RuntimeError):
    """Raised by a provider when a call fails; the breaker decides what next."""

    def __init__(self, message: str, *, code: str = "PROVIDER_ERROR", retryable: bool = True) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


# --------------------------------------------------------------------------- #
# telemetry
# --------------------------------------------------------------------------- #
@dataclass
class TelemetryContext:
    db: Any = None
    tenant_id: Any = None
    case_id: Any = None
    resource_type: str = "ai_call"
    resource_id: str | None = None


_TELEMETRY: contextvars.ContextVar[TelemetryContext | None] = contextvars.ContextVar(
    "haqdaar_ai_telemetry", default=None
)


@contextlib.contextmanager
def telemetry(
    db: Any = None,
    *,
    tenant_id: Any = None,
    case_id: Any = None,
    resource_type: str = "ai_call",
    resource_id: str | None = None,
) -> Iterator[TelemetryContext]:
    """Bind a DB session so every provider call inside the block is recorded."""
    context = TelemetryContext(
        db=db,
        tenant_id=tenant_id,
        case_id=case_id,
        resource_type=resource_type,
        resource_id=resource_id,
    )
    token = _TELEMETRY.set(context)
    try:
        yield context
    finally:
        _TELEMETRY.reset(token)


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    input_rate, output_rate = COST_TABLE.get(model, (0.0, 0.0))
    return round((input_tokens * input_rate + output_tokens * output_rate) / 1_000_000, 6)


def _telemetry_table(db: Any) -> Any:
    try:
        from app.db import Base  # type: ignore

        return Base.metadata.tables.get("ai_telemetry")
    except Exception:  # pragma: no cover
        return None


def _isolated_write(db: Any, statement: Any, params: Any) -> None:
    """Run a best-effort write inside a savepoint.

    A failed telemetry insert would otherwise abort the caller's transaction and
    every later query in the same request would die with ``InFailedSqlTransaction``.
    Telemetry must never break the request it is measuring.
    """
    begin_nested = getattr(db, "begin_nested", None)
    if begin_nested is None:
        db.execute(statement, params)
        return
    with begin_nested():
        db.execute(statement, params)


def _emit(
    *,
    task_type: str,
    provider: str,
    model_name: str,
    latency_ms: int,
    input_tokens: int = 0,
    output_tokens: int = 0,
    succeeded: bool = True,
    error_code: str | None = None,
) -> None:
    """Record one AI call. Never raises — telemetry must not break a request."""
    context = _TELEMETRY.get()
    if context is None or context.db is None:
        return

    row = {
        "id": uuid.uuid4(),
        "tenant_id": context.tenant_id,
        "task_type": task_type,
        "provider": provider,
        "model_name": model_name,
        "prompt_version": PROMPT_VERSION,
        "latency_ms": int(latency_ms),
        "input_tokens": int(input_tokens),
        "output_tokens": int(output_tokens),
        "estimated_cost_usd": _estimate_cost(model_name, input_tokens, output_tokens),
        "succeeded": succeeded,
        "error_code": error_code,
        "case_id": context.case_id,
        "created_at": datetime.now(UTC),
    }

    try:
        table = _telemetry_table(context.db)
        if table is not None:
            allowed = {column.name for column in table.columns}
            payload = {k: v for k, v in row.items() if k in allowed}
            _isolated_write(context.db, table.insert(), [payload])
    except Exception as exc:  # pragma: no cover
        logger.warning("ai_telemetry write failed: %s", exc)

    try:  # pragma: no cover - depends on A1 landing
        from app.security import audit as audit_module  # type: ignore

        audit_module.record(
            context.db,
            tenant_id=context.tenant_id,
            actor_type="AI",
            actor_id=provider,
            actor_role="AI",
            action="ai.call",
            resource_type=context.resource_type,
            resource_id=context.resource_id,
            payload={
                "task_type": task_type,
                "model": model_name,
                "latency_ms": int(latency_ms),
                "succeeded": succeeded,
                "error_code": error_code,
                "prompt_version": PROMPT_VERSION,
            },
        )
    except Exception as exc:  # pragma: no cover
        logger.debug("ai.call audit skipped: %s", exc)


# --------------------------------------------------------------------------- #
# protocol
# --------------------------------------------------------------------------- #
@runtime_checkable
class AIProvider(Protocol):
    name: str

    def transcribe_urdu(self, audio_bytes: bytes, mime_type: str) -> STTResult: ...

    def parse_structured_field(
        self, transcript: str, field_key: str, schema: dict[str, Any]
    ) -> ParsedFieldResult: ...

    def ocr_document(self, image_bytes: bytes, doc_type: str) -> OCRResult: ...

    def embed_texts(self, texts: list[str]) -> list[list[float]]: ...

    def rag_synthesize(
        self, question: str, chunks: Sequence[Any], lang: str
    ) -> RAGSynthesisResult: ...

    def synthesize_urdu_tts(self, text: str) -> bytes: ...


# --------------------------------------------------------------------------- #
# fake provider
# --------------------------------------------------------------------------- #
_TRANSCRIPT_MARKER = re.compile(rb"TRANSCRIPT:(.+)", re.DOTALL)
_OCR_MARKER = re.compile(rb"MOCKOCR:(\{.*\})", re.DOTALL)


def _fixture_index() -> dict[str, dict[str, Any]]:
    """sha256 → manifest entry, built from the generated specimen manifests."""
    index: dict[str, dict[str, Any]] = {}
    for manifest_path in (
        DATA_DIR / "demo_docs" / "manifest.json",
        DATA_DIR / "doc_eval_set" / "manifest.json",
    ):
        if not manifest_path.exists():
            continue
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:  # pragma: no cover
            continue
        for entry in payload.get("files", []) + payload.get("images", []):
            digest = entry.get("sha256")
            if digest:
                index[digest] = entry
    return index


_FIXTURES: dict[str, dict[str, Any]] | None = None


def fixture_index() -> dict[str, dict[str, Any]]:
    global _FIXTURES
    if _FIXTURES is None:
        _FIXTURES = _fixture_index()
    return _FIXTURES


def reset_fixtures() -> None:
    global _FIXTURES
    _FIXTURES = None


class FakeDeterministicProvider:
    """Deterministic, offline, < 20 ms. The default in every test and CI run."""

    name = "fake"

    def __init__(self) -> None:
        self._transcripts: dict[str, str] = {}

    # -- fixtures ---------------------------------------------------------- #
    def register_transcript(self, audio_bytes: bytes, transcript: str) -> None:
        self._transcripts[hashlib.sha256(audio_bytes).hexdigest()] = transcript

    # -- STT --------------------------------------------------------------- #
    def transcribe_urdu(self, audio_bytes: bytes, mime_type: str = "audio/wav") -> STTResult:
        started = time.perf_counter()
        digest = hashlib.sha256(audio_bytes or b"").hexdigest()
        transcript = self._transcripts.get(digest)

        if transcript is None:
            marker = _TRANSCRIPT_MARKER.search(audio_bytes or b"")
            if marker:
                transcript = marker.group(1).decode("utf-8", "replace").strip()

        if transcript is None:
            transcript = ""

        confidence = 0.94 if transcript else 0.0
        result = STTResult(
            transcript=transcript,
            language="ur",
            confidence=confidence,
            duration_s=round(len(audio_bytes or b"") / 32_000, 3),
            provider="fake",
            model="fake-stt",
            available=bool(transcript),
        )
        _emit(
            task_type="VOICE_STT",
            provider="fake",
            model_name="fake-stt",
            latency_ms=int((time.perf_counter() - started) * 1000),
            input_tokens=len(transcript.split()),
            succeeded=bool(transcript),
            error_code=None if transcript else "EMPTY_TRANSCRIPT",
        )
        return result

    # -- structured parse -------------------------------------------------- #
    def parse_structured_field(
        self, transcript: str, field_key: str, schema: dict[str, Any] | None = None
    ) -> ParsedFieldResult:
        started = time.perf_counter()
        text = urdu_nlp.normalize_text(transcript or "")
        result = _parse_field(field_key, text)
        result.provider = "fake"
        result.model = "fake-parse"
        _emit(
            task_type="VOICE_PARSE",
            provider="fake",
            model_name="fake-parse",
            latency_ms=int((time.perf_counter() - started) * 1000),
            input_tokens=len(text.split()),
            succeeded=result.value is not None or result.is_unknown,
            error_code=None if result.value is not None or result.is_unknown else "PARSE_FAILED",
        )
        return result

    # -- OCR --------------------------------------------------------------- #
    def ocr_document(self, image_bytes: bytes, doc_type: str = "CNIC_FRONT") -> OCRResult:
        started = time.perf_counter()
        digest = hashlib.sha256(image_bytes or b"").hexdigest()
        entry = fixture_index().get(digest)

        if entry is not None:
            fields = dict(entry.get("printed_fields") or {})
            result = OCRResult(
                fields=fields,
                confidence=0.96 if fields else 0.0,
                raw_text=entry.get("raw_text"),
                provider="fake",
                model="fake-ocr",
                available=bool(fields),
            )
        else:
            marker = _OCR_MARKER.search(image_bytes or b"")
            if marker:
                try:
                    fields = json.loads(marker.group(1).decode("utf-8", "replace"))
                except Exception:
                    fields = {}
                result = OCRResult(
                    fields=fields,
                    confidence=0.90 if fields else 0.0,
                    provider="fake",
                    model="fake-ocr",
                    available=bool(fields),
                )
            else:
                result = OCRResult(
                    fields={},
                    confidence=0.0,
                    provider="fake",
                    model="fake-ocr",
                    available=False,
                )

        _emit(
            task_type="DOC_OCR",
            provider="fake",
            model_name="fake-ocr",
            latency_ms=int((time.perf_counter() - started) * 1000),
            input_tokens=len(result.fields),
            succeeded=result.available,
            error_code=None if result.available else "OCR_UNAVAILABLE",
        )
        return result

    # -- embeddings -------------------------------------------------------- #
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        started = time.perf_counter()
        vectors = [_hash_embedding(text) for text in texts]
        _emit(
            task_type="RAG_ASK",
            provider="fake",
            model_name="fake-embed",
            latency_ms=int((time.perf_counter() - started) * 1000),
            input_tokens=sum(len((text or "").split()) for text in texts),
        )
        return vectors

    # -- RAG --------------------------------------------------------------- #
    def rag_synthesize(
        self, question: str, chunks: Sequence[Any], lang: str = "ur"
    ) -> RAGSynthesisResult:
        started = time.perf_counter()
        answer, citations = _extractive_answer(question, chunks, lang)
        result = RAGSynthesisResult(
            answer=answer,
            citations=citations,
            confidence=0.62 if citations else 0.0,
            provider="fake",
            model="fake-rag",
            available=bool(citations),
        )
        _emit(
            task_type="RAG_ASK",
            provider="fake",
            model_name="fake-rag",
            latency_ms=int((time.perf_counter() - started) * 1000),
            input_tokens=len((question or "").split()),
            output_tokens=len(answer.split()),
            succeeded=bool(citations),
            error_code=None if citations else "NO_CONTEXT",
        )
        return result

    # -- TTS --------------------------------------------------------------- #
    def synthesize_urdu_tts(self, text: str) -> bytes:
        started = time.perf_counter()
        audio = _silent_wav(text)
        _emit(
            task_type="VOICE_TTS",
            provider="fake",
            model_name="fake-tts",
            latency_ms=int((time.perf_counter() - started) * 1000),
            input_tokens=len((text or "").split()),
        )
        return audio


# --------------------------------------------------------------------------- #
# field-scoped parsing (shared by fake + used as a post-check in live mode)
# --------------------------------------------------------------------------- #
def _parse_field(field_key: str, text: str) -> ParsedFieldResult:
    key = field_key.strip()

    if key in {"monthly_income_pkr", "income", "self_declared_income"}:
        parsed = urdu_nlp.parse_amount(text, minimum=0, maximum=1_000_000)
        if parsed.unknown:
            return ParsedFieldResult(key, None, 0.95, "USER_UNKNOWN")
        if parsed.value is None:
            return ParsedFieldResult(key, None, 0.0, "PARSE_FAILED")
        return ParsedFieldResult(key, parsed.value, parsed.confidence, None, str(parsed.value))

    if key in {"children_under_18", "household_size", "children", "family_members"}:
        parsed = urdu_nlp.parse_amount(text, minimum=0, maximum=30)
        if parsed.unknown:
            return ParsedFieldResult(key, None, 0.95, "USER_UNKNOWN")
        if parsed.value is None:
            return ParsedFieldResult(key, None, 0.0, "PARSE_FAILED")
        return ParsedFieldResult(key, parsed.value, parsed.confidence, None, str(parsed.value))

    if key in {"applicant_cnic", "spouse_cnic", "cnic"}:
        if urdu_nlp.is_unknown(text):
            return ParsedFieldResult(key, None, 0.95, "USER_UNKNOWN")
        digits = urdu_nlp.parse_cnic(text)
        if digits is None:
            return ParsedFieldResult(key, None, 0.0, "PARSE_FAILED")
        return ParsedFieldResult(
            key, digits, 0.97, None, urdu_nlp.format_cnic(digits)
        )

    if key in {"applicant_district", "district"}:
        if urdu_nlp.is_unknown(text):
            return ParsedFieldResult(key, None, 0.95, "USER_UNKNOWN")
        district = urdu_nlp.parse_district(text)
        if district is None:
            return ParsedFieldResult(key, None, 0.0, "PARSE_FAILED")
        return ParsedFieldResult(key, district, 0.90, None, district)

    if key in {"applicant_dob", "dob", "date_of_birth", "spouse_dob"}:
        if urdu_nlp.is_unknown(text):
            return ParsedFieldResult(key, None, 0.95, "USER_UNKNOWN")
        value = urdu_nlp.parse_date(text)
        if value is None:
            return ParsedFieldResult(key, None, 0.0, "PARSE_FAILED")
        return ParsedFieldResult(key, value, 0.88, None, value)

    if key in {"payout_phone", "phone", "mobile"}:
        if urdu_nlp.is_unknown(text):
            return ParsedFieldResult(key, None, 0.95, "USER_UNKNOWN")
        digits = re.sub(r"\D", "", urdu_nlp.normalize_text(text))
        if digits.startswith("92") and len(digits) == 12:
            digits = "0" + digits[2:]
        if len(digits) == 10 and digits.startswith("3"):
            digits = "0" + digits
        if len(digits) != 11 or not digits.startswith("03"):
            return ParsedFieldResult(key, None, 0.0, "PARSE_FAILED")
        return ParsedFieldResult(key, f"+92{digits[1:]}", 0.93, None, digits)

    if key in {"applicant_full_name", "spouse_full_name", "full_name", "name"}:
        if urdu_nlp.is_unknown(text):
            return ParsedFieldResult(key, None, 0.95, "USER_UNKNOWN")
        name = urdu_nlp.parse_name(text)
        if not name:
            return ParsedFieldResult(key, None, 0.0, "PARSE_FAILED")
        confidence = 0.92 if len(name.split()) >= 2 else 0.66
        return ParsedFieldResult(key, urdu_nlp.title_case_name(name), confidence, None, name)

    if key in {"marital_status_widow", "is_widow"}:
        lowered = text.lower()
        if any(word in lowered for word in ("جی ہاں", "ہاں", "yes", "haan", "han", "درست")):
            return ParsedFieldResult(key, True, 0.93, None, "true")
        if any(word in lowered for word in ("نہیں", "no", "nahi", "nahin")):
            return ParsedFieldResult(key, False, 0.93, None, "false")
        return ParsedFieldResult(key, None, 0.0, "PARSE_FAILED")

    # Unknown field key: return the raw text so the caller can decide.
    if not text:
        return ParsedFieldResult(key, None, 0.0, "PARSE_FAILED")
    return ParsedFieldResult(key, text, 0.55, None, text)


# --------------------------------------------------------------------------- #
# deterministic embeddings
# --------------------------------------------------------------------------- #
def _hash_embedding(text: str, dim: int = EMBEDDING_DIM) -> list[float]:
    """Deterministic hashed TF-IDF vector (docs/04 §4.5, 64 dims in fake mode).

    Delegates to :mod:`app.ai.text_index`, which weights each content word by its
    inverse document frequency over the policy corpus and drops stopwords. A
    question whose content words never appear in the corpus therefore produces a
    zero vector — which is what lets the RAG abstention gate mean something
    without a real embedding model.
    """
    from app.ai import text_index

    return [round(value, 6) for value in text_index.hash_tfidf(text, dim)]


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b:
        return 0.0
    if len(a) != len(b):
        # A live 1536-dim vector left in the database must never be compared
        # against a 64-dim fake query: zip() would silently truncate and return a
        # plausible-looking score for two unrelated vectors.
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


# --------------------------------------------------------------------------- #
# extractive RAG answer (fake mode)
# --------------------------------------------------------------------------- #
_WORD = re.compile(r"[\w\u0600-\u06ff]+", re.UNICODE)

#: Question cue -> the words that mark a sentence as *answering* it.
#:
#: Word overlap alone finds sentences that share vocabulary with the question,
#: which is not the same as answering it: "what documents do I need?" overlaps
#: most with the paragraph that names the grant, not the list of documents. Each
#: pair is (question cues, answer cues); a sentence containing an answer cue for
#: a cue the question used gets a bonus, so the list of documents wins.
_INTENT_CUES: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (
        (
            "document", "documents", "paper", "papers", "proof", "dastavez", "kaghaz",
            "دستاویز", "دستاویزات", "کاغذ", "ثبوت",
        ),
        (
            "document", "documents", "cnic", "certificate", "certificates", "attach",
            "دستاویز", "دستاویزات", "شناختی", "سرٹیفکیٹ", "وفات",
        ),
    ),
    (
        (
            "amount", "much", "money", "pay", "paid", "payment", "rupees", "kitne",
            "kitna", "paise", "paisa", "rupay", "رقم", "پیسے", "کتنی", "ادائیگی",
        ),
        (
            "pkr", "rs", "rupee", "rupees", "amount", "monthly", "money", "pay", "paid",
            "payment", "روپے", "رقم", "ماہانہ", "ہزار", "پیسے", "ادائیگی",
        ),
    ),
    (
        (
            "eligible", "eligibility", "qualify", "qualifies", "mustahiq", "sharait",
            "اہلیت", "اہل", "مستحق", "شرائط",
        ),
        (
            "eligible", "eligibility", "must", "condition", "conditions", "alive", "valid",
            "years", "income", "death", "widow", "district", "conflicting",
            "اہل", "مستحق", "شرط", "شرائط", "زندہ", "میعاد", "عمر", "آمدنی", "وفات", "ضلع",
        ),
    ),
    (
        (
            "long", "duration", "months", "continue", "waqt", "din",
            "مدت", "کب", "تک",
        ),
        (
            "month", "months", "monthly", "duration", "continue", "day", "days",
            "working", "within", "immediately", "hours", "ماہ", "ماہانہ", "مدت",
            "جاری", "دن", "گھنٹے", "فوراً",
        ),
    ),
    (
        ("apply", "application", "how", "kaise", "darkhwast", "درخواست", "کیسے"),
        ("apply", "application", "submit", "درخواست", "جمع", "فارم"),
    ),
)

#: A sentence that only restates the mock-specimen banner answers nothing.
_BOILERPLATE = (
    "mock specimen",
    "not an official document",
    "not legal advice",
    "is synthetic",
    "synthetic and",
    "does not describe any real",
    "demonstrate the haqdaar prototype",
)

#: Markdown that must not reach the reader: emphasis, blockquote markers, bullets.
_MARKDOWN = re.compile(r"(\*\*|__|\*|`|^\s*>\s?|^\s*[-•]\s+)", re.MULTILINE)

#: Function words that carry no topic. Without this list "who is eligible?"
#: matched the heading "What This Grant Is Not" on *is* and *grant* and answered
#: from the wrong section; "how much does the widow grant pay?" matched the
#: Guzara allowance on *how* and *much*.
_STOPWORDS = frozenset(
    """
    a an the and or but if then than that this these those there here
    is are was were be been being am do does did done doing have has had having
    i me my we us our you your he she it they them their his her its
    of in on at to for from by with about into over under again further
    what which who whom whose when where why how
    can could should would will shall may might must
    not no nor so very too also just only own same such
    much many more most some any all each every few other another
    please tell know need want get got give
    aur hai hain ka ki ke ko se mein main kya koi kuch
    اور ہے ہیں کا کی کے کو سے میں کیا کوئی کچھ یہ وہ
    """.split()
)


def _topic_words(text: str) -> set[str]:
    """Content words of ``text`` — the ones that say what it is about."""
    return {word for word in _WORD.findall(text.lower()) if word not in _STOPWORDS}


def _chunk_field(chunk: Any, name: str, default: Any = None) -> Any:
    if isinstance(chunk, dict):
        return chunk.get(name, default)
    return getattr(chunk, name, default)


def _unwrap(text: str) -> str:
    """Join hard-wrapped lines inside a paragraph.

    The policy corpus is wrapped at ~80 columns, so splitting on newlines cuts
    sentences in half — "…widowed women living in the" was a real answer. A
    paragraph break is still a break; a single newline is just wrapping.
    """
    paragraphs = re.split(r"\n\s*\n", text)
    return "\n\n".join(re.sub(r"\s*\n\s*", " ", para).strip() for para in paragraphs)


def _plain(text: str) -> str:
    """Corpus prose without the markdown that would otherwise be read aloud."""
    return re.sub(r"\s{2,}", " ", _MARKDOWN.sub("", text)).strip()


def _paragraphs(content: str) -> list[str]:
    """Paragraphs of a chunk, de-wrapped and de-marked, boilerplate dropped.

    A paragraph is the unit of quotation, not a sentence. The corpus is written
    as an English paragraph followed by its Urdu counterpart, so a paragraph is
    already one coherent, single-language statement — quoting one whole is what
    makes the answer read like a policy rather than like a search result.
    """
    out: list[str] = []
    for paragraph in _unwrap(content).split("\n\n"):
        text = _plain(paragraph)
        if len(text) < 20:
            continue
        lowered = text.lower()
        if any(mark in lowered for mark in _BOILERPLATE):
            continue
        # "Two documents are required:" is a lead-in, not an answer. The list it
        # introduces is the next paragraph, so quoting the lead-in alone returned
        # a sentence that stops exactly where the information starts.
        if out and out[-1].endswith(":"):
            out[-1] = f"{out[-1]} {text}"
            continue
        out.append(text)
    return out


def _script_ratio(text: str) -> float:
    """Share of letters in ``text`` that are Arabic-script (Urdu)."""
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return 0.0
    arabic = sum(1 for ch in letters if "\u0600" <= ch <= "\u06ff")
    return arabic / len(letters)


def _answer_cues(question_words: set[str]) -> set[str]:
    """The answer-side vocabulary implied by the question's own cues."""
    cues: set[str] = set()
    for question_cues, answer_cues in _INTENT_CUES:
        if question_words & set(question_cues):
            cues.update(answer_cues)
    return cues


def _extractive_answer(
    question: str, chunks: Sequence[Any], lang: str
) -> tuple[str, list[str]]:
    """Quote the paragraph that answers the question, from one source only.

    Five rules, each learned from a bad answer:

    1. **The heading decides first.** "What documents do I need?" was answered
       from the consent document because the word "documents" appears there too;
       the section actually titled *Required Documents* lost on word overlap. A
       heading that matches the question outranks a sentence that merely shares
       its vocabulary.
    2. **One paragraph, one source.** Gluing the top three sentences across
       chunks produced "…living in the [uuid] The Sahara Widow Grant is not a
       loan". A paragraph is already a complete thought; quote it whole.
    3. **No identifiers in the prose.** The chunk id is already in the citation
       list; a 36-character UUID in the middle of an Urdu sentence is noise to
       the reader it is meant to reassure.
    4. **Answer in the language that was asked.** The corpus is bilingual, so
       retrieval happily returns the English paragraph to an Urdu question. The
       requested script is worth a bonus, which is what makes the Urdu answer
       Urdu rather than English with an Urdu preamble.
    5. **Answer, do not merely overlap.** A paragraph that shares vocabulary with
       the question but answers a different one is demoted by the intent cues.
    """
    if not chunks:
        return "", []

    wants_urdu = lang.startswith("ur")
    question_words = _topic_words(urdu_nlp.normalize_text(question))
    cues = _answer_cues(question_words)

    best_chunk_id = ""
    best_paragraph = ""
    best_score = -1.0

    # If the question names a document, answer from that document. "How much
    # does the widow grant pay?" was answered from the Guzara allowance because
    # both documents have an amount section and the allowance's paragraph scored
    # a hair higher; a soft bonus could not settle it. Naming the program is a
    # hard constraint, not a preference.
    named = {
        str(_chunk_field(chunk, "doc_title") or "")
        for chunk in chunks
        if _topic_words(str(_chunk_field(chunk, "doc_title") or "")) & question_words
    }
    candidates = [
        chunk for chunk in chunks if str(_chunk_field(chunk, "doc_title") or "") in named
    ] or list(chunks)

    for chunk in candidates:
        chunk_id = str(_chunk_field(chunk, "chunk_id") or _chunk_field(chunk, "id") or "")
        heading_words = _topic_words(str(_chunk_field(chunk, "section_heading") or ""))
        paragraphs = _paragraphs(str(_chunk_field(chunk, "content") or ""))
        if not paragraphs:
            continue

        for paragraph in paragraphs:
            words = _topic_words(paragraph)
            overlap = len(words & question_words) / (len(question_words) or 1)
            cue_bonus = 0.5 if words & cues else 0.0
            urdu_share = _script_ratio(paragraph)
            language_bonus = 0.6 * (urdu_share if wants_urdu else 1.0 - urdu_share)
            # The heading describes the whole section, so it scores every
            # paragraph in it. It used to require the paragraph to echo a heading
            # word, which silently penalised the Urdu half of a bilingual section:
            # "3. Required Documents" shares no word with its Urdu paragraph, so
            # the Urdu answer lost to the English one for an Urdu question.
            heading_overlap = len(heading_words & question_words) / (
                len(question_words) or 1
            )
            # A section titled with an answer cue — "Required Documents", "Who Is
            # Eligible", "Payout Schedule and Amount" — is the section that
            # answers that kind of question. This is what separates "Who Is
            # Eligible" from "What This Grant Is Not" when both mention the grant.
            heading_cue_bonus = 1.5 if heading_words & cues else 0.0
            score = (
                overlap
                + cue_bonus
                + language_bonus
                + 3.0 * heading_overlap
                + heading_cue_bonus
            )
            if score <= best_score:
                continue
            best_score = score
            best_chunk_id = chunk_id
            best_paragraph = paragraph

    if not best_paragraph:
        return "", []

    prefix = "دستیاب پالیسی کے مطابق:" if wants_urdu else "According to the available policy:"
    citations = [best_chunk_id] if best_chunk_id else []
    return f"{prefix} {best_paragraph}", citations


# --------------------------------------------------------------------------- #
# silent WAV (fake TTS)
# --------------------------------------------------------------------------- #
def _silent_wav(text: str, *, sample_rate: int = 8_000) -> bytes:
    duration = min(0.35 + 0.01 * len(text or ""), 2.0)
    frames = int(sample_rate * duration)
    data = b"\x00\x00" * frames
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16)
    header += b"data" + struct.pack("<I", len(data))
    return header + data


# --------------------------------------------------------------------------- #
# live provider
# --------------------------------------------------------------------------- #
class LiveOpenAIProvider:
    """OpenAI for AI tasks and Deepgram Flux for Urdu TTS."""

    name = "live"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        chat_model: str = "gpt-4o-mini",
        stt_model: str = "whisper-1",
        embed_model: str = "text-embedding-3-small",
        timeout_s: float = 10.0,
        tts_voice: str = "flux-ambreen-ur",
    ) -> None:
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY") or get_settings().openai_api_key
        self.chat_model = chat_model
        self.stt_model = stt_model
        self.embed_model = embed_model
        self.timeout_s = timeout_s
        self.tts_voice = tts_voice
        self._client: Any = None

    # -- plumbing ---------------------------------------------------------- #
    def _openai(self) -> Any:
        if self._client is not None:
            return self._client
        if not self.api_key:
            raise ProviderError("OPENAI_API_KEY is not set", code="NO_API_KEY", retryable=False)
        try:
            from openai import OpenAI  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise ProviderError(f"openai SDK unavailable: {exc}", code="NO_SDK") from exc
        self._client = OpenAI(api_key=self.api_key, timeout=self.timeout_s, max_retries=0)
        return self._client

    @staticmethod
    def _wrap(exc: Exception) -> ProviderError:
        status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
        name = type(exc).__name__
        if status == 429:
            return ProviderError("rate limited", code="RATE_LIMITED")
        if isinstance(status, int) and 500 <= status < 600:
            return ProviderError(f"upstream {status}", code="UPSTREAM_5XX")
        if "Timeout" in name or "timeout" in str(exc).lower():
            return ProviderError("timeout", code="TIMEOUT")
        return ProviderError(str(exc)[:200], code="PROVIDER_ERROR")

    def _chat_json(self, system: str, user: str, schema: dict[str, Any], name: str) -> dict[str, Any]:
        client = self._openai()
        try:
            response = client.chat.completions.create(
                model=self.chat_model,
                temperature=0,
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": name, "strict": True, "schema": schema},
                },
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            )
        except Exception as exc:
            raise self._wrap(exc) from exc
        content = response.choices[0].message.content or "{}"
        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise ProviderError("model returned non-JSON", code="BAD_JSON") from exc

    # -- STT --------------------------------------------------------------- #
    def transcribe_urdu(self, audio_bytes: bytes, mime_type: str = "audio/wav") -> STTResult:
        started = time.perf_counter()
        client = self._openai()
        suffix = {"audio/wav": "wav", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/webm": "webm"}.get(
            mime_type, "wav"
        )
        try:
            response = client.audio.transcriptions.create(
                model=self.stt_model,
                file=(f"audio.{suffix}", audio_bytes, mime_type),
                language="ur",
                response_format="verbose_json",
            )
        except Exception as exc:
            raise self._wrap(exc) from exc

        transcript = (getattr(response, "text", "") or "").strip()
        duration = float(getattr(response, "duration", 0.0) or 0.0)
        _emit(
            task_type="VOICE_STT",
            provider="live",
            model_name=self.stt_model,
            latency_ms=int((time.perf_counter() - started) * 1000),
            input_tokens=int(duration * 100),
            succeeded=bool(transcript),
            error_code=None if transcript else "EMPTY_TRANSCRIPT",
        )
        return STTResult(
            transcript=transcript,
            language="ur",
            confidence=0.92 if transcript else 0.0,
            duration_s=duration,
            provider="live",
            model=self.stt_model,
            available=bool(transcript),
        )

    # -- structured parse -------------------------------------------------- #
    def parse_structured_field(
        self, transcript: str, field_key: str, schema: dict[str, Any] | None = None
    ) -> ParsedFieldResult:
        started = time.perf_counter()
        safe_transcript = guardrails.prepare_for_llm(None, transcript)
        json_schema = schema or {
            "type": "object",
            "additionalProperties": False,
            "required": ["value", "confidence", "missing_reason"],
            "properties": {
                "value": {"type": ["string", "number", "boolean", "null"]},
                "confidence": {"type": "number"},
                "missing_reason": {"type": ["string", "null"]},
            },
        }
        system = (
            "You extract exactly one field from an Urdu or Roman-Urdu spoken answer. "
            "Normalise Urdu numerals (اٹھائیس ہزار → 28000). If the speaker says they do "
            "not know (نہیں معلوم / pata nahi), set value=null and missing_reason='USER_UNKNOWN'. "
            "Never invent a value."
        )
        payload = self._chat_json(
            system,
            guardrails.wrap_untrusted(f"field_key={field_key}\ntranscript={safe_transcript}"),
            json_schema,
            "field_parse",
        )
        value = payload.get("value")
        confidence = float(payload.get("confidence") or 0.0)
        missing = payload.get("missing_reason")

        # Deterministic post-check: the local parser must agree with the model.
        local = _parse_field(field_key, transcript)
        if local.value is not None and value is not None and str(local.value) != str(value):
            confidence = min(confidence, 0.55)

        _emit(
            task_type="VOICE_PARSE",
            provider="live",
            model_name=self.chat_model,
            latency_ms=int((time.perf_counter() - started) * 1000),
            input_tokens=len(safe_transcript.split()) + 60,
            output_tokens=20,
            succeeded=value is not None or missing == "USER_UNKNOWN",
        )
        return ParsedFieldResult(
            field_key=field_key,
            value=value,
            confidence=round(confidence, 3),
            missing_reason=missing,
            normalized=str(value) if value is not None else None,
            provider="live",
            model=self.chat_model,
            raw=payload,
        )

    # -- OCR --------------------------------------------------------------- #
    def ocr_document(self, image_bytes: bytes, doc_type: str = "CNIC_FRONT") -> OCRResult:
        started = time.perf_counter()
        client = self._openai()
        encoded = base64.b64encode(image_bytes).decode("ascii")
        schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["cnic", "full_name", "dob", "confidence"],
            "properties": {
                "cnic": {"type": ["string", "null"]},
                "full_name": {"type": ["string", "null"]},
                "dob": {"type": ["string", "null"]},
                "confidence": {"type": "number"},
            },
        }
        try:
            response = client.chat.completions.create(
                model=self.chat_model,
                temperature=0,
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": "ocr_fields", "strict": True, "schema": schema},
                },
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Read the printed text of this synthetic specimen document. "
                            "Return only what is legible. If a field is unreadable, return null "
                            "for it and lower the confidence. Never guess."
                        ),
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": f"doc_type={doc_type}"},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{encoded}"},
                            },
                        ],
                    },
                ],
            )
        except Exception as exc:
            raise self._wrap(exc) from exc

        content = response.choices[0].message.content or "{}"
        try:
            payload = json.loads(content)
        except json.JSONDecodeError as exc:
            raise ProviderError("OCR returned non-JSON", code="BAD_JSON") from exc

        fields = {
            key: payload.get(key)
            for key in ("cnic", "full_name", "dob")
            if payload.get(key)
        }
        confidence = float(payload.get("confidence") or 0.0)
        _emit(
            task_type="DOC_OCR",
            provider="live",
            model_name=self.chat_model,
            latency_ms=int((time.perf_counter() - started) * 1000),
            input_tokens=800,
            output_tokens=40,
            succeeded=bool(fields),
            error_code=None if fields else "OCR_UNAVAILABLE",
        )
        return OCRResult(
            fields=fields,
            confidence=round(confidence, 3),
            provider="live",
            model=self.chat_model,
            available=bool(fields),
        )

    # -- embeddings -------------------------------------------------------- #
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        started = time.perf_counter()
        client = self._openai()
        try:
            response = client.embeddings.create(model=self.embed_model, input=texts)
        except Exception as exc:
            raise self._wrap(exc) from exc
        vectors = [list(item.embedding) for item in response.data]
        _emit(
            task_type="RAG_ASK",
            provider="live",
            model_name=self.embed_model,
            latency_ms=int((time.perf_counter() - started) * 1000),
            input_tokens=sum(len((text or "").split()) for text in texts),
        )
        return vectors

    # -- RAG --------------------------------------------------------------- #
    def rag_synthesize(
        self, question: str, chunks: Sequence[Any], lang: str = "ur"
    ) -> RAGSynthesisResult:
        started = time.perf_counter()
        safe_question = guardrails.prepare_for_llm(None, question)
        context = "\n\n".join(
            f"[{_chunk_field(chunk, 'chunk_id')}] {_chunk_field(chunk, 'content')}" for chunk in chunks
        )
        schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["answer", "citations", "confidence"],
            "properties": {
                "answer": {"type": "string"},
                "citations": {"type": "array", "items": {"type": "string"}},
                "confidence": {"type": "number"},
            },
        }
        system = (
            "You are the Haqdaar policy assistant for a simulated government benefits "
            "prototype. Answer in the citizen's language. " + guardrails.RAG_GUARDRAIL
        )
        payload = self._chat_json(
            system,
            guardrails.wrap_untrusted(f"question={safe_question}\n\ncontext:\n{context}"),
            schema,
            "rag_answer",
        )
        answer = str(payload.get("answer") or "")
        filtered = guardrails.filter_personal_claims(answer, lang=lang)
        if filtered.triggered:
            guardrails.record_guardrail_event(
                None, kind="rag_personal_claim", code="PERSONAL_ELIGIBILITY", excerpt=answer
            )
        _emit(
            task_type="RAG_ASK",
            provider="live",
            model_name=self.chat_model,
            latency_ms=int((time.perf_counter() - started) * 1000),
            input_tokens=len(context.split()) + 120,
            output_tokens=len(answer.split()),
            succeeded=bool(answer),
        )
        return RAGSynthesisResult(
            answer=filtered.text,
            citations=[str(c) for c in payload.get("citations") or []],
            confidence=round(float(payload.get("confidence") or 0.0), 3),
            provider="live",
            model=self.chat_model,
            available=bool(answer),
        )

    # -- TTS --------------------------------------------------------------- #
    def synthesize_urdu_tts(self, text: str) -> bytes:
        started = time.perf_counter()
        settings = get_settings()
        api_key = settings.deepgram_api_key.strip()
        if not api_key:
            raise ProviderError(
                "DEEPGRAM_API_KEY is not set",
                code="NO_DEEPGRAM_API_KEY",
                retryable=False,
            )

        cache_dir = _tts_cache_dir()
        digest = hashlib.sha256(f"{self.tts_voice}:{text}".encode()).hexdigest()
        cached = cache_dir / f"{digest}.mp3"
        if cached.exists():
            _emit(
                task_type="VOICE_TTS",
                provider="deepgram",
                model_name=self.tts_voice,
                latency_ms=int((time.perf_counter() - started) * 1000),
                input_tokens=len((text or "").split()),
            )
            return cached.read_bytes()

        try:
            response = httpx.post(
                "https://api.deepgram.com/v2/speak",
                params={"model": self.tts_voice, "encoding": "mp3"},
                headers={
                    "Authorization": f"Token {api_key}",
                    "Content-Type": "application/json",
                },
                json={"text": text},
                timeout=self.timeout_s,
            )
            response.raise_for_status()
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            code = "DEEPGRAM_TTS_HTTP" if status else "DEEPGRAM_TTS_FAILED"
            message = f"Deepgram TTS request failed (HTTP {status})" if status else "Deepgram TTS request failed"
            raise ProviderError(message, code=code) from exc

        audio = response.content
        if not audio:
            raise ProviderError("Deepgram returned no audio", code="TTS_EMPTY")
        if not response.headers.get("content-type", "").startswith("audio/"):
            raise ProviderError("Deepgram returned a non-audio response", code="TTS_INVALID_MEDIA")
        cache_dir.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(audio)
        _emit(
            task_type="VOICE_TTS",
            provider="deepgram",
            model_name=self.tts_voice,
            latency_ms=int((time.perf_counter() - started) * 1000),
            input_tokens=len((text or "").split()),
        )
        return audio


def _tts_cache_dir() -> Path:
    """``UPLOAD_DIR/tts_cache``, resolved the same way the document writer resolves it."""
    return paths.upload_dir() / "tts_cache"


# --------------------------------------------------------------------------- #
# circuit breaker + resilient wrapper
# --------------------------------------------------------------------------- #
class CircuitBreaker:
    """Trip after ``threshold`` consecutive retryable failures; auto-reset."""

    def __init__(self, *, threshold: int = 3, cooldown_s: float = 60.0) -> None:
        self.threshold = threshold
        self.cooldown_s = cooldown_s
        self.failures = 0
        self.opened_at: float | None = None
        self.last_error: str | None = None

    @property
    def is_open(self) -> bool:
        if self.opened_at is None:
            return False
        if time.monotonic() - self.opened_at >= self.cooldown_s:
            self.reset()
            return False
        return True

    def record_success(self) -> None:
        self.failures = 0
        self.opened_at = None
        self.last_error = None

    def record_failure(self, error: ProviderError) -> None:
        self.last_error = error.code
        if not error.retryable:
            return
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened_at = time.monotonic()

    def reset(self) -> None:
        self.failures = 0
        self.opened_at = None


class ResilientProvider:
    """Live provider with a silent, deterministic fake fallback.

    The demo must never crash because OpenAI is slow, rate-limited or down: the
    breaker trips and every subsequent call is served by the fake provider until
    the cooldown expires.
    """

    name = "resilient"

    def __init__(self, live: AIProvider, fake: AIProvider, breaker: CircuitBreaker | None = None) -> None:
        self.live = live
        self.fake = fake
        self.breaker = breaker or CircuitBreaker()
        self.fallback_count = 0

    def _call(self, method: str, *args: Any, **kwargs: Any) -> Any:
        if self.breaker.is_open:
            self.fallback_count += 1
            return getattr(self.fake, method)(*args, **kwargs)
        try:
            result = getattr(self.live, method)(*args, **kwargs)
        except ProviderError as exc:
            self.breaker.record_failure(exc)
            self.fallback_count += 1
            logger.warning("live AI call %s failed (%s) — falling back to fake", method, exc.code)
            return getattr(self.fake, method)(*args, **kwargs)
        except Exception as exc:  # pragma: no cover - defensive
            self.breaker.record_failure(ProviderError(str(exc), code="UNEXPECTED"))
            self.fallback_count += 1
            logger.warning("live AI call %s crashed (%s) — falling back to fake", method, exc)
            return getattr(self.fake, method)(*args, **kwargs)
        self.breaker.record_success()
        return result

    def transcribe_urdu(self, audio_bytes: bytes, mime_type: str = "audio/wav") -> STTResult:
        return self._call("transcribe_urdu", audio_bytes, mime_type)

    def parse_structured_field(
        self, transcript: str, field_key: str, schema: dict[str, Any] | None = None
    ) -> ParsedFieldResult:
        return self._call("parse_structured_field", transcript, field_key, schema)

    def ocr_document(self, image_bytes: bytes, doc_type: str = "CNIC_FRONT") -> OCRResult:
        return self._call("ocr_document", image_bytes, doc_type)

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return self._call("embed_texts", texts)

    def rag_synthesize(
        self, question: str, chunks: Sequence[Any], lang: str = "ur"
    ) -> RAGSynthesisResult:
        return self._call("rag_synthesize", question, chunks, lang)

    def synthesize_urdu_tts(self, text: str) -> bytes:
        return self._call("synthesize_urdu_tts", text)


# --------------------------------------------------------------------------- #
# factory
# --------------------------------------------------------------------------- #
_PROVIDER: AIProvider | None = None
_FAKE_SINGLETON = FakeDeterministicProvider()


def provider_mode() -> str:
    # Honor shell overrides first, then the repository .env loaded by Settings.
    # Reading os.environ alone silently forced local runs back to fake mode.
    mode = os.environ.get("AI_PROVIDER") or get_settings().ai_provider or "fake"
    return mode.strip().lower()


def get_provider() -> AIProvider:
    """Return the process-wide provider for the current ``AI_PROVIDER`` mode."""
    global _PROVIDER
    if _PROVIDER is not None:
        return _PROVIDER

    mode = provider_mode()
    if mode == "live":
        _PROVIDER = ResilientProvider(LiveOpenAIProvider(), _FAKE_SINGLETON)
    else:
        _PROVIDER = _FAKE_SINGLETON
    return _PROVIDER


def get_fake_provider() -> FakeDeterministicProvider:
    """The fake provider, regardless of mode — used by tests and benchmarks."""
    return _FAKE_SINGLETON


def reset_provider() -> None:
    global _PROVIDER
    _PROVIDER = None


__all__ = [
    "COST_TABLE",
    "EMBEDDING_DIM",
    "PROMPT_VERSION",
    "AIProvider",
    "CircuitBreaker",
    "FakeDeterministicProvider",
    "LiveOpenAIProvider",
    "OCRResult",
    "ParsedFieldResult",
    "ProviderError",
    "RAGSynthesisResult",
    "ResilientProvider",
    "STTResult",
    "TTSResult",
    "TelemetryContext",
    "cosine",
    "fixture_index",
    "get_fake_provider",
    "get_provider",
    "provider_mode",
    "reset_fixtures",
    "reset_provider",
    "telemetry",
]
