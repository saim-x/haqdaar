"""Test bootstrap for the mock-services suite.

The mock layer imports ``app.db.Base`` (A1's module). Until that lands, install a
minimal stand-in so the mock models, router and seeder stay importable and
testable. The stub is only installed when the real module is genuinely absent,
so it disappears the moment A1's ``app/db.py`` appears.
"""

from __future__ import annotations

import sys
import types


def _install_db_stub() -> None:
    try:  # pragma: no cover - the happy path once A1 lands
        import app.db  # noqa: F401

        return
    except Exception:
        pass

    from sqlalchemy.orm import declarative_base

    module = types.ModuleType("app.db")
    module.Base = declarative_base()  # type: ignore[attr-defined]
    module.SessionLocal = None  # type: ignore[attr-defined]
    module.engine = None  # type: ignore[attr-defined]
    module.get_db = lambda: None  # type: ignore[attr-defined]
    sys.modules["app.db"] = module

    import app

    app.db = module  # type: ignore[attr-defined]


_install_db_stub()
