"""Benchmark numbers for the evaluation dashboard (docs/07 §8).

``scam_metrics()`` and ``doc_metrics()`` return exactly the dict shapes the
dashboard contract specifies, so EN's ``GET /api/v1/eval/dashboard`` can splice
them in without translation. Every number is measured, never asserted: the scam
figures come from the held-out split of the committed dataset and the document
figures from running the real verifier over ``app/data/doc_eval_set/``.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from app.ai import doc_verify, scam_classifier

logger = logging.getLogger("haqdaar.ai.benchmarks")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DOC_EVAL_DIR = DATA_DIR / "doc_eval_set"
DOC_EVAL_MANIFEST = DOC_EVAL_DIR / "manifest.json"


# --------------------------------------------------------------------------- #
# scam classifier
# --------------------------------------------------------------------------- #
def _scam_check_counts(db: Any) -> tuple[int, int]:
    """Live check count and user-disputed count from ``scam_checks``."""
    if db is None:
        return 0, 0
    try:
        from sqlalchemy import func, select

        from app.db import Base  # type: ignore

        table = Base.metadata.tables.get("scam_checks")
        if table is None:
            return 0, 0
        total = db.execute(select(func.count()).select_from(table)).scalar_one()
        disputed = db.execute(
            select(func.count()).select_from(table).where(table.c.user_disputed.is_(True))
        ).scalar_one()
        return int(total), int(disputed)
    except Exception as exc:  # pragma: no cover
        logger.warning("scam_checks counts unavailable: %s", exc)
        return 0, 0


def scam_metrics(db: Any = None) -> dict[str, Any]:
    """``{test_size, precision, recall, f1, false_positive_rate,
    hard_negative_fpr, confusion_matrix, live_checks_count, user_disputed_count}``."""
    try:
        measured = scam_classifier.metrics()
    except Exception as exc:  # pragma: no cover - dataset or sklearn missing
        logger.warning("scam metrics unavailable: %s", exc)
        measured = {
            "test_size": 0,
            "precision": 0.0,
            "recall": 0.0,
            "f1": 0.0,
            "false_positive_rate": 0.0,
            "hard_negative_fpr": 0.0,
            "confusion_matrix": [[0, 0], [0, 0]],
        }

    live_checks, disputed = _scam_check_counts(db)
    return {
        "test_size": measured["test_size"],
        "precision": measured["precision"],
        "recall": measured["recall"],
        "f1": measured["f1"],
        "false_positive_rate": measured["false_positive_rate"],
        "hard_negative_fpr": measured["hard_negative_fpr"],
        "confusion_matrix": measured["confusion_matrix"],
        "live_checks_count": live_checks,
        "user_disputed_count": disputed,
    }


# --------------------------------------------------------------------------- #
# document verifier
# --------------------------------------------------------------------------- #
def _load_doc_manifest() -> dict[str, Any]:
    if not DOC_EVAL_MANIFEST.exists():
        return {}
    try:
        return json.loads(DOC_EVAL_MANIFEST.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover
        logger.warning("doc eval manifest unreadable: %s", exc)
        return {}


def doc_metrics() -> dict[str, Any]:
    """``{test_size, genuine_verified_rate, tampered_caught_rate,
    false_tamper_rate, blurry_retake_rate}`` measured on the 30-image eval set."""
    manifest = _load_doc_manifest()
    images = manifest.get("images") or []
    if not images:
        return {
            "test_size": 0,
            "genuine_verified_rate": 0.0,
            "tampered_caught_rate": 0.0,
            "false_tamper_rate": 0.0,
            "blurry_retake_rate": 0.0,
        }

    genuine_total = genuine_verified = 0
    forged_total = forged_caught = 0
    false_tamper = 0
    blurry_total = blurry_retake = 0

    for entry in images:
        path = DOC_EVAL_DIR / entry["file"]
        if not path.exists():  # pragma: no cover
            continue
        try:
            verification = doc_verify.verify_image(path.read_bytes(), entry.get("doc_type", "CNIC_FRONT"))
        except Exception as exc:  # pragma: no cover
            logger.warning("doc eval failed for %s: %s", entry["file"], exc)
            continue

        label = entry.get("label")
        if label in {"GENUINE_CLEAN", "GENUINE_COMPRESSED"}:
            genuine_total += 1
            if verification.status == doc_verify.VERIFIED:
                genuine_verified += 1
            if verification.status == doc_verify.TAMPER_SUSPECTED:
                false_tamper += 1
        elif label == "FORGED":
            forged_total += 1
            if verification.status == doc_verify.TAMPER_SUSPECTED:
                forged_caught += 1
        elif label == "BLURRY":
            blurry_total += 1
            if verification.status == doc_verify.NEEDS_RETAKE:
                blurry_retake += 1

    def rate(numerator: int, denominator: int) -> float:
        return round(numerator / denominator, 4) if denominator else 0.0

    return {
        "test_size": len(images),
        "genuine_verified_rate": rate(genuine_verified, genuine_total),
        "tampered_caught_rate": rate(forged_caught, forged_total),
        "false_tamper_rate": rate(false_tamper, genuine_total),
        "blurry_retake_rate": rate(blurry_retake, blurry_total),
    }


def all_metrics(db: Any = None) -> dict[str, Any]:
    """Both blocks, ready for the dashboard endpoint."""
    return {"scam_classifier": scam_metrics(db), "document_verifier": doc_metrics()}


__all__ = ["all_metrics", "doc_metrics", "scam_metrics"]
