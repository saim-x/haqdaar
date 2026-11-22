"""Grounded policy Q&A over the bilingual policy corpus (docs/07 §4).

The citizen asks a question in Urdu or English; we retrieve the four most relevant
policy chunks and answer **only** from them. Two rules make this safe:

1. **Abstention gate.** If the best hybrid score is below ``0.42`` (``0.25`` in
   fake hash-embedding mode) we return ``NOT_SURE`` and never call the model at
   all. A wrong answer about a benefit is worse than "I am not sure".
2. **No personal eligibility claims.** The answer is post-filtered so it can never
   say "you are approved" or "آپ منظور ہو گئے". The citizen is always told to
   submit an application to find out.

Retrieval is hybrid: ``0.70 * cosine`` over a ``DOUBLE PRECISION[]`` embedding
plus ``0.30 * normalized ts_rank_cd`` from Postgres ``tsvector``. No ``pgvector``
dependency, no external vector store.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.ai import guardrails, text_index
from app.ai.provider import EMBEDDING_DIM, _hash_embedding, cosine, get_provider, telemetry
from app.ai.text_index import (
    CHUNK_MAX_TOKENS,
    CHUNK_MIN_TOKENS,
    CHUNK_OVERLAP_TOKENS,
    Chunk,
    chunk_markdown,
    count_tokens,
    parse_front_matter,
)

logger = logging.getLogger("haqdaar.ai.rag")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
POLICY_DIR = DATA_DIR / "policy_docs"

TOP_K = 4
DENSE_WEIGHT = 0.70
LEXICAL_WEIGHT = 0.30

#: ``ts_rank_cd`` value that counts as a full lexical match. Measured over the
#: policy corpus: real questions peak at 0.4–2.0, incidental single-word matches
#: at 0.1–0.3. Dividing by the peak instead would promote those to 1.0.
LEXICAL_SATURATION = 0.5

#: docs/07 §4.2 - abstain rather than guess.
ABSTAIN_THRESHOLD_LIVE = 0.42
ABSTAIN_THRESHOLD_FAKE = 0.25

#: Share of a question's content words that must exist in the corpus at all.
#:
#: The score gate asks "is some chunk similar to this question?"; this asks "is
#: this question about our corpus?". They are different questions and only the
#: second one rejects "what is the weather in Karachi tomorrow?" - Karachi is a
#: district in the eligibility list, so one word of three matches and the cosine
#: clears the threshold. Measured over the corpus: in-domain questions cover
#: 0.67–1.00 of their content words, off-topic ones 0.00–0.33.
MIN_CORPUS_COVERAGE = 0.5

NOT_SURE_UR = (
    "مجھے اس سوال کا یقین سے جواب نہیں معلوم۔ آپ کمیونٹی مددگار سے پوچھ سکتی ہیں، "
    "یا محکمے کے افسر سے رابطہ کر سکتی ہیں۔ اپنی اہلیت جاننے کے لیے درخواست جمع کروانا "
    "بہترین طریقہ ہے۔"
)
NOT_SURE_EN = (
    "I am not sure about that. You can ask a community helper or contact a "
    "department officer. The reliable way to find out whether you qualify is to "
    "submit an application."
)

DISCLAIMER_UR = "یہ معلومات صرف رہنمائی کے لیے ہیں۔ اپنی اہلیت کی تصدیق کے لیے درخواست جمع کروائیں۔"
DISCLAIMER_EN = (
    "This is general guidance only. Submit an application to find out whether you qualify."
)

#: The guide's honest abstention (ADR-025). Fixed text, never generated: an
#: abstention that a model paraphrases is no longer a guaranteed abstention.
SPOKEN_ABSTENTION_UR = (
    "بہن، مجھے اس بارے میں صحیح معلومات نہیں ہیں اور میں غلط بات نہیں بتانا چاہتی۔ "
    "آپ مدد کے لیے افسر یا ہیلپر سے پوچھ سکتی ہیں۔"
)
SPOKEN_ABSTENTION_EN = (
    "Sister, I do not have reliable information about that and I will not guess. "
    "Please ask an officer or a community helper for help."
)

#: One breath of speech. Matches ``provider.SPOKEN_SUMMARY_MAX_CHARS`` so the
#: client can size its caption bar against a known ceiling.
SPOKEN_SUMMARY_MAX_CHARS = 280

# --------------------------------------------------------------------------- #
# data types
# --------------------------------------------------------------------------- #
@dataclass
class RetrievedChunk:
    chunk_id: str
    document_id: str
    doc_title: str
    section_heading: str
    version: str
    content: str
    dense_score: float = 0.0
    lexical_score: float = 0.0
    hybrid_score: float = 0.0
    used_hash_embeddings: bool = False

    def citation(self) -> dict[str, Any]:
        return {
            "doc_title": self.doc_title,
            "section": self.section_heading,
            "version": self.version,
            "excerpt": _excerpt(self.content),
            "score": round(self.hybrid_score, 4),
        }


@dataclass
class RagAnswer:
    status: str
    answer: str
    citations: list[dict[str, Any]] = field(default_factory=list)
    top_score: float = 0.0
    lang: str = "ur"
    provider: str = "fake"
    model: str = "fake-extractive"
    guardrail_triggered: bool = False
    retrieved: int = 0
    coverage: float = 0.0
    #: Only present when the caller asked for ``conversational: true`` (ADR-025).
    #: ``answer`` and ``citations`` are never altered by it.
    spoken_summary: str | None = None

    def as_dict(self) -> dict[str, Any]:
        body: dict[str, Any] = {
            "status": self.status,
            "answer": self.answer,
            "citations": self.citations,
            "top_score": round(self.top_score, 4),
            "lang": self.lang,
            "provider": self.provider,
            "model": self.model,
            "guardrail_triggered": self.guardrail_triggered,
            "retrieved": self.retrieved,
            "coverage": round(self.coverage, 4),
        }
        # Omitted entirely when not requested, so the existing contract and every
        # existing test see byte-identical payloads.
        if self.spoken_summary is not None:
            body["spoken_summary"] = self.spoken_summary
        return body


# --------------------------------------------------------------------------- #
# text helpers
# --------------------------------------------------------------------------- #
def _excerpt(content: str, limit: int = 320) -> str:
    flat = re.sub(r"\s+", " ", content or "").strip()
    if len(flat) <= limit:
        return flat
    cut = flat[:limit]
    if " " in cut:
        cut = cut[: cut.rfind(" ")]
    return cut + "…"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-") or "section"


def _stable_id(*parts: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, "haqdaar:rag:" + ":".join(parts))


def content_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# corpus loading
# --------------------------------------------------------------------------- #
@dataclass
class PolicyDoc:
    path: Path
    title: str
    version: str
    source_type: str
    program_code: str | None
    body: str
    chunks: list[Chunk] = field(default_factory=list)


def load_policy_docs(directory: Path | None = None) -> list[PolicyDoc]:
    """Read every ``*.md`` in the policy directory, sorted by filename."""
    target = directory or POLICY_DIR
    if not target.exists():
        return []

    docs: list[PolicyDoc] = []
    for path in sorted(target.glob("*.md")):
        try:
            raw = path.read_text(encoding="utf-8")
        except Exception as exc:  # pragma: no cover
            logger.warning("cannot read %s: %s", path, exc)
            continue
        meta, body = parse_front_matter(raw)
        title = str(meta.get("doc_title") or path.stem.replace("_", " ").title())
        docs.append(
            PolicyDoc(
                path=path,
                title=title,
                version=str(meta.get("version") or "1.0"),
                source_type=str(meta.get("source_type") or "POLICY_MD"),
                program_code=meta.get("program_code"),
                body=body,
                chunks=chunk_markdown(body),
            )
        )
    return docs


# --------------------------------------------------------------------------- #
# indexing
# --------------------------------------------------------------------------- #
def _embed(text: str) -> list[float]:
    provider = get_provider()
    try:
        vector = provider.embed_texts([text])[0]
    except Exception as exc:  # pragma: no cover - provider already degrades
        logger.warning("embedding failed, using local hash: %s", exc)
        vector = _hash_embedding(text)
    return [float(value) for value in vector]


def _table(name: str) -> Any:
    from app.ai import api_support

    return api_support.table(name)


def _insert(db: Any, name: str, row: dict[str, Any]) -> dict[str, Any]:
    target = _table(name)
    allowed = {column.name for column in target.columns}
    payload = {key: value for key, value in row.items() if key in allowed}
    db.execute(target.insert(), [payload])
    return payload


def _delete_document(db: Any, document_id: Any) -> None:
    chunks = _table("rag_chunks")
    db.execute(chunks.delete().where(chunks.c.document_id == document_id))
    documents = _table("rag_documents")
    db.execute(documents.delete().where(documents.c.id == document_id))


def index_document(
    db: Any,
    *,
    title: str,
    body: str,
    version: str = "1.0",
    source_type: str = "POLICY_MD",
    program_id: Any = None,
    tenant_id: Any = None,
    doc_key: str | None = None,
) -> dict[str, Any]:
    """(Re)index one document. Idempotent: the same ``doc_key`` replaces itself."""
    key = doc_key or _slug(title)
    document_id = _stable_id(key, version)

    _delete_document(db, document_id)

    _insert(
        db,
        "rag_documents",
        {
            "id": document_id,
            "tenant_id": tenant_id,
            "program_id": program_id,
            "title": title,
            "version": version,
            "source_type": source_type,
            "is_active": True,
        },
    )

    chunks = chunk_markdown(body)
    provider = get_provider()
    embeddings: list[list[float]] = []
    if chunks:
        try:
            embeddings = provider.embed_texts([chunk.content for chunk in chunks])
        except Exception:  # pragma: no cover - fallback per chunk
            embeddings = [_embed(chunk.content) for chunk in chunks]
    for chunk, vector in zip(chunks, embeddings, strict=False):
        _insert(
            db,
            "rag_chunks",
            {
                "id": _stable_id(key, version, str(chunk.chunk_index)),
                "document_id": document_id,
                "section_heading": chunk.section_heading,
                "chunk_index": chunk.chunk_index,
                "content": chunk.content,
                "embedding": vector,
            },
        )

    return {
        "document_id": str(document_id),
        "title": title,
        "version": version,
        "source_type": source_type,
        "chunks": len(chunks),
    }


def reindex_all(db: Any, *, directory: Path | None = None) -> dict[str, Any]:
    """Index the whole policy corpus. Called by the seeder and by admins."""
    docs = load_policy_docs(directory)
    indexed: list[dict[str, Any]] = []
    for doc in docs:
        indexed.append(
            index_document(
                db,
                title=doc.title,
                body=doc.body,
                version=doc.version,
                source_type=doc.source_type,
                doc_key=doc.path.stem,
            )
        )
    return {
        "documents": len(indexed),
        "chunks": sum(item["chunks"] for item in indexed),
        "titles": [item["title"] for item in indexed],
    }


# --------------------------------------------------------------------------- #
# auto rule summary (docs/07 §4.1 item 5)
# --------------------------------------------------------------------------- #
def render_rule_summary(ruleset: dict[str, Any], *, program_name: str, version: int) -> str:
    """Render the active rule set as Markdown so RAG never quotes stale thresholds."""
    policy = ruleset.get("policy") or {}
    formula = ruleset.get("benefit_formula") or {}
    lines = [
        f"# {program_name} - Active Eligibility Rules",
        "",
        f"Rule version **v{version}**. This summary is generated automatically from the "
        "published rule set, so it always matches what the decision engine is running.",
        "",
        "## Automatic Approval Threshold",
        "",
        f"- Minimum confidence for automatic approval: "
        f"**{float(policy.get('auto_approve_confidence_threshold', 0.9)):.2f}**",
        f"- Maximum amount that may be approved automatically: "
        f"**PKR {int(policy.get('auto_approve_max_amount_pkr', 20000)):,}**",
        f"- Maximum rounds of follow-up questions: "
        f"**{int(policy.get('max_ask_more_rounds', 2))}**",
        "",
        "If any required rule fails or cannot be determined, the application goes to a "
        "human officer. The system has no automatic rejection path.",
        "",
        "## Eligibility Rules",
        "",
    ]

    for rule in ruleset.get("eligibility_rules", []):
        op = rule.get("op")
        value = rule.get("value")
        if isinstance(value, list):
            rendered = ", ".join(str(item) for item in value)
        elif isinstance(value, bool):
            rendered = "true" if value else "false"
        else:
            rendered = str(value)
        lines.extend(
            [
                f"### {rule.get('id')} - {rule.get('label_en')}",
                "",
                f"- Fact: `{rule.get('fact')}` {op} `{rendered}`",
                f"- If it fails: **{rule.get('on_fail')}**",
                f"- If it is unknown: **{rule.get('on_unknown')}**",
                f"- Required for automatic approval: "
                f"**{'yes' if rule.get('required_for_auto') else 'no'}**",
                f"- {rule.get('label_ur')}",
                "",
            ]
        )

    if formula:
        lines.extend(
            [
                "## Benefit Amount",
                "",
                f"- Base amount: **PKR {int(formula.get('base_amount_pkr', 0)):,}**",
                f"- Per child under 18: **PKR {int(formula.get('per_child_bonus_pkr', 0)):,}**",
                f"- Children counted at most: **{int(formula.get('max_children_counted', 0))}**",
                f"- Hard cap: **PKR {int(formula.get('hard_cap_pkr', 0)):,}**",
                "",
                "The number of children under 18 must be known before an amount is "
                "finalised. If it is unknown, the application is not approved "
                "automatically and the citizen is asked for it.",
                "",
            ]
        )

    return "\n".join(lines)


def reindex_program_rules(db: Any, program_id: Any) -> dict[str, Any]:
    """Regenerate the ``AUTO_RULE_SUMMARY`` document for one program.

    This is the ``REINDEX_RAG`` job handler: whenever an admin publishes a new rule
    version, the summary is rebuilt and re-embedded so the assistant can never
    quote a threshold the engine no longer uses.
    """
    programs = _table("programs")
    row = db.execute(programs.select().where(programs.c.id == program_id)).mappings().first()
    if row is None:
        raise ValueError(f"program {program_id} not found")

    program_code = row.get("code") or row.get("program_code") or "PROGRAM"
    program_name = row.get("name") or program_code

    ruleset: dict[str, Any] | None = None
    version_number = 1

    versions = _table("rule_versions")
    active_version_id = row.get("active_rule_version_id")
    version_row = None
    if active_version_id is not None:
        version_row = db.execute(
            versions.select().where(versions.c.id == active_version_id).limit(1)
        ).mappings().first()
    if version_row is None:
        stmt = (
            versions.select()
            .where(versions.c.program_id == program_id)
            .order_by(versions.c.version_number.desc())
            .limit(1)
        )
        version_row = db.execute(stmt).mappings().first()
    if version_row is not None:
        version_number = int(version_row.get("version_number") or 1)
        raw = version_row.get("rules_json")
        if isinstance(raw, str):
            try:
                ruleset = json.loads(raw)
            except Exception:  # pragma: no cover
                ruleset = None
        elif isinstance(raw, dict):
            ruleset = raw

    if ruleset is None:
        logger.warning("no rule version found for program %s; skipping summary", program_id)
        return {"skipped": True, "reason": "NO_RULE_VERSION", "program_id": str(program_id)}

    # Deactivate prior AUTO_RULE_SUMMARY versions for this program so stale rules are never retrieved.
    documents = _table("rag_documents")
    db.execute(
        documents.update()
        .where(
            documents.c.program_id == program_id,
            documents.c.source_type == "AUTO_RULE_SUMMARY",
        )
        .values(is_active=False)
    )

    body = render_rule_summary(ruleset, program_name=program_name, version=version_number)
    result = index_document(
        db,
        title=f"{program_name} - Active Eligibility Rules",
        body=body,
        version=f"v{version_number}",
        source_type="AUTO_RULE_SUMMARY",
        program_id=program_id,
        tenant_id=row.get("tenant_id"),
        doc_key=f"auto-rule-summary-{program_code}",
    )
    result["program_id"] = str(program_id)
    result["rule_version"] = version_number
    return result


# --------------------------------------------------------------------------- #
# retrieval
# --------------------------------------------------------------------------- #
def _is_fake_mode() -> bool:
    try:
        from app.ai.provider import provider_mode

        return provider_mode() == "fake"
    except Exception:  # pragma: no cover
        import os

        return os.environ.get("AI_PROVIDER", "fake").strip().lower() != "live"


def abstain_threshold() -> float:
    return ABSTAIN_THRESHOLD_FAKE if _is_fake_mode() else ABSTAIN_THRESHOLD_LIVE


def _corpus_coverage(question: str) -> float:
    """Share of the question's content words that the corpus contains.

    A question that shares one incidental proper noun with a policy - a district
    name, a programme name - is not a question about that policy. Counting how
    much of the question the corpus can even speak to is what separates the two,
    and unlike a similarity score it does not move when chunk sizes change.
    """
    stats = text_index.corpus_stats()
    words = text_index.tokenize(question)
    if not words:
        return 0.0
    return sum(1 for word in words if stats.idf(word) > 0.0) / len(words)


def _lexical_query(question: str) -> str | None:
    """Build an OR ``tsquery`` from the question's in-corpus content words.

    ``plainto_tsquery`` ANDs its terms, so a natural question ("how much is the
    widow grant") matches nothing at all. OR-ing the content words is what makes
    ``ts_rank_cd`` rank by overlap instead of demanding every word.
    """
    stats = text_index.corpus_stats()
    words = [word for word in text_index.tokenize(question) if stats.idf(word) > 0.0]
    if not words:
        return None
    return " | ".join(words)


def _lexical_scores(db: Any, question: str, chunk_ids: Sequence[Any]) -> dict[str, float]:
    """Postgres ``ts_rank_cd`` per chunk, scaled to 0..1 by a saturation constant.

    Dividing by the observed peak would hand a full ``1.0`` to whichever chunk
    happened to match one incidental word, which is how an off-topic question
    sneaks past the abstention gate. Dividing by a fixed saturation instead means
    a weak single-word match stays weak.
    """
    if not chunk_ids:
        return {}

    query = _lexical_query(question)
    if query is None:
        return {str(chunk_id): 0.0 for chunk_id in chunk_ids}

    from sqlalchemy import func, select

    chunks = _table("rag_chunks")
    rank = func.ts_rank_cd(chunks.c.tsv, func.to_tsquery("simple", query))
    stmt = select(chunks.c.id, rank.label("rank")).where(chunks.c.id.in_(list(chunk_ids)))

    try:
        rows = db.execute(stmt).all()
    except Exception as exc:  # pragma: no cover - tsvector unavailable
        logger.warning("lexical scoring unavailable: %s", exc)
        return {}

    return {
        str(row[0]): min(1.0, float(row[1] or 0.0) / LEXICAL_SATURATION) for row in rows
    }


def retrieve(
    db: Any,
    question: str,
    *,
    program_id: Any = None,
    top_k: int = TOP_K,
) -> list[RetrievedChunk]:
    """Hybrid dense + lexical retrieval over the active corpus."""
    from sqlalchemy import select

    documents = _table("rag_documents")
    chunks = _table("rag_chunks")

    stmt = (
        select(
            chunks.c.id,
            chunks.c.document_id,
            chunks.c.section_heading,
            chunks.c.content,
            chunks.c.embedding,
            documents.c.title,
            documents.c.version,
            documents.c.program_id,
        )
        .join(documents, documents.c.id == chunks.c.document_id)
        .where(documents.c.is_active.is_(True))
    )
    if program_id is not None:
        stmt = stmt.where(
            (documents.c.program_id == program_id) | (documents.c.program_id.is_(None))
        )

    rows = db.execute(stmt).mappings().all()
    if not rows:
        return []

    query_vector = _embed(question)
    # Compare the entire result set in one vector space. This also handles an
    # outage with a live index, or a live provider with an index built offline.
    use_hash_embeddings = len(query_vector) == EMBEDDING_DIM or any(
        len(row["embedding"]) != len(query_vector)
        for row in rows
        if row["embedding"] is not None
    )
    if use_hash_embeddings and len(query_vector) != EMBEDDING_DIM:
        query_vector = _hash_embedding(question)
    lexical = _lexical_scores(db, question, [row["id"] for row in rows])

    scored: list[RetrievedChunk] = []
    for row in rows:
        embedding = row["embedding"]
        if embedding is None:
            continue
        vector = (
            _hash_embedding(row["content"])
            if use_hash_embeddings
            else [float(value) for value in embedding]
        )
        dense = cosine(query_vector, vector)
        dense = max(0.0, min(1.0, dense))
        lex = lexical.get(str(row["id"]), 0.0)
        hybrid = DENSE_WEIGHT * dense + LEXICAL_WEIGHT * lex
        scored.append(
            RetrievedChunk(
                chunk_id=str(row["id"]),
                document_id=str(row["document_id"]),
                doc_title=str(row["title"]),
                section_heading=str(row["section_heading"] or ""),
                version=str(row["version"] or "1.0"),
                content=str(row["content"]),
                dense_score=round(dense, 4),
                lexical_score=round(lex, 4),
                hybrid_score=round(hybrid, 4),
                used_hash_embeddings=use_hash_embeddings,
            )
        )

    scored.sort(key=lambda item: (-item.hybrid_score, item.chunk_id))
    return scored[:top_k]


# --------------------------------------------------------------------------- #
# answering
# --------------------------------------------------------------------------- #
def _extractive_answer(chunks: Sequence[RetrievedChunk], lang: str) -> str:
    """Fake-mode answer: quote the best chunk instead of inventing prose."""
    if not chunks:
        return NOT_SURE_UR if lang == "ur" else NOT_SURE_EN

    best = chunks[0]
    body = re.sub(r"\s+", " ", best.content).strip()
    body = _excerpt(body, 420)
    tag = f"[{best.chunk_id[:8]}]"
    if lang == "ur":
        return f"{body} {tag}"
    return f"{body} {tag}"


def _synthesize(
    db: Any,
    question: str,
    chunks: Sequence[RetrievedChunk],
    *,
    lang: str,
    tenant_id: Any = None,
) -> tuple[str, str, str]:
    """Return ``(answer, provider, model)``. Never called below the abstain gate.

    The provider owns the prompt, the citation format and the personal-claim
    filter, so live and fake modes share one code path.
    """
    provider = get_provider()
    try:
        with telemetry(db, tenant_id=tenant_id, resource_type="rag", resource_id=None):
            result = provider.rag_synthesize(question, list(chunks), lang)
    except Exception as exc:  # pragma: no cover - provider already degrades
        logger.warning("rag synthesis failed, falling back to extractive: %s", exc)
        return _extractive_answer(chunks, lang), "fake", "fake-extractive"

    answer = (result.answer or "").strip()
    if not answer:
        return _extractive_answer(chunks, lang), "fake", "fake-extractive"
    return answer, result.provider, result.model


def _spoken_summary(
    db: Any,
    *,
    answer: str,
    chunks: Sequence[RetrievedChunk],
    lang: str,
    tenant_id: Any = None,
) -> str:
    """Warm spoken reframing of an already-grounded answer (ADR-025).

    The excerpt handed to the model is the **single** chunk the answer was built
    from, so the reframing cannot reach a fact the citation does not contain. If
    the provider fails, the deterministic wrapper is used instead - a guide that
    goes quiet mid-sentence is worse than one that speaks plainly.
    """
    from app.ai.provider import _spoken_wrapper

    if not chunks:
        return SPOKEN_ABSTENTION_UR if lang == "ur" else SPOKEN_ABSTENTION_EN

    excerpt = chunks[0].content
    provider = get_provider()
    try:
        with telemetry(db, tenant_id=tenant_id, resource_type="rag_spoken", resource_id=None):
            spoken = provider.spoken_summary(answer, excerpt, lang)
    except Exception as exc:  # pragma: no cover - provider already degrades
        logger.warning("spoken reframing failed, using deterministic wrapper: %s", exc)
        spoken = ""

    spoken = (spoken or "").strip()
    if not spoken:
        spoken = _spoken_wrapper(answer, lang)
    if not spoken:
        return SPOKEN_ABSTENTION_UR if lang == "ur" else SPOKEN_ABSTENTION_EN
    return spoken[:SPOKEN_SUMMARY_MAX_CHARS]


def ask(
    db: Any,
    question: str,
    *,
    program_id: Any = None,
    lang: str = "ur",
    tenant_id: Any = None,
    top_k: int = TOP_K,
    conversational: bool = False,
) -> RagAnswer:
    """Answer a policy question, or abstain honestly.

    ``conversational`` is additive and off by default: it only adds a
    ``spoken_summary`` for the video guide, and never changes ``answer`` or
    ``citations``.
    """
    language = "en" if str(lang).lower().startswith("en") else "ur"
    cleaned = guardrails.sanitize(
        db, question or "", resource_type="rag_question", resource_id=None
    ).strip()

    if not cleaned:
        return RagAnswer(
            status="NOT_SURE",
            answer=NOT_SURE_UR if language == "ur" else NOT_SURE_EN,
            lang=language,
            spoken_summary=(
                SPOKEN_ABSTENTION_UR if language == "ur" else SPOKEN_ABSTENTION_EN
            )
            if conversational
            else None,
        )

    chunks = retrieve(db, cleaned, program_id=program_id, top_k=top_k)
    top_score = chunks[0].hybrid_score if chunks else 0.0
    using_hash_embeddings = _is_fake_mode() or bool(chunks and chunks[0].used_hash_embeddings)
    threshold = ABSTAIN_THRESHOLD_FAKE if using_hash_embeddings else ABSTAIN_THRESHOLD_LIVE
    coverage = _corpus_coverage(cleaned)

    low_coverage = coverage < MIN_CORPUS_COVERAGE
    if not using_hash_embeddings and top_score >= threshold + 0.12:
        # Live dense embeddings handle Roman-Urdu/Sindhi/paraphrased queries whose surface tokens
        # may not appear verbatim in static markdown files.
        low_coverage = False

    if not chunks or top_score < threshold or low_coverage:
        # Zero LLM calls on abstention - the whole point of the gate. The spoken
        # abstention is a fixed sentence for the same reason.
        return RagAnswer(
            status="NOT_SURE",
            answer=NOT_SURE_UR if language == "ur" else NOT_SURE_EN,
            top_score=top_score,
            lang=language,
            retrieved=len(chunks),
            coverage=coverage,
            spoken_summary=(
                SPOKEN_ABSTENTION_UR if language == "ur" else SPOKEN_ABSTENTION_EN
            )
            if conversational
            else None,
        )

    answer, provider_name, model = _synthesize(
        db, cleaned, chunks, lang=language, tenant_id=tenant_id
    )

    filtered = guardrails.filter_personal_claims(answer, lang=language)
    if filtered.triggered:
        guardrails.record_guardrail_event(
            db,
            kind="rag_personal_claim",
            code="PERSONAL_ELIGIBILITY",
            resource_type="rag_answer",
            excerpt=answer,
        )
    answer_text = filtered.text or answer

    disclaimer = DISCLAIMER_UR if language == "ur" else DISCLAIMER_EN
    if disclaimer not in answer_text:
        answer_text = f"{answer_text}\n\n{disclaimer}"

    spoken = (
        _spoken_summary(
            db, answer=answer_text, chunks=chunks, lang=language, tenant_id=tenant_id
        )
        if conversational
        else None
    )

    return RagAnswer(
        status="ANSWERED",
        answer=answer_text,
        citations=[chunk.citation() for chunk in chunks],
        top_score=top_score,
        lang=language,
        provider=provider_name,
        model=model,
        guardrail_triggered=filtered.triggered,
        retrieved=len(chunks),
        coverage=coverage,
        spoken_summary=spoken,
    )


__all__ = [
    "ABSTAIN_THRESHOLD_FAKE",
    "ABSTAIN_THRESHOLD_LIVE",
    "MIN_CORPUS_COVERAGE",
    "CHUNK_MAX_TOKENS",
    "CHUNK_MIN_TOKENS",
    "CHUNK_OVERLAP_TOKENS",
    "DENSE_WEIGHT",
    "EMBEDDING_DIM",
    "LEXICAL_WEIGHT",
    "NOT_SURE_EN",
    "NOT_SURE_UR",
    "POLICY_DIR",
    "SPOKEN_ABSTENTION_EN",
    "SPOKEN_ABSTENTION_UR",
    "SPOKEN_SUMMARY_MAX_CHARS",
    "TOP_K",
    "PolicyDoc",
    "RagAnswer",
    "RetrievedChunk",
    "abstain_threshold",
    "ask",
    "chunk_markdown",
    "content_hash",
    "count_tokens",
    "index_document",
    "load_policy_docs",
    "parse_front_matter",
    "reindex_all",
    "reindex_program_rules",
    "render_rule_summary",
    "retrieve",
]
