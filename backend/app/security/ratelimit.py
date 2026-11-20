"""In-memory sliding-window rate limiter (docs/03 §6.3).

Single-instance hackathon deployment, so a process-local dict is sufficient and
resets cleanly on restart. Keys are IP / phone / user_id / api_key_id strings.
"""

from __future__ import annotations

import threading
import time
from collections import deque

from app.config import settings
from app.security.errors import RateLimitedError


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_seconds: int) -> None:
        """Record a hit for ``key``; raise ``429 RATE_LIMITED`` when over ``limit``."""
        if not settings.rate_limit_enabled or limit <= 0:
            return
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            bucket = self._hits.setdefault(key, deque())
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                retry_after = max(1, int(window_seconds - (now - bucket[0])) + 1)
                raise RateLimitedError(
                    details={"limit": limit, "window_seconds": window_seconds},
                    headers={"Retry-After": str(retry_after)},
                )
            bucket.append(now)

    def reset(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._hits.clear()
            else:
                self._hits.pop(key, None)


limiter = SlidingWindowLimiter()


def check_otp_request_limits(phone: str, ip: str | None) -> None:
    """3 / 10 min per phone + 10 / 10 min per IP (docs/03 §6.3)."""
    limiter.check(
        f"otp:phone:{phone}", settings.otp_phone_limit, settings.otp_phone_window_seconds
    )
    if ip:
        limiter.check(f"otp:ip:{ip}", settings.otp_ip_limit, settings.otp_phone_window_seconds)


def check_login_limit(ip: str | None) -> None:
    limiter.check(f"login:ip:{ip or 'unknown'}", 10, 600)


def check_scam_limit(ip: str | None) -> None:
    limiter.check(f"scam:ip:{ip or 'unknown'}", 20, 60)


def check_ai_limit(user_id: str) -> None:
    limiter.check(f"ai:user:{user_id}", 30, 60)


def check_api_key_limit(api_key_id: str, per_minute: int) -> None:
    limiter.check(f"apikey:{api_key_id}", per_minute, 60)


__all__ = [
    "SlidingWindowLimiter",
    "check_ai_limit",
    "check_api_key_limit",
    "check_login_limit",
    "check_otp_request_limits",
    "check_scam_limit",
    "limiter",
]
