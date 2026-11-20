"""Benchmark contract tests (docs/07 §8).

EN's eval dashboard reads these dicts directly. A renamed key or a missing field
breaks the dashboard silently, so the shapes are pinned here exactly.
"""

from __future__ import annotations

from typing import Any

from app.ai import benchmarks

SCAM_KEYS = {
    "test_size",
    "precision",
    "recall",
    "f1",
    "false_positive_rate",
    "hard_negative_fpr",
    "confusion_matrix",
    "live_checks_count",
    "user_disputed_count",
}

DOC_KEYS = {
    "test_size",
    "genuine_verified_rate",
    "tampered_caught_rate",
    "false_tamper_rate",
    "blurry_retake_rate",
}


def _ensure_scam_checks_table() -> None:
    """Create ``scam_checks`` in the stub metadata when A1 has not landed."""
    from app.db import Base
    from sqlalchemy import Boolean, Column, String, Table, Text

    if "scam_checks" in Base.metadata.tables:
        return
    Table(
        "scam_checks",
        Base.metadata,
        Column("id", String(36), primary_key=True),
        Column("tenant_id", String(36)),
        Column("input_text", Text),
        Column("verdict", String(24)),
        Column("user_disputed", Boolean),
    )


_ensure_scam_checks_table()


class _CountSession:
    """Returns the two count rows ``_scam_check_counts`` asks for."""

    def __init__(self, total: int = 0, disputed: int = 0) -> None:
        self.total = total
        self.disputed = disputed

    def execute(self, statement: Any, params: Any = None) -> Any:
        sql = str(statement)
        value = self.disputed if "disputed" in sql.lower() else self.total
        return _Row(value)


class _Row:
    def __init__(self, value: int) -> None:
        self.value = value

    def scalar(self) -> int:
        return self.value

    def scalar_one(self) -> int:
        return self.value

    def first(self) -> Any:
        return (self.value,)

    def all(self) -> list[Any]:
        return [(self.value,)]

    def mappings(self) -> _Row:
        return self

    def __iter__(self) -> Any:
        return iter([(self.value,)])


# --------------------------------------------------------------------------- #
# scam metrics
# --------------------------------------------------------------------------- #
class TestScamMetrics:
    def test_shape_is_frozen(self) -> None:
        assert set(benchmarks.scam_metrics()) == SCAM_KEYS

    def test_rates_are_probabilities(self) -> None:
        metrics = benchmarks.scam_metrics()
        for key in ("precision", "recall", "f1", "false_positive_rate", "hard_negative_fpr"):
            assert 0.0 <= metrics[key] <= 1.0, key

    def test_confusion_matrix_is_two_by_two(self) -> None:
        matrix = benchmarks.scam_metrics()["confusion_matrix"]
        assert len(matrix) == 2
        assert all(len(row) == 2 for row in matrix)
        assert all(isinstance(value, int) for row in matrix for value in row)

    def test_the_held_out_set_is_large_enough_to_mean_something(self) -> None:
        assert benchmarks.scam_metrics()["test_size"] >= 40

    def test_quality_clears_the_demo_bar(self) -> None:
        metrics = benchmarks.scam_metrics()
        assert metrics["f1"] >= 0.80
        assert metrics["hard_negative_fpr"] <= 0.10, "hard negatives are the false-positive budget"

    def test_live_counts_default_to_zero_without_a_database(self) -> None:
        metrics = benchmarks.scam_metrics()
        assert metrics["live_checks_count"] == 0
        assert metrics["user_disputed_count"] == 0

    def test_live_counts_are_read_from_the_database(self) -> None:
        metrics = benchmarks.scam_metrics(_CountSession(total=17, disputed=3))
        assert metrics["live_checks_count"] == 17
        assert metrics["user_disputed_count"] == 3

    def test_a_broken_database_does_not_break_the_dashboard(self) -> None:
        class Broken:
            def execute(self, *args: Any, **kwargs: Any) -> Any:
                raise RuntimeError("db is gone")

        metrics = benchmarks.scam_metrics(Broken())
        assert set(metrics) == SCAM_KEYS
        assert metrics["live_checks_count"] == 0


# --------------------------------------------------------------------------- #
# document metrics
# --------------------------------------------------------------------------- #
class TestDocMetrics:
    def test_shape_is_frozen(self) -> None:
        assert set(benchmarks.doc_metrics()) == DOC_KEYS

    def test_the_eval_set_is_thirty_images(self) -> None:
        assert benchmarks.doc_metrics()["test_size"] == 30

    def test_rates_are_probabilities(self) -> None:
        metrics = benchmarks.doc_metrics()
        for key in ("genuine_verified_rate", "tampered_caught_rate", "false_tamper_rate", "blurry_retake_rate"):
            assert 0.0 <= metrics[key] <= 1.0, key

    def test_ac_04_4_compressed_genuine_documents_are_never_called_tampered(self) -> None:
        metrics = benchmarks.doc_metrics()
        assert metrics["false_tamper_rate"] == 0.0, "a WhatsApp-compressed genuine card must never be tampered"
        assert metrics["genuine_verified_rate"] == 1.0

    def test_forgery_is_caught(self) -> None:
        assert benchmarks.doc_metrics()["tampered_caught_rate"] == 1.0

    def test_blur_asks_for_a_retake(self) -> None:
        assert benchmarks.doc_metrics()["blurry_retake_rate"] == 1.0


# --------------------------------------------------------------------------- #
# combined payload
# --------------------------------------------------------------------------- #
class TestAllMetrics:
    def test_combined_payload_has_both_blocks(self) -> None:
        payload = benchmarks.all_metrics()
        assert set(payload) == {"scam_classifier", "document_verifier"}
        assert set(payload["scam_classifier"]) == SCAM_KEYS
        assert set(payload["document_verifier"]) == DOC_KEYS

    def test_combined_payload_is_json_serialisable(self) -> None:
        import json

        json.dumps(benchmarks.all_metrics())

    def test_metrics_are_stable_across_calls(self) -> None:
        assert benchmarks.doc_metrics() == benchmarks.doc_metrics()
        assert benchmarks.scam_metrics() == benchmarks.scam_metrics()
