"""Regression tests for rubric-maximization security, AI, and resilience fixes.

Pure Python (no DB required) so they run cleanly in both fast local gates and CI.
"""

from __future__ import annotations

import hashlib

import httpx
import pytest

from app.agent.assemble import DocumentRow, _document_checks
from app.agent.mock_client import ExternalServiceUnavailable, MockClient
from app.ai import benchmarks, guardrails, scam_classifier, urdu_nlp
from app.ai.scam_classifier import NotificationRecord
from app.engine.anomalies import FlagCode, FlagSeverity, detect_tamper_suspected


class TestTamperPropagation:
    def test_ocr_vs_qr_mismatch_raises_high_tamper_flag(self) -> None:
        row = DocumentRow(
            doc_type="CNIC_FRONT",
            verify_status="TAMPER_SUSPECTED",
            verify_confidence=0.15,
            extracted_fields={"cnic": "9990010000012", "name": "Tampered Name"},
            verify_checks=(
                {"check": "qr_signature", "passed": True, "value": "valid"},
                {
                    "check": "ocr_vs_qr",
                    "passed": False,
                    "value": {"cnic_match": True, "name_similarity": 0.42},
                },
            ),
        )
        checks = _document_checks([row])
        assert len(checks) == 1
        assert checks[0].qr_signature_valid is True
        assert checks[0].ocr_qr_cnic_match is True
        assert checks[0].ocr_qr_name_match is False

        flag = detect_tamper_suspected(checks)
        assert flag is not None
        assert flag.code is FlagCode.TAMPER_SUSPECTED
        assert flag.severity is FlagSeverity.HIGH


class TestGuardrailsVerificationCodePreservation:
    def test_hq_numeric_verification_code_preserved_while_otp_redacted(self) -> None:
        text = "Your grant code is HQ-482910. Never share OTP 482910 or CNIC 99900-1000001-2."
        redacted = guardrails.redact_for_llm(text)
        assert "HQ-482910" in redacted
        assert "99900-1000001-2" not in redacted
        assert "OTP 482910" not in redacted


class TestMockClientMalformedJsonResilience:
    def test_malformed_json_retries_and_raises_unavailable(self) -> None:
        calls = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(200, text="<html>502 Bad Gateway</html>")

        transport = httpx.MockTransport(handler)
        with MockClient(
            base_url="http://mock.local",
            transport=transport,
            sleep=lambda _s: None,
        ) as client:
            with pytest.raises(ExternalServiceUnavailable) as exc_info:
                client.get("identity", "/v1/identity/lookup")

        assert calls == 3
        assert exc_info.value.service == "identity"
        assert "Invalid JSON" in exc_info.value.detail


class TestScamClassifierUpgrades:
    def test_body_matches_rejects_numeric_tampering(self) -> None:
        official_en = "Your Sahara grant of Rs 15,000 is ready. Code HQ-AB12C."
        official_ur = "آپ کی سہارا امداد 15,000 روپے تیار ہے۔ کوڈ HQ-AB12C۔"
        record = NotificationRecord(
            id="notif-1",
            verification_code="HQ-AB12C",
            body_sha256=hashlib.sha256(official_en.encode("utf-8")).hexdigest(),
            body_en=official_en,
            body_ur=official_ur,
        )

        assert scam_classifier._body_matches(official_en, record) is True
        tampered = "Your Sahara grant of Rs 25,000 is ready. Code HQ-AB12C."
        assert scam_classifier._body_matches(tampered, record) is False

    def test_scam_benchmark_exceeds_high_precision_bar(self) -> None:
        scam_classifier.reset_model()
        metrics = benchmarks.scam_metrics()
        assert metrics["f1"] >= 0.94
        assert metrics["precision"] >= 0.94
        assert metrics["recall"] >= 0.94
        assert metrics["false_positive_rate"] <= 0.05
        assert metrics["hard_negative_fpr"] == 0.0

    def test_doc_metrics_deterministic_without_live_calls(self) -> None:
        metrics = benchmarks.doc_metrics()
        assert metrics["genuine_verified_rate"] == 1.0
        assert metrics["tampered_caught_rate"] == 1.0
        assert metrics["false_tamper_rate"] == 0.0
        assert metrics["blurry_retake_rate"] == 1.0


class TestDistrictNormalization:
    def test_mirpur_khas_normalizes_to_canonical_district(self) -> None:
        assert urdu_nlp.parse_district("Mirpur Khas") == "Mirpurkhas"
