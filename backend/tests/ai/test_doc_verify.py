"""Document verification: the four-check pipeline and its honesty guarantees.

The judge-critical property is AC-04.4: a genuine card forwarded through WhatsApp
(JPEG re-compression, slight rotation, noise) must come back ``VERIFIED`` with a
**0% false-tamper rate**. ``TAMPER_SUSPECTED`` is reserved for a broken HMAC or a
clear semantic mismatch between a valid signed QR and legible printed text.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.ai import doc_verify

DATA_DIR = Path(__file__).resolve().parents[2] / "app" / "data"
EVAL_DIR = DATA_DIR / "doc_eval_set"
DEMO_DIR = DATA_DIR / "demo_docs"


def _manifest(directory: Path) -> dict:
    return json.loads((directory / "manifest.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def eval_images() -> list[dict]:
    manifest = _manifest(EVAL_DIR)
    return manifest["images"]


class TestEvalSetAccuracy:
    def test_every_image_gets_its_expected_verdict(self, eval_images: list[dict]) -> None:
        wrong: list[tuple[str, str, str]] = []
        for entry in eval_images:
            payload = (EVAL_DIR / entry["file"]).read_bytes()
            result = doc_verify.verify_image(payload, entry["doc_type"])
            if result.status != entry["expected_verdict"]:
                wrong.append((entry["file"], entry["expected_verdict"], result.status))
        assert not wrong, wrong

    def test_false_tamper_rate_is_zero(self, eval_images: list[dict]) -> None:
        genuine = [e for e in eval_images if e["label"].startswith("GENUINE")]
        assert genuine
        false_tamper = [
            entry["file"]
            for entry in genuine
            if doc_verify.verify_image(
                (EVAL_DIR / entry["file"]).read_bytes(), entry["doc_type"]
            ).status
            == "TAMPER_SUSPECTED"
        ]
        assert false_tamper == []

    def test_compressed_genuine_cards_are_verified(self, eval_images: list[dict]) -> None:
        compressed = [e for e in eval_images if e["label"] == "GENUINE_COMPRESSED"]
        assert len(compressed) >= 8
        for entry in compressed:
            result = doc_verify.verify_image(
                (EVAL_DIR / entry["file"]).read_bytes(), entry["doc_type"]
            )
            assert result.status == "VERIFIED", entry["file"]

    def test_blurry_images_ask_for_a_retake_not_a_tamper_verdict(
        self, eval_images: list[dict]
    ) -> None:
        blurry = [e for e in eval_images if e["label"] == "BLURRY"]
        assert len(blurry) >= 5
        for entry in blurry:
            result = doc_verify.verify_image(
                (EVAL_DIR / entry["file"]).read_bytes(), entry["doc_type"]
            )
            assert result.status == "NEEDS_RETAKE", entry["file"]
            assert result.retake_reason_ur
            assert result.retake_reason_en

    def test_forged_images_are_caught(self, eval_images: list[dict]) -> None:
        forged = [e for e in eval_images if e["label"] == "FORGED"]
        assert len(forged) >= 5
        for entry in forged:
            result = doc_verify.verify_image(
                (EVAL_DIR / entry["file"]).read_bytes(), entry["doc_type"]
            )
            assert result.status == "TAMPER_SUSPECTED", entry["file"]


class TestDemoDocuments:
    def test_genuine_demo_card_is_verified(self) -> None:
        payload = (DEMO_DIR / "fatima_cnic_genuine.jpg").read_bytes()
        assert doc_verify.verify_image(payload).status == "VERIFIED"

    def test_whatsapp_compressed_card_is_verified(self) -> None:
        payload = (DEMO_DIR / "fatima_cnic_whatsapp_compressed.jpg").read_bytes()
        assert doc_verify.verify_image(payload).status == "VERIFIED"

    def test_blurry_card_needs_a_retake(self) -> None:
        payload = (DEMO_DIR / "fatima_cnic_blurry.jpg").read_bytes()
        result = doc_verify.verify_image(payload)
        assert result.status == "NEEDS_RETAKE"
        assert "تصویر" in result.retake_reason_ur

    def test_forged_name_is_tamper_suspected(self) -> None:
        payload = (DEMO_DIR / "fatima_cnic_forged_name.jpg").read_bytes()
        result = doc_verify.verify_image(payload)
        assert result.status == "TAMPER_SUSPECTED"
        cross = next(c for c in result.checks if c.check == "ocr_vs_qr")
        assert not cross.passed

    def test_missing_qr_is_unverifiable_never_tamper(self) -> None:
        payload = (DEMO_DIR / "fatima_cnic_no_qr.jpg").read_bytes()
        result = doc_verify.verify_image(payload)
        assert result.status == "UNVERIFIABLE"
        assert result.status != "TAMPER_SUSPECTED"

    def test_death_certificate_is_verified(self) -> None:
        payload = (DEMO_DIR / "ghulam_rasool_death_cert_genuine.jpg").read_bytes()
        assert doc_verify.verify_image(payload, "SPOUSE_DEATH_CERTIFICATE").status == "VERIFIED"


class TestQualityGate:
    def test_tiny_image_needs_a_retake(self) -> None:
        import cv2
        import numpy as np

        small = np.full((200, 200, 3), 255, dtype=np.uint8)
        ok, encoded = cv2.imencode(".jpg", small)
        assert ok
        result = doc_verify.verify_image(encoded.tobytes())
        assert result.status == "NEEDS_RETAKE"

    def test_undecodable_bytes_never_produce_a_tamper_verdict(self) -> None:
        result = doc_verify.verify_image(b"not an image at all")
        assert result.status in {"UNVERIFIABLE", "NEEDS_RETAKE"}
        assert result.status != "TAMPER_SUSPECTED"

    def test_blank_image_is_not_a_tamper_verdict(self) -> None:
        import cv2
        import numpy as np

        blank = np.full((600, 900, 3), 240, dtype=np.uint8)
        ok, encoded = cv2.imencode(".jpg", blank)
        assert ok
        result = doc_verify.verify_image(encoded.tobytes())
        assert result.status in {"NEEDS_RETAKE", "UNVERIFIABLE"}
        assert result.status != "TAMPER_SUSPECTED"


class TestNameSimilarity:
    @pytest.mark.parametrize(
        ("left", "right", "minimum"),
        [
            ("Fatima Bibi", "Fatima Bibi", 0.99),
            ("Mst. Fatima Bibi", "Fatima Bibi", 0.99),
            ("Fatma Bibi", "Fatima Bibi", 0.80),
            ("Muhammad Akram", "Mohammad Akram", 0.80),
        ],
    )
    def test_variants_stay_above_the_threshold(
        self, left: str, right: str, minimum: float
    ) -> None:
        assert doc_verify.name_similarity(left, right) >= minimum

    @pytest.mark.parametrize(
        ("left", "right"),
        [
            ("Zainab Bibi", "Sakina Bibi"),
            ("Fatima Bibi", "Ghulam Rasool"),
        ],
    )
    def test_different_people_fall_below_the_threshold(self, left: str, right: str) -> None:
        assert doc_verify.name_similarity(left, right) < 0.80

    def test_shared_surname_cannot_mask_a_different_given_name(self) -> None:
        """The demo cast all share 'Bibi'; the given name must still decide."""
        assert doc_verify.name_similarity("Zainab Bibi", "Sakina Bibi") < 0.80


class TestVerifyDocumentWiring:
    def test_missing_document_raises(self, db) -> None:
        with pytest.raises(Exception):
            doc_verify.verify_document(db, "00000000-0000-0000-0000-000000000000")
