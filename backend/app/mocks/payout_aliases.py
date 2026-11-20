"""Synthetic payout-alias registry for the simulated Raast service.

The frozen schema (docs/04 §4.6) has no alias table, so the alias → account-title
map lives here as synthetic constants shared by ``seed.py`` and ``router.py``.
Every alias is fictional (``+92300…``) and every title belongs to a synthetic
persona.

The registry deliberately encodes the Challenge 03 / Challenge 08 scenarios:

* ``SHARED_PAYOUT_ALIAS`` — one alias reused by three unrelated applicants
  (drives ``PAYOUT_ACCOUNT_SHARED`` HIGH).
* ``DORMANT_ALIAS`` — deterministic Raast failure (drives Journey J-9).
* ``MISMATCH_ALIAS`` — account title does not match the applicant name
  (drives ``PAYOUT_NAME_MISMATCH`` MEDIUM).
"""

from __future__ import annotations

import re

#: Alias reused by three unrelated applicants (docs/10 §2, case HQ-2026-000104).
SHARED_PAYOUT_ALIAS = "+923007770001"
#: Deterministic Raast failure alias (docs/10 §1.2 E).
DORMANT_ALIAS = "+923009999999"
#: Alias whose registered title differs from the applicant's name.
MISMATCH_ALIAS = "+923008880001"

#: alias → registered account title (uppercase, as Raast returns it).
PAYOUT_ALIASES: dict[str, str] = {
    "+923001000001": "FATIMA BIBI",
    "+923001000002": "RASOOL BAKHSH",
    "+923001000003": "AYESHA KHATOON",
    "+923001000004": "SAKINA BIBI",
    "+923001000005": "ZAINAB BIBI",
    "+923001000006": "MARIAM BIBI",
    "+923001000007": "KHADIJA BIBI",
    "+923001000008": "AMINA BIBI",
    "+923001000009": "HALEEMA BIBI",
    "+923001000010": "RUKHSANA BIBI",
    SHARED_PAYOUT_ALIAS: "MUHAMMAD AKRAM",
    MISMATCH_ALIAS: "ABDUL GHANI",
    DORMANT_ALIAS: "DORMANT ACCOUNT",
}


def normalize_alias(alias: str | None) -> str:
    """Normalize a Raast alias to ``+92XXXXXXXXXX`` form."""
    raw = (alias or "").strip()
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("92"):
        return f"+{digits}"
    if digits.startswith("0"):
        return f"+92{digits[1:]}"
    if digits:
        return f"+{digits}"
    return raw


def account_title_for(alias: str | None) -> str | None:
    """Return the registered account title, or ``None`` for an unknown alias."""
    return PAYOUT_ALIASES.get(normalize_alias(alias))


def is_dormant_alias(alias: str | None) -> bool:
    """True for the deterministic failure alias (``ACCOUNT_DORMANT``)."""
    return normalize_alias(alias) == DORMANT_ALIAS


__all__ = [
    "DORMANT_ALIAS",
    "MISMATCH_ALIAS",
    "PAYOUT_ALIASES",
    "SHARED_PAYOUT_ALIAS",
    "account_title_for",
    "is_dormant_alias",
    "normalize_alias",
]
