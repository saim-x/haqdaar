"""Architectural invariants: the engine is pure, deterministic and cannot auto-reject.

These tests are the machine-checkable half of AGENTS.md §3.1 and §3.2. They fail loudly
if anyone ever imports a database, an HTTP client or an LLM into ``app/engine``.
"""

from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

import pytest
from app.engine.pipeline import evaluate_and_route
from app.engine.router import CaseOutcome, RouteAction

ENGINE_DIR = Path(__file__).resolve().parents[3] / "backend" / "app" / "engine"
BACKEND_ROOT = Path(__file__).resolve().parents[2]

#: Everything the engine is allowed to import. Nothing else, ever.
ALLOWED_ROOTS = {
    "__future__",
    "app",
    "collections",
    "copy",
    "datetime",
    "enum",
    "hashlib",
    "json",
    "pathlib",
    "pydantic",
    "rapidfuzz",
    "re",
    "typing",
    "unicodedata",
}

#: Named explicitly so a failure message says exactly what leaked.
FORBIDDEN_ROOTS = {
    "sqlalchemy",
    "fastapi",
    "httpx",
    "openai",
    "psycopg",
    "psycopg2",
    "alembic",
    "requests",
    "aiohttp",
    "numpy",
    "sklearn",
    "redis",
    "celery",
    "edge_tts",
    "cv2",
    "pytest",
}

#: Modules that read a file on purpose (the labelled dataset loader only).
IO_ALLOWED = {"eval_sweep.py"}


def _engine_files() -> list[Path]:
    return sorted(ENGINE_DIR.glob("*.py"))


def _imported_roots(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                roots.add("<relative>")
            elif node.module:
                roots.add(node.module.split(".")[0])
    return roots


def test_engine_directory_is_not_empty() -> None:
    assert len(_engine_files()) >= 11


@pytest.mark.parametrize("path", _engine_files(), ids=lambda path: path.name)
def test_no_forbidden_imports(path: Path) -> None:
    leaked = _imported_roots(path) & FORBIDDEN_ROOTS
    assert not leaked, f"{path.name} imports forbidden module(s): {sorted(leaked)}"


@pytest.mark.parametrize("path", _engine_files(), ids=lambda path: path.name)
def test_only_allowlisted_imports(path: Path) -> None:
    unexpected = _imported_roots(path) - ALLOWED_ROOTS
    assert not unexpected, f"{path.name} imports non-allowlisted module(s): {sorted(unexpected)}"


@pytest.mark.parametrize("path", _engine_files(), ids=lambda path: path.name)
def test_app_imports_stay_inside_the_engine(path: Path) -> None:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.ImportFrom)
            and node.module
            and (node.module == "app" or node.module.startswith("app."))
        ):
            assert node.module.startswith("app.engine"), (
                f"{path.name} reaches outside the engine: {node.module}"
            )


@pytest.mark.parametrize("path", _engine_files(), ids=lambda path: path.name)
def test_no_clock_or_randomness(path: Path) -> None:
    source = path.read_text(encoding="utf-8")
    for forbidden in (
        "datetime.now",
        "datetime.utcnow",
        "date.today",
        "time.time",
        "random.",
        "uuid",
        "os.environ",
    ):
        assert forbidden not in source, f"{path.name} uses non-deterministic {forbidden}"


@pytest.mark.parametrize(
    "path",
    [path for path in _engine_files() if path.name not in IO_ALLOWED],
    ids=lambda path: path.name,
)
def test_no_file_io_on_the_decision_path(path: Path) -> None:
    source = path.read_text(encoding="utf-8")
    assert "open(" not in source, f"{path.name} performs file I/O"
    assert "Path(" not in source, f"{path.name} performs file I/O"


def test_route_action_has_exactly_four_members() -> None:
    assert set(RouteAction.__members__) == {
        "AUTO_APPROVE",
        "ASK_MORE",
        "HUMAN_REVIEW",
        "WAIT_EXTERNAL",
    }


def test_route_action_has_no_auto_reject() -> None:
    assert "AUTO_REJECT" not in RouteAction.__members__


def test_case_outcome_has_no_rejected() -> None:
    assert "REJECTED" not in CaseOutcome.__members__


def _docstring_nodes(tree: ast.AST) -> set[int]:
    """Ids of docstring constants, which may legitimately *mention* AUTO_REJECT."""
    ids: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                ids.add(id(body[0].value))
    return ids


@pytest.mark.parametrize("path", _engine_files(), ids=lambda path: path.name)
def test_auto_reject_appears_nowhere_in_engine_code(path: Path) -> None:
    """Docstrings may say "there is no AUTO_REJECT"; code and data strings may not."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    docstrings = _docstring_nodes(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if id(node) in docstrings:
                continue
            assert "AUTO_REJECT" not in node.value, f"{path.name} contains AUTO_REJECT"
        elif isinstance(node, ast.Name):
            assert "AUTO_REJECT" not in node.id, f"{path.name} references AUTO_REJECT"
        elif isinstance(node, ast.Attribute):
            assert "AUTO_REJECT" not in node.attr, f"{path.name} references AUTO_REJECT"


def test_engine_imports_with_database_and_http_blocked() -> None:
    """A subprocess proof: importing the engine never pulls in a forbidden package."""
    script = """
import sys

BLOCKED = {
    "sqlalchemy", "fastapi", "httpx", "openai", "psycopg", "psycopg2",
    "alembic", "requests", "aiohttp", "numpy", "sklearn", "redis", "celery",
}


class Blocker:
    def find_spec(self, name, path=None, target=None):
        if name.split(".")[0] in BLOCKED:
            raise ImportError("forbidden import: " + name)
        return None


sys.meta_path.insert(0, Blocker())
import app.engine  # noqa: F401
import app.engine.pipeline  # noqa: F401
print("PURE")
"""
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=str(BACKEND_ROOT),
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert completed.returncode == 0, completed.stderr
    assert "PURE" in completed.stdout


def test_engine_is_deterministic_across_calls(
    fatima_facts, sahara_v1, fatima_documents
) -> None:
    first = evaluate_and_route(
        fatima_facts, sahara_v1, identity_confidence=0.98, documents=fatima_documents
    )
    second = evaluate_and_route(
        fatima_facts, sahara_v1, identity_confidence=0.98, documents=fatima_documents
    )
    assert first.model_dump_json() == second.model_dump_json()


def test_engine_does_not_mutate_its_inputs(fatima_facts, sahara_v1, fatima_documents) -> None:
    facts_before = fatima_facts.model_dump()
    rules_before = sahara_v1.model_dump()
    evaluate_and_route(
        fatima_facts, sahara_v1, identity_confidence=0.98, documents=fatima_documents
    )
    assert fatima_facts.model_dump() == facts_before
    assert sahara_v1.model_dump() == rules_before
