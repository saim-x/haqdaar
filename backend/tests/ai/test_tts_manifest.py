"""The Urdu audio registry contract (ADR-018).

FE is the consumer, so FE's call sites define the key names. This module reads
``frontend/src`` and asserts that every key the UI asks for exists in the
manifest - the failure ADR-018 was written to prevent was two agents inventing
disjoint names, which would have made every prompt a silent no-op.

The manifest is also checked for its pinned shape: a flat ``{key: text}`` map
with producer metadata under ``_meta``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app.ai import tts_pregen

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent
FRONTEND_SRC = REPO_ROOT / "frontend" / "src"
MANIFEST_PATH = REPO_ROOT / "frontend" / "public" / "audio" / "ur" / "manifest.json"

#: ``audioKey="literal"`` and ``audioKey={'literal'}`` call sites.
_STATIC_KEY = re.compile(r"""audioKey=(?:"([a-z0-9_]+)"|\{'([a-z0-9_]+)'\})""")
#: ``audioKey={`prefix_${expr}`}`` template call sites.
_DYNAMIC_KEY = re.compile(r"audioKey=\{`([a-z0-9_]+)_\$\{")

#: The wizard step list FE renders, read from its own source.
_WIZARD_STEPS = re.compile(r"const STEPS = \[(.*?)\] as const;", re.S)
_STEP_NAME = re.compile(r"'([a-z0-9_]+)'")


def _fe_source_files() -> list[Path]:
    if not FRONTEND_SRC.exists():  # pragma: no cover - FE tree absent
        pytest.skip("frontend/src is not present in this checkout")
    return sorted(FRONTEND_SRC.rglob("*.tsx"))


def _fe_static_keys() -> set[str]:
    keys: set[str] = set()
    for path in _fe_source_files():
        text = path.read_text(encoding="utf-8")
        for match in _STATIC_KEY.finditer(text):
            keys.add(match.group(1) or match.group(2))
    return keys


def _fe_dynamic_prefixes() -> set[str]:
    prefixes: set[str] = set()
    for path in _fe_source_files():
        text = path.read_text(encoding="utf-8")
        prefixes.update(_DYNAMIC_KEY.findall(text))
    return prefixes


def _fe_wizard_steps() -> list[str]:
    for path in _fe_source_files():
        text = path.read_text(encoding="utf-8")
        match = _WIZARD_STEPS.search(text)
        if match:
            return _STEP_NAME.findall(match.group(1))
    return []  # pragma: no cover - FE always defines STEPS


def _manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


class TestManifestShape:
    def test_manifest_is_a_flat_key_to_text_map(self) -> None:
        manifest = _manifest()
        assert "_meta" in manifest
        for key, value in manifest.items():
            if key == "_meta":
                continue
            assert isinstance(value, str) and value.strip(), key

    def test_meta_carries_the_producer_data(self) -> None:
        meta = _manifest()["_meta"]
        assert meta["language"] == "ur-PK"
        assert meta["voice"] == tts_pregen.VOICE
        assert meta["count"] == len(tts_pregen.PROMPTS)
        assert set(meta["files"]) == set(tts_pregen.PROMPTS)

    def test_manifest_matches_the_generator(self) -> None:
        """The committed artifact must be exactly what ``tts_pregen`` emits."""
        assert _manifest() == tts_pregen.build_manifest()


class TestFeContract:
    def test_every_static_fe_key_exists(self) -> None:
        manifest = _manifest()
        missing = sorted(key for key in _fe_static_keys() if key not in manifest)
        assert not missing, f"FE asks for keys the manifest does not define: {missing}"

    def test_every_wizard_step_has_a_prompt(self) -> None:
        manifest = _manifest()
        steps = _fe_wizard_steps()
        assert len(steps) == 14, steps
        missing = [f"wizard_{step}" for step in steps if f"wizard_{step}" not in manifest]
        assert not missing, missing

    def test_dynamic_key_families_are_covered(self) -> None:
        """``status_*``, ``mydata_*`` and ``scam_*`` are built at runtime."""
        manifest = _manifest()
        prefixes = _fe_dynamic_prefixes()
        assert {"status", "mydata", "scam"} <= prefixes, prefixes

        from app.models.enums import CaseStatus, DataCategory

        for status in CaseStatus:
            assert f"status_{status.value.lower()}" in manifest, status
        for category in DataCategory:
            assert f"mydata_{category.value.lower()}" in manifest, category
        for verdict in ("verified_official", "likely_safe", "cannot_tell", "likely_scam"):
            assert f"scam_{verdict}" in manifest, verdict

    def test_fe_key_registry_covers_every_fe_call_site(self) -> None:
        """ADR-018 pinned 31; login/helper added five, My Data documents one more."""
        assert len(tts_pregen.FE_KEYS) == 37
        assert len(set(tts_pregen.FE_KEYS)) == 37
        assert _fe_static_keys() <= set(tts_pregen.FE_KEYS)
        manifest = _manifest()
        missing = [key for key in tts_pregen.FE_KEYS if key not in manifest]
        assert not missing, missing

    def test_no_legacy_step_keys_remain(self) -> None:
        """The old ``step_*`` names were the other half of the ADR-018 collision."""
        manifest = _manifest()
        legacy = [key for key in manifest if key.startswith("step_")]
        assert not legacy, legacy
