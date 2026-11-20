"""Architectural invariants — docs/13 §1, enforced by scanning the source tree.

Three checks, all static (no database needed):

1. ``app/engine/`` is pure Python: no SQLAlchemy, FastAPI, httpx, OpenAI or
   ``app.mocks`` imports anywhere in the package.
2. ``app/api/`` and ``app/agent/`` never import ``app.mocks.models`` and never
   query a ``mock_*`` table. The single whitelisted exception is
   ``app/api/v1/admin_mocks.py`` importing ``app.mocks.config`` (chaos control).
3. Every route outside the documented public surface carries an explicit RBAC
   dependency (``require_roles`` / ``require_scopes`` / ``get_current_actor``).
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
APP_DIR = BACKEND_DIR / "app"

ENGINE_DIR = APP_DIR / "engine"
API_DIR = APP_DIR / "api"
AGENT_DIR = APP_DIR / "agent"

#: Anything the pure rules engine must never reach for. ``pydantic`` is allowed:
#: the DSL schema is a Pydantic model and carries no I/O.
ENGINE_FORBIDDEN_ROOTS = frozenset(
    {
        "sqlalchemy",
        "fastapi",
        "starlette",
        "httpx",
        "openai",
        "psycopg",
        "alembic",
        "app.mocks",
        "app.db",
        "app.models",
        "app.api",
        "app.agent",
        "app.ai",
        "app.jobs",
        "app.security",
        "app.notify",
        "app.config",
    }
)

#: ``app/api`` and ``app/agent`` may not touch the mock persistence layer.
MOCK_FORBIDDEN_MODULES = frozenset({"app.mocks.models", "app.mocks.seed", "app.mocks.seed_data"})

#: The one documented exception: the admin chaos-control router reads mock config.
MOCK_IMPORT_WHITELIST: dict[str, frozenset[str]] = {
    "api/v1/admin_mocks.py": frozenset({"app.mocks.config"}),
}

#: Routes that legitimately have no RBAC dependency (docs/03 §7 invariant 3).
PUBLIC_ROUTE_PREFIXES = (
    "/api/v1/auth/",
    "/api/v1/scam/check",
    "/api/v1/transparency",
    "/api/v1/public/",
    "/health",
    "/mock/",
    "/api/docs",
    "/api/openapi.json",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/",
)

RBAC_MARKERS = frozenset(
    {
        "require_roles",
        "require_scopes",
        "require_any_authenticated",
        "get_current_actor",
        "get_api_key_context",
    }
)


def _python_files(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return sorted(path for path in root.rglob("*.py") if "__pycache__" not in path.parts)


def _imported_modules(path: Path) -> set[str]:
    """Every module name imported by ``path``, including function-local imports.

    ``from app.mocks import config`` records both ``app.mocks`` and
    ``app.mocks.config`` so the whitelist can name the exact submodule.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.level:  # relative import inside the package
                continue
            if node.module:
                modules.add(node.module)
                for alias in node.names:
                    modules.add(f"{node.module}.{alias.name}")
    return modules


def _matches(module: str, forbidden: str) -> bool:
    return module == forbidden or module.startswith(f"{forbidden}.")


# --- 1. engine purity -------------------------------------------------------


@pytest.mark.skipif(not ENGINE_DIR.exists(), reason="app/engine/ is not present in this worktree")
def test_engine_is_pure_python() -> None:
    violations: list[str] = []
    for path in _python_files(ENGINE_DIR):
        for module in _imported_modules(path):
            for forbidden in ENGINE_FORBIDDEN_ROOTS:
                if _matches(module, forbidden):
                    violations.append(f"{path.relative_to(BACKEND_DIR)} imports {module}")
    assert not violations, "app/engine/ must stay pure Python:\n" + "\n".join(violations)


# --- 2. mock boundary -------------------------------------------------------


@pytest.mark.parametrize("root", [API_DIR, AGENT_DIR], ids=["api", "agent"])
def test_api_and_agent_never_import_mock_models(root: Path) -> None:
    violations: list[str] = []
    for path in _python_files(root):
        relative = path.relative_to(APP_DIR).as_posix()
        allowed = MOCK_IMPORT_WHITELIST.get(relative, frozenset())
        modules = _imported_modules(path)
        for module in modules:
            if any(_matches(module, forbidden) for forbidden in MOCK_FORBIDDEN_MODULES):
                violations.append(f"app/{relative} imports {module}")
            elif _matches(module, "app.mocks"):
                if module in allowed:
                    continue
                # ``from app.mocks import config`` also records the bare parent;
                # that is fine when the whitelisted child was imported.
                if module == "app.mocks" and any(
                    entry.startswith("app.mocks.") and entry in modules for entry in allowed
                ):
                    continue
                violations.append(f"app/{relative} imports {module} (not whitelisted)")
    assert not violations, "the mock HTTP boundary is broken:\n" + "\n".join(violations)


@pytest.mark.parametrize("root", [API_DIR, AGENT_DIR], ids=["api", "agent"])
def test_api_and_agent_never_query_mock_tables(root: Path) -> None:
    """A raw ``mock_*`` table name in a query string is the same violation."""
    violations: list[str] = []
    for path in _python_files(root):
        source = path.read_text(encoding="utf-8")
        for line_number, line in enumerate(source.splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            if "mock_" in stripped and ("select(" in stripped or "FROM mock_" in stripped.upper()):
                violations.append(f"{path.relative_to(BACKEND_DIR)}:{line_number}: {stripped[:90]}")
    assert not violations, "direct mock_* table access:\n" + "\n".join(violations)


# --- 3. explicit RBAC on every non-public route -----------------------------


def _route_has_rbac(route: object) -> bool:
    dependant = getattr(route, "dependant", None)
    if dependant is None:
        return False
    stack = [dependant]
    while stack:
        current = stack.pop()
        call = getattr(current, "call", None)
        name = getattr(call, "__name__", "")
        if name in RBAC_MARKERS or getattr(call, "rbac_guard", False):
            return True
        stack.extend(getattr(current, "dependencies", []) or [])
    return False


def _is_public(path: str) -> bool:
    return any(path == prefix or path.startswith(prefix) for prefix in PUBLIC_ROUTE_PREFIXES)


def test_every_non_public_route_has_an_rbac_dependency() -> None:
    from app.main import create_app

    app = create_app()
    schema = app.openapi()

    missing: list[str] = []
    for path, operations in schema["paths"].items():
        if _is_public(path):
            continue
        for method in operations:
            if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                continue
            route = _find_route(app, path, method)
            if route is None:
                continue
            if not _route_has_rbac(route):
                missing.append(f"{method.upper()} {path}")

    assert not missing, "routes without an explicit RBAC dependency:\n" + "\n".join(sorted(missing))


def _find_route(app: object, path: str, method: str) -> object | None:
    """Resolve a route through FastAPI's lazily-included routers."""
    from fastapi.routing import APIRoute

    stack = list(getattr(app, "routes", []))
    while stack:
        route = stack.pop()
        if isinstance(route, APIRoute):
            if route.path == path and method.upper() in (route.methods or set()):
                return route
        else:
            stack.extend(getattr(route, "routes", []) or [])
            nested = getattr(route, "router", None)
            if nested is not None:
                stack.extend(getattr(nested, "routes", []) or [])
    return None


# --- 4. no AUTO_REJECT anywhere --------------------------------------------


def _docstring_nodes(tree: ast.AST) -> set[int]:
    """Ids of ``Constant`` nodes that are docstrings (module/class/function)."""
    docstrings: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                docstrings.add(id(body[0].value))
    return docstrings


def test_no_auto_reject_route_action_exists() -> None:
    from app.models.enums import RouteAction

    assert "AUTO_REJECT" not in {action.value for action in RouteAction}

    offenders: list[str] = []
    for path in _python_files(APP_DIR):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        docstrings = _docstring_nodes(tree)
        for node in ast.walk(tree):
            # A real AUTO_REJECT would be a string constant or an attribute name,
            # never a comment or a docstring explaining that it does not exist.
            if isinstance(node, ast.Constant) and id(node) not in docstrings:
                if isinstance(node.value, str) and "AUTO_REJECT" in node.value:
                    offenders.append(f"{path.relative_to(BACKEND_DIR)}:{node.lineno}")
            elif isinstance(node, ast.Attribute) and node.attr == "AUTO_REJECT":
                offenders.append(f"{path.relative_to(BACKEND_DIR)}:{node.lineno}")
    assert not offenders, "AUTO_REJECT must not exist anywhere:\n" + "\n".join(offenders)


def test_processing_to_rejected_is_illegal() -> None:
    from app.models.case_state import assert_transition
    from app.security.errors import InvalidTransitionError

    with pytest.raises(InvalidTransitionError):
        assert_transition("PROCESSING", "REJECTED", actor_role="OFFICER")


def test_only_an_officer_can_reject() -> None:
    from app.models.case_state import assert_transition
    from app.security.errors import InvalidTransitionError

    for role in ("CITIZEN", "HELPER", "ADMIN", "AUDITOR"):
        with pytest.raises(InvalidTransitionError):
            assert_transition("IN_REVIEW", "REJECTED", actor_role=role)

    assert_transition("IN_REVIEW", "REJECTED", actor_role="OFFICER")


# --- 5. no raw PII in log calls --------------------------------------------


def test_no_raw_cnic_or_phone_in_log_statements() -> None:
    """``log_event``/``logger.*`` calls must not interpolate raw identifiers."""
    suspicious = ("cnic_digits", "cnic=", "phone=", "password", "otp_code", "access_token")
    offenders: list[str] = []
    for path in _python_files(APP_DIR):
        if path.name in {"masking.py", "seed.py", "seed_data.py", "gen_datasets.py"}:
            continue
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            stripped = line.strip()
            if not stripped.startswith(("logger.", "log_event(")):
                continue
            lowered = stripped.lower()
            if any(token in lowered for token in suspicious):
                offenders.append(f"{path.relative_to(BACKEND_DIR)}:{line_number}: {stripped[:90]}")
    assert not offenders, "raw PII in a log statement:\n" + "\n".join(offenders)
