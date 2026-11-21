"""HTTP client for the simulated DPI services (docs/07 §7, docs/10 §1.1).

Kept separate from the case agent so the retry policy can be tested without a
database: this module imports ``httpx`` and the standard library only.

Policy: two fast retries (0.5 s, 1.5 s) then :class:`ExternalServiceUnavailable`.
A 4xx is our bug, not an outage, so it fails immediately instead of retrying.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any, Self

import httpx

__all__ = [
    "DEFAULT_TIMEOUT_SECONDS",
    "RETRY_DELAYS_SECONDS",
    "ExternalServiceUnavailable",
    "MockClient",
]

#: docs/07 §7: two fast retries, then give up and let the job back off.
RETRY_DELAYS_SECONDS: tuple[float, ...] = (0.5, 1.5)
DEFAULT_TIMEOUT_SECONDS = 5.0


class ExternalServiceUnavailable(RuntimeError):
    """A simulated DPI service stayed down through every retry."""

    def __init__(self, service: str, *, attempts: int, detail: str = "") -> None:
        self.service = service
        self.attempts = attempts
        self.detail = detail
        super().__init__(
            f"mock service {service!r} unavailable after {attempts} attempt(s): {detail}"
        )


# -- HTTP client ---------------------------------------------------------
class MockClient:
    """Thin httpx wrapper with the docs/07 §7 retry policy."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._sleep = sleep
        self._client = httpx.Client(
            base_url=self._base_url,
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def get(
        self, service: str, path: str, *, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        return self._request(service, "GET", path, params=params)

    def post(
        self,
        service: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        return self._request(service, "POST", path, json=json, headers=headers)

    def _request(
        self,
        service: str,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        attempts = len(RETRY_DELAYS_SECONDS) + 1
        detail = ""
        for attempt in range(1, attempts + 1):
            try:
                response = self._client.request(method, path, **kwargs)
            except httpx.HTTPError as exc:
                detail = f"{type(exc).__name__}: {exc}"
            else:
                if response.status_code < 400:
                    try:
                        payload = response.json()
                    except ValueError as exc:
                        detail = f"Invalid JSON response: {exc}"
                    else:
                        return payload if isinstance(payload, dict) else {"data": payload}
                elif response.status_code < 500:
                    # A 4xx is our bug, not an outage: retrying cannot help.
                    raise ExternalServiceUnavailable(
                        service,
                        attempts=attempt,
                        detail=f"HTTP {response.status_code}: {response.text[:200]}",
                    )
                else:
                    detail = f"HTTP {response.status_code}"
            if attempt < attempts:
                self._sleep(RETRY_DELAYS_SECONDS[attempt - 1])
        raise ExternalServiceUnavailable(service, attempts=attempts, detail=detail)
