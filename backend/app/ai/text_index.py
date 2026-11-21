"""Deterministic text index shared by the fake provider and the RAG retriever.

Two jobs, both pure Python and both reproducible byte-for-byte:

1. **Markdown chunking** — heading-aware slices of ~300–450 tokens with a
   50-token overlap (docs/07 §4.2).
2. **Hashed TF-IDF embeddings** — a 64-dimension vector (docs/04 §4.5) built from
   the policy corpus's own inverse document frequencies.

Why TF-IDF and not a plain hash: a raw bag-of-words hash at 64 dimensions is
noise-dominated, so an out-of-domain question ("what is the capital of France")
scores as high as a real one. Weighting each term by its corpus IDF and dropping
stopwords fixes that — a question whose content words never appear in the corpus
produces a zero vector, and therefore a zero cosine against every chunk. That is
what makes the abstention gate in ``rag.py`` mean something in fake mode.

This module imports nothing from ``provider`` or ``rag`` so both can use it
without a cycle.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
POLICY_DIR = DATA_DIR / "policy_docs"

#: docs/04 §4.5 — 64 dims in fake mode, 1536 in live mode.
FAKE_EMBEDDING_DIM = 64

#: Chunking. A chunk is one policy section, because a section is the unit a
#: citation names and the unit a reader can act on.
#:
#: ``CHUNK_MIN_TOKENS`` used to be 300, which merged two or three sections into
#: every chunk: the chunk titled "3. Required Documents" also carried the tail of
#: the eligibility list and the whole payout section. Retrieval still worked, but
#: the heading stopped describing the content, so an answer could be cited to a
#: section it never came from. 60 keeps a real section whole and still folds a
#: one-line heading into its neighbour.
CHUNK_MIN_TOKENS = 60
CHUNK_MAX_TOKENS = 450

#: No overlap between chunks. Overlap is a recall trick for a retriever that
#: quotes sentences: it lets a match that straddles a boundary be found twice.
#: Here it did the opposite. Every chunk began with the last 50 tokens of the
#: previous one, so the chunk titled "3. Required Documents" opened with the tail
#: of the eligibility list in Urdu — the heading no longer described the content,
#: and an extractive answer quoted the neighbour's text under this section's
#: citation. A section is the unit a citation names, so a section is the unit a
#: chunk holds.
CHUNK_OVERLAP_TOKENS = 0

#: English and Urdu function words. They appear in every chunk, so they carry no
#: topical signal and would otherwise dominate a 64-dimension vector.
STOPWORDS: frozenset[str] = frozenset(
    ["a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "doing", "have", "has", "had", "having", "i", "me", "my", "we", "our", "you", "your", "he", "him", "his", "she", "her", "it", "its", "they", "them", "their", "this", "that", "these", "those", "of", "in", "on", "at", "to", "for", "from", "by", "with", "about", "into", "over", "under", "after", "before", "above", "and", "or", "but", "if", "then", "than", "so", "as", "not", "no", "nor", "can", "could", "will", "would", "shall", "should", "may", "might", "must", "what", "which", "who", "whom", "whose", "when", "where", "why", "how", "there", "here", "also", "very", "just", "only", "more", "most", "some", "any", "all", "each", "both", "few", "many", "much", "other", "another", "such", "own", "same", "too", "don", "now", "s", "t"]
) | frozenset(
    ["آپ", "ہم", "میں", "کی", "کا", "کے", "کو", "سے", "نے", "ہے", "ہیں", "ہو", "گا", "گی", "تھا", "تھی", "تھے", "اور", "یا", "لیکن", "اگر", "تو", "بھی", "نہیں", "نہ", "کر", "کریں", "کرنا", "کرتی", "کرتا", "کیا", "کون", "کب", "کہاں", "کیوں", "کیسے", "یہ", "وہ", "اس", "ان", "جن", "جس", "جو", "پر", "تک", "لیے", "ساتھ", "بعد", "پہلے", "اب", "یہاں", "وہاں", "بہت", "سب", "کچھ", "کوئی", "ہوا", "ہوئی", "ہوئے", "جاتا", "جاتی", "جاتے", "رہا", "رہی", "رہے", "دیا", "دی", "گئی", "گیا", "کرنے", "والا", "والی", "والے"]
)

_WORD_RE = re.compile(r"[^\s]+")
_TOKEN_RE = re.compile(r"[\w\u0600-\u06ff]+")


# --------------------------------------------------------------------------- #
# tokenisation
# --------------------------------------------------------------------------- #
def count_tokens(text: str) -> int:
    """Whitespace token count — good enough for Urdu and English alike."""
    return len(_WORD_RE.findall(text or ""))


def tokenize(text: str) -> list[str]:
    """Lowercase content words: no stopwords, no single characters."""
    from app.ai import urdu_nlp

    normalized = urdu_nlp.normalize_text(text or "").lower()
    return [
        word
        for word in _TOKEN_RE.findall(normalized)
        if len(word) > 1 and word not in STOPWORDS
    ]


# --------------------------------------------------------------------------- #
# markdown front matter + chunking
# --------------------------------------------------------------------------- #
def parse_front_matter(text: str) -> tuple[dict[str, Any], str]:
    """Split a ``---`` delimited metadata block from the Markdown body."""
    raw = (text or "").lstrip("\ufeff")
    if not raw.startswith("---"):
        return {}, raw

    end = raw.find("\n---", 3)
    if end == -1:
        return {}, raw

    block = raw[3:end].strip("\n")
    body = raw[end + 4 :].lstrip("\n")

    meta: dict[str, Any] = {}
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        cleaned = value.strip().strip('"').strip("'")
        if cleaned.lower() in {"null", "none", "~", ""}:
            meta[key.strip()] = None
        else:
            meta[key.strip()] = cleaned
    return meta, body


def split_sections(body: str) -> list[tuple[str, str]]:
    """Split Markdown into ``(heading, text)`` pairs on level-2 headings."""
    sections: list[tuple[str, str]] = []
    heading = "Overview"
    buffer: list[str] = []

    for line in body.splitlines():
        if line.startswith("## "):
            if buffer:
                sections.append((heading, "\n".join(buffer).strip()))
            heading = line[3:].strip()
            buffer = []
        elif line.startswith("# "):
            continue
        else:
            buffer.append(line)

    if buffer:
        sections.append((heading, "\n".join(buffer).strip()))
    return [(h, t) for h, t in sections if t]


def _paragraphs(text: str) -> list[str]:
    blocks = [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]
    return blocks or ([text.strip()] if text.strip() else [])


def _tail_tokens(text: str, count: int) -> str:
    words = _WORD_RE.findall(text)
    if len(words) <= count:
        return text
    return " ".join(words[-count:])


def _split_long(text: str, max_tokens: int) -> list[str]:
    """Split an over-long section on paragraph boundaries."""
    if count_tokens(text) <= max_tokens:
        return [text]

    pieces: list[str] = []
    buffer: list[str] = []
    size = 0

    for paragraph in _paragraphs(text):
        tokens = count_tokens(paragraph)
        if buffer and size + tokens > max_tokens:
            pieces.append("\n\n".join(buffer))
            buffer = []
            size = 0
        if tokens > max_tokens:
            words = _WORD_RE.findall(paragraph)
            for start in range(0, len(words), max_tokens):
                pieces.append(" ".join(words[start : start + max_tokens]))
            continue
        buffer.append(paragraph)
        size += tokens

    if buffer:
        pieces.append("\n\n".join(buffer))
    return [piece for piece in pieces if piece.strip()]


@dataclass
class Chunk:
    """One heading-aware slice of a policy document."""

    section_heading: str
    chunk_index: int
    content: str
    token_count: int = 0

    def __post_init__(self) -> None:
        if not self.token_count:
            self.token_count = count_tokens(self.content)


def chunk_markdown(
    body: str,
    *,
    min_tokens: int = CHUNK_MIN_TOKENS,
    max_tokens: int = CHUNK_MAX_TOKENS,
    overlap_tokens: int = CHUNK_OVERLAP_TOKENS,
) -> list[Chunk]:
    """Heading-aware chunking with a token overlap between consecutive chunks.

    A section shorter than ``min_tokens`` is merged with the next section so a
    one-line heading never becomes its own useless chunk. A section longer than
    ``max_tokens`` is split on paragraph boundaries.
    """
    sections = split_sections(body)
    if not sections:
        return []

    chunks: list[Chunk] = []
    pending_heading: str | None = None
    pending_text: list[str] = []
    pending_tokens = 0

    def flush(heading: str, text: str) -> None:
        for piece in _split_long(text, max_tokens):
            chunks.append(
                Chunk(section_heading=heading, chunk_index=len(chunks), content=piece)
            )

    for heading, text in sections:
        tokens = count_tokens(text)
        if pending_heading is None:
            pending_heading = heading
            pending_text = [text]
            pending_tokens = tokens
        elif pending_tokens < min_tokens:
            pending_text.append(text)
            pending_tokens += tokens
        else:
            flush(pending_heading, "\n\n".join(pending_text))
            pending_heading = heading
            pending_text = [text]
            pending_tokens = tokens

        if pending_tokens >= min_tokens:
            flush(pending_heading, "\n\n".join(pending_text))
            pending_heading = None
            pending_text = []
            pending_tokens = 0

    if pending_heading is not None and pending_text:
        flush(pending_heading, "\n\n".join(pending_text))

    if overlap_tokens > 0 and len(chunks) > 1:
        for index in range(1, len(chunks)):
            tail = _tail_tokens(chunks[index - 1].content, overlap_tokens)
            if tail and not chunks[index].content.startswith(tail):
                chunks[index].content = f"{tail}\n\n{chunks[index].content}"
                chunks[index].token_count = count_tokens(chunks[index].content)

    return chunks


# --------------------------------------------------------------------------- #
# corpus + IDF
# --------------------------------------------------------------------------- #
@dataclass
class CorpusStats:
    document_frequency: Counter = field(default_factory=Counter)
    chunk_count: int = 0

    def idf(self, word: str) -> float:
        """Smoothed IDF. A word absent from the corpus scores 0, not infinity.

        Zero is deliberate: an unknown word is no evidence of topical relevance,
        and giving it a large weight is what makes naive hash embeddings match
        everything.
        """
        frequency = self.document_frequency.get(word, 0)
        if frequency == 0:
            return 0.0
        return math.log((self.chunk_count + 1) / (frequency + 1)) + 1.0


@lru_cache(maxsize=1)
def corpus_stats() -> CorpusStats:
    """IDF over the policy chunks. Cached; call ``corpus_stats.cache_clear()``."""
    stats = CorpusStats()
    for _heading, content in corpus_chunks():
        stats.chunk_count += 1
        stats.document_frequency.update(set(tokenize(content)))
    return stats


@lru_cache(maxsize=1)
def corpus_chunks() -> tuple[tuple[str, str], ...]:
    """``(heading, content)`` for every chunk of every policy document."""
    if not POLICY_DIR.exists():
        return ()
    chunks: list[tuple[str, str]] = []
    for path in sorted(POLICY_DIR.glob("*.md")):
        try:
            raw = path.read_text(encoding="utf-8")
        except Exception:  # pragma: no cover
            continue
        _meta, body = parse_front_matter(raw)
        for chunk in chunk_markdown(body):
            chunks.append((chunk.section_heading, chunk.content))
    return tuple(chunks)


# --------------------------------------------------------------------------- #
# hashed TF-IDF
# --------------------------------------------------------------------------- #
def hash_tfidf(text: str, dim: int = FAKE_EMBEDDING_DIM) -> list[float]:
    """Deterministic ``dim``-dimensional TF-IDF vector, L2-normalised.

    Each content word is hashed into one bucket and weighted by its corpus IDF.
    No random signs: a sign flip would let two different words cancel out, which
    is exactly the noise that destroys separation at 64 dimensions.
    """
    vector = [0.0] * dim
    stats = corpus_stats()

    for word in tokenize(text):
        weight = stats.idf(word)
        if weight <= 0.0:
            continue
        digest = hashlib.blake2b(word.encode("utf-8"), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "big") % dim
        vector[index] += weight

    norm = math.sqrt(sum(value * value for value in vector))
    if norm <= 0.0:
        return vector
    return [value / norm for value in vector]


def reset_corpus_cache() -> None:
    """Drop the cached corpus and IDF table (used by tests and reindexing)."""
    corpus_chunks.cache_clear()
    corpus_stats.cache_clear()


__all__ = [
    "CHUNK_MAX_TOKENS",
    "CHUNK_MIN_TOKENS",
    "CHUNK_OVERLAP_TOKENS",
    "DATA_DIR",
    "FAKE_EMBEDDING_DIM",
    "POLICY_DIR",
    "STOPWORDS",
    "Chunk",
    "CorpusStats",
    "chunk_markdown",
    "corpus_chunks",
    "corpus_stats",
    "count_tokens",
    "hash_tfidf",
    "parse_front_matter",
    "reset_corpus_cache",
    "split_sections",
    "tokenize",
]
