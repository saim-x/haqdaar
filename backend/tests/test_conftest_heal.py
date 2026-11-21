"""D-6 guard: the test-env heal must upgrade, never reset to base.

``tests/conftest.py::_normalise_version_table`` used to delete every
``alembic_version`` row that was not a head. On a stale-but-migrated test database
that emptied the table, so ``upgrade heads`` replayed every migration from base
against tables that already existed - the DuplicateTable storms.

A single recorded revision is a *position*, not a conflict. Only genuine multi-row
states need collapsing, and then the fix is to keep the most advanced row and drop
its ancestors. These tests pin that decision table; the last one checks the live
test database actually sits on one head.
"""

from __future__ import annotations

from typing import Any

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from tests import conftest

BACKEND_DIR = conftest.BACKEND_DIR


@pytest.fixture(scope="module")
def script() -> Any:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return ScriptDirectory.from_config(config)


def test_a_single_non_head_revision_is_left_alone(script: Any) -> None:
    """The regression: this used to return ``["app_0001"]`` and reset the database."""
    assert conftest._revisions_to_drop(["app_0001"], script) == []


def test_a_single_head_is_left_alone(script: Any) -> None:
    assert conftest._revisions_to_drop(["be_0002"], script) == []


def test_an_ancestor_row_is_dropped_when_its_descendant_is_recorded(script: Any) -> None:
    """The S1 overlap: both chains recorded, ``dpi_mock_0001`` descends from ``app_0001``."""
    assert conftest._revisions_to_drop(["app_0001", "dpi_mock_0001"], script) == ["app_0001"]


def test_the_whole_chain_collapses_to_the_head(script: Any) -> None:
    assert conftest._revisions_to_drop(
        ["app_0001", "dpi_mock_0001", "be_0002"], script
    ) == ["app_0001", "dpi_mock_0001"]


def test_an_orphan_revision_is_dropped_when_a_known_one_exists(script: Any) -> None:
    assert conftest._revisions_to_drop(["app_0001", "deadbeef"], script) == ["deadbeef"]


def test_an_empty_version_table_is_a_no_op(script: Any) -> None:
    assert conftest._revisions_to_drop([], script) == []


def test_only_unknown_revisions_are_left_for_alembic_to_report(script: Any) -> None:
    assert conftest._revisions_to_drop(["deadbeef", "cafebabe"], script) == []


class _FakeRevision:
    def __init__(self, down_revision: str | None) -> None:
        self.down_revision = down_revision


class _FakeScript:
    """Just enough of ``ScriptDirectory`` to exercise the ancestry walk."""

    def __init__(self, graph: dict[str, str | None]) -> None:
        self._graph = graph

    def get_revision(self, revision: str) -> _FakeRevision:
        if revision not in self._graph:
            raise KeyError(revision)
        return _FakeRevision(self._graph[revision])


def test_divergent_heads_are_both_kept() -> None:
    """Two unrelated heads are a legitimate state; alembic upgrades each one."""
    script = _FakeScript({"left": None, "right": None})
    assert conftest._revisions_to_drop(["left", "right"], script) == []


def test_a_merge_point_keeps_the_join_and_drops_both_branches() -> None:
    script = _FakeScript({"left": None, "right": None, "merge": ("left", "right")})
    assert conftest._revisions_to_drop(["left", "right", "merge"], script) == ["left", "right"]


def test_the_live_test_database_sits_on_exactly_one_head(
    prepared_database: str, script: Any
) -> None:
    from sqlalchemy import text

    from app.db import engine

    with engine.connect() as connection:
        recorded = list(
            connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
        )
    assert len(recorded) == 1, f"expected one head, found {recorded}"
    assert recorded[0] in set(script.get_heads())


# -- the stale-but-migrated heal -----------------------------------------
class _DuplicateTable(Exception):
    sqlstate = "42P07"


def test_duplicate_object_detection_recognises_the_stale_schema_signature() -> None:
    """The one failure that means "the schema is already there, move the marker"."""
    assert conftest._is_duplicate_object(_DuplicateTable("relation already exists"))


def test_duplicate_object_detection_follows_the_cause_chain() -> None:
    """SQLAlchemy wraps the driver error; the sqlstate lives on the original."""
    try:
        try:
            raise _DuplicateTable("relation already exists")
        except _DuplicateTable as inner:
            raise RuntimeError("wrapped") from inner
    except RuntimeError as outer:
        assert conftest._is_duplicate_object(outer)


def test_duplicate_object_detection_ignores_unrelated_failures() -> None:
    """A genuinely broken migration must still fail the suite loudly."""
    assert not conftest._is_duplicate_object(RuntimeError("boom"))
    assert not conftest._is_duplicate_object(ValueError("Can't locate revision 'deadbeef'"))


def test_duplicate_object_detection_survives_a_self_referential_chain() -> None:
    error = RuntimeError("loop")
    error.__cause__ = error
    assert not conftest._is_duplicate_object(error)
