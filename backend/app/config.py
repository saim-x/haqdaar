"""Pydantic Settings — every variable documented in docs/03 §5.3 plus runtime knobs.

Reads ``.env`` from the repo root (and ``backend/.env`` if present). Nothing here
may hold a real secret: defaults are the documented dev values only.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Core (docs/03 §5.3) -------------------------------------------------
    database_url: str = "postgresql+psycopg://haqdaar:haqdaar@localhost:5432/haqdaar"
    jwt_secret: str = "dev-secret-change-me"  # noqa: S105 - dev default, overridden by env
    qr_hmac_secret: str = "dev-qr-secret-change-me"  # noqa: S105 - dev default, overridden by env
    mock_base_url: str = "http://127.0.0.1:8000/mock"
    ai_provider: Literal["live", "fake"] = "fake"
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    openai_embed_model: str = "text-embedding-3-small"
    openai_stt_model: str = "whisper-1"
    demo_mode: bool = True
    upload_dir: Path = Path("./data/uploads")
    rate_limit_enabled: bool = True
    log_level: str = "INFO"

    # --- Runtime / deployment ------------------------------------------------
    app_env: Literal["dev", "test", "prod"] = "dev"
    host_db_port: int = 5433
    host_api_port: int = 8010
    run_embedded_worker: bool = False
    static_dir: Path = BACKEND_DIR / "static"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- Tokens & OTP (docs/09 §1.2) ----------------------------------------
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days_citizen: int = 30
    refresh_token_ttl_hours_staff: int = 12
    otp_ttl_seconds: int = 300
    otp_max_attempts: int = 5
    otp_phone_limit: int = 3
    otp_phone_window_seconds: int = 600
    otp_ip_limit: int = 10

    # --- Jobs / worker (docs/03 §5.1) ---------------------------------------
    worker_poll_interval_ms: int = 500
    worker_max_concurrency: int = 4
    worker_max_attempts: int = 5
    worker_heartbeat_seconds: int = 10
    worker_heartbeat_stale_seconds: int = 30
    worker_backoff_seconds: str = "15,30,60,120"

    # --- Uploads (docs/05 §2) ------------------------------------------------
    max_image_upload_bytes: int = 2 * 1024 * 1024
    max_audio_upload_bytes: int = 5 * 1024 * 1024
    doc_verify_sync_timeout_seconds: float = 4.0

    # --- Audit chain (docs/09 §5.1) -----------------------------------------
    audit_chain_lock_key: int = 99887766

    @field_validator("upload_dir", "static_dir", mode="after")
    @classmethod
    def _resolve_path(cls, value: Path) -> Path:
        return value if value.is_absolute() else (BACKEND_DIR / value).resolve()

    @property
    def backoff_schedule(self) -> list[int]:
        return [int(part) for part in self.worker_backoff_seconds.split(",") if part.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_test(self) -> bool:
        return self.app_env == "test"

    @property
    def mock_api_root(self) -> str:
        """Host root of the simulated DPI services (no ``/mock`` suffix).

        ``app/agent/mock_client.py`` requests absolute paths such as
        ``/mock/v1/identity/lookup``, so the httpx base URL must be the host root.
        Both ``http://host:8000`` and the documented ``http://host:8000/mock`` are
        accepted in ``.env`` and normalised here.
        """
        base = self.mock_base_url.rstrip("/")
        if base.endswith("/mock"):
            base = base[: -len("/mock")]
        return base

    @property
    def MOCK_BASE_URL(self) -> str:  # noqa: N802 - uppercase alias used by app/agent
        """Uppercase alias so ``settings.MOCK_BASE_URL`` works for teammates.

        Writable: the integration tests point it at a live test server.
        """
        override = self.__dict__.get("_mock_base_url_override")
        if override:
            return str(override)
        return self.mock_api_root

    @MOCK_BASE_URL.setter
    def MOCK_BASE_URL(self, value: str) -> None:  # noqa: N802 - see getter
        object.__setattr__(self, "_mock_base_url_override", value)

    @property
    def UPLOAD_DIR(self) -> Path:  # noqa: N802 - uppercase alias used by app/ai
        """Uppercase alias so ``settings.UPLOAD_DIR`` works for teammates.

        ``app/ai/doc_verify.py`` and ``app/ai/provider.py`` read the directory with
        ``getattr(settings, "UPLOAD_DIR", None)``. Without this alias that lookup
        returned ``None``, so the verifier fell back to its own default
        (``backend/app/uploads``) while the writer stored under
        ``backend/data/uploads`` — every uploaded document came back
        ``file_present: false``. One attribute, one directory.
        """
        return self.upload_dir


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def upload_root() -> Path:
    """The single upload directory, created on demand.

    ``upload_dir`` is already resolved against the backend root by
    :meth:`Settings._resolve_path`, so this is independent of the process working
    directory — the writer, the download endpoint, ``/health`` and the document
    verifier all land on the same absolute path.
    """
    root = settings.upload_dir
    root.mkdir(parents=True, exist_ok=True)
    return root
