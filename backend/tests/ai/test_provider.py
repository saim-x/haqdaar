"""AI provider acceptance tests (docs/07 §2).

The provider is the one place where the demo can fail in front of judges. These
tests pin the three promises that keep it safe: fake mode is deterministic and
fast, the circuit breaker degrades silently instead of raising, and every call
leaves a telemetry row.
"""

from __future__ import annotations

import time
from typing import Any

import pytest

from app.ai import provider as provider_module
from app.ai.provider import (
    CircuitBreaker,
    FakeDeterministicProvider,
    ProviderError,
    ResilientProvider,
    cosine,
    get_fake_provider,
    get_provider,
    provider_mode,
    reset_provider,
)


def _ensure_telemetry_table() -> None:
    """Create ``ai_telemetry`` in the stub metadata when A1 has not landed."""
    from app.db import Base
    from sqlalchemy import (
        Boolean,
        Column,
        DateTime,
        Float,
        Integer,
        String,
        Table,
    )

    if "ai_telemetry" in Base.metadata.tables:
        return
    Table(
        "ai_telemetry",
        Base.metadata,
        Column("id", String(36), primary_key=True),
        Column("tenant_id", String(36)),
        Column("task_type", String(32)),
        Column("provider", String(16)),
        Column("model_name", String(64)),
        Column("prompt_version", String(16)),
        Column("latency_ms", Integer),
        Column("input_tokens", Integer),
        Column("output_tokens", Integer),
        Column("estimated_cost_usd", Float),
        Column("succeeded", Boolean),
        Column("error_code", String(48)),
        Column("case_id", String(36)),
        Column("created_at", DateTime(timezone=True)),
    )


_ensure_telemetry_table()


# --------------------------------------------------------------------------- #
# mode selection
# --------------------------------------------------------------------------- #
class TestModeSelection:
    def test_fake_is_the_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("AI_PROVIDER", raising=False)
        assert provider_mode() == "fake"

    def test_live_mode_wraps_the_live_provider_in_the_breaker(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AI_PROVIDER", "live")
        reset_provider()
        try:
            assert isinstance(get_provider(), ResilientProvider)
        finally:
            reset_provider()

    def test_fake_mode_returns_the_fake_provider(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AI_PROVIDER", "fake")
        reset_provider()
        assert isinstance(get_provider(), FakeDeterministicProvider)

    def test_an_unknown_mode_falls_back_to_fake(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AI_PROVIDER", "banana")
        reset_provider()
        try:
            assert isinstance(get_provider(), FakeDeterministicProvider)
        finally:
            reset_provider()

    def test_the_provider_is_a_singleton(self) -> None:
        assert get_provider() is get_provider()
        assert get_fake_provider() is get_fake_provider()


# --------------------------------------------------------------------------- #
# fake determinism and speed
# --------------------------------------------------------------------------- #
class TestFakeDeterminism:
    def test_embeddings_are_deterministic_and_frozen_width(self) -> None:
        fake = get_fake_provider()
        first = fake.embed_texts(["widow grant"])[0]
        second = fake.embed_texts(["widow grant"])[0]
        assert first == second
        assert len(first) == provider_module.EMBEDDING_DIM == 64

    def test_embeddings_are_batch_consistent(self) -> None:
        fake = get_fake_provider()
        batch = fake.embed_texts(["widow grant", "guzara allowance"])
        assert batch[0] == fake.embed_texts(["widow grant"])[0]
        assert batch[1] == fake.embed_texts(["guzara allowance"])[0]

    def test_identical_text_embeds_identically(self) -> None:
        fake = get_fake_provider()
        assert fake.embed_texts(["same text"])[0] == fake.embed_texts(["same text"])[0]

    def test_different_text_embeds_differently(self) -> None:
        fake = get_fake_provider()
        a = fake.embed_texts(["widow grant"])[0]
        b = fake.embed_texts(["cricket world cup"])[0]
        assert a != b

    def test_an_unknown_word_produces_a_zero_vector(self) -> None:
        fake = get_fake_provider()
        vector = fake.embed_texts(["zzzqqq xxxyyy"])[0]
        assert all(value == 0.0 for value in vector), "unknown words must not fabricate similarity"

    def test_parse_is_deterministic(self) -> None:
        fake = get_fake_provider()
        first = fake.parse_structured_field("اٹھائیس ہزار", "monthly_income_pkr")
        second = fake.parse_structured_field("اٹھائیس ہزار", "monthly_income_pkr")
        assert first.value == second.value == 28_000
        assert first.confidence == second.confidence

    def test_tts_is_deterministic(self) -> None:
        fake = get_fake_provider()
        assert fake.synthesize_urdu_tts("سلام") == fake.synthesize_urdu_tts("سلام")

    def test_tts_returns_playable_wav(self) -> None:
        audio = get_fake_provider().synthesize_urdu_tts("سلام")
        assert audio[:4] == b"RIFF"
        assert audio[8:12] == b"WAVE"

    def test_fake_calls_are_fast(self) -> None:
        fake = get_fake_provider()
        started = time.perf_counter()
        for _ in range(20):
            fake.embed_texts(["widow grant monthly amount"])
        elapsed_ms = (time.perf_counter() - started) * 1000
        assert elapsed_ms < 400, f"20 fake embeddings took {elapsed_ms:.0f} ms"

    def test_ocr_of_an_unknown_image_is_unavailable_not_invented(self) -> None:
        result = get_fake_provider().ocr_document(b"not a real image", "CNIC_FRONT")
        assert result.available is False
        assert result.fields == {}, "OCR must never invent fields for an unknown image"


# --------------------------------------------------------------------------- #
# circuit breaker
# --------------------------------------------------------------------------- #
class TestCircuitBreaker:
    def test_opens_after_the_threshold(self) -> None:
        breaker = CircuitBreaker(threshold=3, cooldown_s=60)
        for _ in range(2):
            breaker.record_failure(ProviderError("boom", code="UPSTREAM_5XX"))
        assert not breaker.is_open
        breaker.record_failure(ProviderError("boom", code="UPSTREAM_5XX"))
        assert breaker.is_open

    def test_a_success_resets_the_counter(self) -> None:
        breaker = CircuitBreaker(threshold=3, cooldown_s=60)
        breaker.record_failure(ProviderError("boom", code="UPSTREAM_5XX"))
        breaker.record_failure(ProviderError("boom", code="UPSTREAM_5XX"))
        breaker.record_success()
        breaker.record_failure(ProviderError("boom", code="UPSTREAM_5XX"))
        assert not breaker.is_open

    def test_a_non_retryable_error_does_not_trip_it(self) -> None:
        breaker = CircuitBreaker(threshold=1, cooldown_s=60)
        breaker.record_failure(ProviderError("no key", code="NO_API_KEY", retryable=False))
        assert not breaker.is_open

    def test_it_closes_again_after_the_cooldown(self) -> None:
        breaker = CircuitBreaker(threshold=1, cooldown_s=0.01)
        breaker.record_failure(ProviderError("boom", code="UPSTREAM_5XX"))
        assert breaker.is_open
        time.sleep(0.02)
        assert not breaker.is_open

    def test_the_last_error_is_kept_for_diagnostics(self) -> None:
        breaker = CircuitBreaker(threshold=1)
        breaker.record_failure(ProviderError("boom", code="RATE_LIMITED"))
        assert breaker.last_error == "RATE_LIMITED"


class _FailingLive:
    """A live provider that always fails the way OpenAI fails."""

    name = "live"

    def __init__(self, code: str = "UPSTREAM_5XX") -> None:
        self.code = code
        self.calls = 0

    def _fail(self, *args: Any, **kwargs: Any) -> Any:
        self.calls += 1
        raise ProviderError(
            "upstream is down", code=self.code, retryable=self.code != "NO_API_KEY"
        )

    def transcribe_urdu(self, *args: Any, **kwargs: Any) -> Any:
        return self._fail()

    def parse_structured_field(self, *args: Any, **kwargs: Any) -> Any:
        return self._fail()

    def ocr_document(self, *args: Any, **kwargs: Any) -> Any:
        return self._fail()

    def embed_texts(self, *args: Any, **kwargs: Any) -> Any:
        return self._fail()

    def synthesize_urdu_tts(self, *args: Any, **kwargs: Any) -> Any:
        return self._fail()

    def rag_synthesize(self, *args: Any, **kwargs: Any) -> Any:
        return self._fail()


class TestResilientFallback:
    def test_a_failure_falls_back_to_fake_silently(self) -> None:
        live = _FailingLive()
        resilient = ResilientProvider(live, get_fake_provider(), CircuitBreaker(threshold=3))

        vector = resilient.embed_texts(["widow grant"])[0]
        assert len(vector) == 64
        assert resilient.fallback_count == 1

    def test_the_breaker_opens_and_stops_calling_live(self) -> None:
        live = _FailingLive()
        resilient = ResilientProvider(live, get_fake_provider(), CircuitBreaker(threshold=2))

        for _ in range(2):
            resilient.embed_texts(["widow grant"])
        assert resilient.breaker.is_open

        calls_before = live.calls
        resilient.embed_texts(["widow grant"])
        assert live.calls == calls_before, "an open breaker must not touch the network"

    def test_rate_limiting_trips_the_breaker(self) -> None:
        live = _FailingLive(code="RATE_LIMITED")
        resilient = ResilientProvider(live, get_fake_provider(), CircuitBreaker(threshold=1))
        resilient.embed_texts(["widow grant"])
        assert resilient.breaker.is_open

    def test_a_timeout_trips_the_breaker(self) -> None:
        live = _FailingLive(code="TIMEOUT")
        resilient = ResilientProvider(live, get_fake_provider(), CircuitBreaker(threshold=1))
        resilient.embed_texts(["widow grant"])
        assert resilient.breaker.is_open

    def test_a_missing_api_key_does_not_trip_the_breaker(self) -> None:
        live = _FailingLive(code="NO_API_KEY")
        resilient = ResilientProvider(live, get_fake_provider(), CircuitBreaker(threshold=1))
        resilient.embed_texts(["widow grant"])
        assert not resilient.breaker.is_open

    def test_an_unexpected_crash_still_falls_back(self) -> None:
        class Crashing(_FailingLive):
            def embed_texts(self, *args: Any, **kwargs: Any) -> Any:
                raise RuntimeError("something else entirely")

        resilient = ResilientProvider(Crashing(), get_fake_provider(), CircuitBreaker(threshold=3))
        assert len(resilient.embed_texts(["widow grant"])[0]) == 64

    def test_fallback_answers_are_still_deterministic(self) -> None:
        resilient = ResilientProvider(_FailingLive(), get_fake_provider(), CircuitBreaker(threshold=3))
        assert resilient.embed_texts(["widow grant"]) == resilient.embed_texts(["widow grant"])


# --------------------------------------------------------------------------- #
# telemetry
# --------------------------------------------------------------------------- #
class _TelemetrySession:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    def execute(self, statement: Any, params: Any = None) -> Any:
        if params and isinstance(params, list):
            self.rows.extend(params)
        return _Empty()

    def add(self, obj: Any) -> None:
        self.rows.append(obj)

    def flush(self) -> None:
        pass

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass


class _Empty:
    def all(self) -> list[Any]:
        return []

    def first(self) -> Any:
        return None

    def mappings(self) -> _Empty:
        return self

    def scalars(self) -> _Empty:
        return self

    def __iter__(self) -> Any:
        return iter(())


class TestTelemetry:
    def test_every_call_inside_the_context_is_recorded(self) -> None:
        db = _TelemetrySession()
        fake = get_fake_provider()
        with provider_module.telemetry(db, resource_type="voice"):
            fake.embed_texts(["widow grant"])
            fake.parse_structured_field("تین", "children_under_18")

        assert len(db.rows) >= 2
        task_types = {row["task_type"] for row in db.rows}
        assert "EMBEDDING" in task_types or "VOICE_PARSE" in task_types

    def test_a_call_outside_the_context_writes_nothing(self) -> None:
        db = _TelemetrySession()
        get_fake_provider().embed_texts(["widow grant"])
        assert db.rows == []

    def test_telemetry_rows_carry_the_frozen_columns(self) -> None:
        db = _TelemetrySession()
        with provider_module.telemetry(db, resource_type="rag"):
            get_fake_provider().embed_texts(["widow grant"])

        row = db.rows[0]
        for column in ("id", "task_type", "provider", "model_name", "prompt_version", "latency_ms"):
            assert column in row, column
        assert row["provider"] == "fake"

    def test_a_failed_telemetry_write_does_not_poison_the_transaction(self) -> None:
        """Regression: a missing ai_telemetry table once aborted the caller's txn."""

        class SavepointSession:
            def __init__(self) -> None:
                self.savepoints = 0
                self.rolled_back = 0
                self.usable = True

            def begin_nested(self) -> Any:
                self.savepoints += 1
                session = self

                class _Savepoint:
                    def __enter__(self) -> None:
                        return None

                    def __exit__(self, *exc: object) -> bool:
                        if exc[0] is not None:
                            session.rolled_back += 1
                            return True
                        return False

                return _Savepoint()

            def execute(self, statement: Any, params: Any = None) -> Any:
                if not self.usable:
                    raise RuntimeError("current transaction is aborted")
                raise RuntimeError('relation "ai_telemetry" does not exist')

            def add(self, obj: Any) -> None:
                pass

        db = SavepointSession()
        with provider_module.telemetry(db, resource_type="rag"):
            assert len(get_fake_provider().embed_texts(["widow grant"])[0]) == 64

        assert db.savepoints >= 1, "the write must be isolated in a savepoint"
        assert db.rolled_back >= 1, "the failed write must roll back to the savepoint"
        assert db.usable, "the caller's transaction must still be usable"

    def test_telemetry_never_raises(self) -> None:
        class Broken:
            def execute(self, *args: Any, **kwargs: Any) -> Any:
                raise RuntimeError("db is gone")

            def add(self, *args: Any, **kwargs: Any) -> Any:
                raise RuntimeError("db is gone")

        with provider_module.telemetry(Broken(), resource_type="rag"):
            assert len(get_fake_provider().embed_texts(["widow grant"])[0]) == 64


# --------------------------------------------------------------------------- #
# cosine
# --------------------------------------------------------------------------- #
class TestCosine:
    def test_identical_vectors_score_one(self) -> None:
        assert cosine([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)

    def test_orthogonal_vectors_score_zero(self) -> None:
        assert cosine([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)

    def test_a_zero_vector_scores_zero(self) -> None:
        assert cosine([0.0, 0.0], [1.0, 1.0]) == 0.0

    def test_mismatched_widths_score_zero(self) -> None:
        assert cosine([1.0, 0.0], [1.0, 0.0, 0.0]) == 0.0
