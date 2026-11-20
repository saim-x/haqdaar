"""Domain errors mapped 1:1 onto the frozen error table in docs/05 §2.

Every 4xx/5xx the API can emit is one of these classes. The global exception
handler in ``app.main`` renders them through the uniform envelope, so no route
ever hand-rolls an error body.
"""

from __future__ import annotations

from typing import Any


class ApiError(Exception):
    """Base class for every contract error code."""

    status_code: int = 500
    code: str = "INTERNAL_ERROR"
    message_en: str = "Something went wrong."
    message_ur: str = "کچھ غلط ہو گیا۔"

    def __init__(
        self,
        message_en: str | None = None,
        message_ur: str | None = None,
        *,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.message_en = message_en or self.message_en
        self.message_ur = message_ur or self.message_ur
        self.details = details or {}
        self.headers = headers or {}
        super().__init__(self.message_en)


class ValidationError(ApiError):
    status_code = 400
    code = "VALIDATION_ERROR"
    message_en = "The request contains invalid or missing fields."
    message_ur = "درخواست میں غلط یا غائب معلومات ہیں۔"


class UnauthorizedError(ApiError):
    status_code = 401
    code = "UNAUTHORIZED"
    message_en = "Authentication is required or your session has expired."
    message_ur = "تصدیق ضروری ہے یا آپ کا سیشن ختم ہو گیا ہے۔"


class InvalidOtpError(ApiError):
    status_code = 401
    code = "INVALID_OTP"
    message_en = "The code is incorrect or has expired."
    message_ur = "کوڈ غلط ہے یا اس کی مدت ختم ہو گئی ہے۔"


class ForbiddenError(ApiError):
    status_code = 403
    code = "FORBIDDEN"
    message_en = "Your role does not allow this action."
    message_ur = "آپ کے کردار کو یہ اجازت نہیں ہے۔"


class ConsentRevokedError(ApiError):
    status_code = 403
    code = "CONSENT_REVOKED"
    message_en = "Access blocked because the citizen withdrew consent for this data category."
    message_ur = "شہری نے اس ڈیٹا تک رسائی کی اجازت واپس لے لی ہے۔"


class SameOfficerError(ApiError):
    status_code = 403
    code = "SAME_OFFICER"
    message_en = "A different officer must give the second approval."
    message_ur = "دوسری منظوری کسی دوسرے افسر کو دینی ہوگی۔"


class NotFoundError(ApiError):
    status_code = 404
    code = "NOT_FOUND"
    message_en = "The requested resource was not found."
    message_ur = "مطلوبہ معلومات موجود نہیں۔"


class InvalidTransitionError(ApiError):
    status_code = 409
    code = "INVALID_TRANSITION"
    message_en = "This status change is not allowed."
    message_ur = "یہ تبدیلی اجازت شدہ نہیں ہے۔"


class IdempotencyConflictError(ApiError):
    status_code = 409
    code = "IDEMPOTENCY_CONFLICT"
    message_en = "This request key was already used with different data."
    message_ur = "یہ درخواست کلید پہلے مختلف معلومات کے ساتھ استعمال ہو چکی ہے۔"


class RuleVersionImmutableError(ApiError):
    status_code = 409
    code = "RULE_VERSION_IMMUTABLE"
    message_en = "Published rule versions cannot be edited."
    message_ur = "شائع شدہ قواعد میں ترمیم نہیں کی جا سکتی۔"


class FileTooLargeError(ApiError):
    status_code = 413
    code = "FILE_TOO_LARGE"
    message_en = "The file is too large."
    message_ur = "فائل بہت بڑی ہے۔"


class UnsupportedMediaTypeError(ApiError):
    status_code = 415
    code = "UNSUPPORTED_MEDIA_TYPE"
    message_en = "This file type is not supported."
    message_ur = "اس قسم کی فائل معاون نہیں ہے۔"


class RuleValidationFailedError(ApiError):
    status_code = 422
    code = "RULE_VALIDATION_FAILED"
    message_en = "The rule draft failed validation."
    message_ur = "قواعد کا مسودہ جانچ میں ناکام رہا۔"


class RateLimitedError(ApiError):
    status_code = 429
    code = "RATE_LIMITED"
    message_en = "Too many requests. Please try again shortly."
    message_ur = "بہت زیادہ درخواستیں۔ براہ کرم تھوڑی دیر بعد کوشش کریں۔"


class ServiceUnavailableError(ApiError):
    status_code = 503
    code = "SERVICE_UNAVAILABLE"
    message_en = "A required service is temporarily unavailable."
    message_ur = "ضروری سروس عارضی طور پر دستیاب نہیں ہے۔"


class DegradedError(ApiError):
    """Used only by /health when a dependency is unhealthy (docs/03 §6.4)."""

    status_code = 503
    code = "DEGRADED"
    message_en = "The platform is running in a degraded state."
    message_ur = "پلیٹ فارم فی الحال محدود حالت میں ہے۔"
