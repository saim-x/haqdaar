#!/usr/bin/env python3
"""
Rebuild the two self-hosted UI subsets in frontend/public/fonts/.

The woff2 files are committed, so this script is not part of the build — it is
here so the subsets are reproducible instead of being magic binaries. Run it
only when the character inventory of the UI changes.

    pip install "fonttools[woff]" brotli
    python frontend/scripts/build-fonts.py

Why two files and not one: the browser picks a face per character from
`unicode-range`, so an English-only page downloads 28.6 KB and never fetches
the Urdu face. One combined file would cost every page the full 46.7 KB.

Order matters, and it is not the same for both fonts:

  * Instrument Sans is instanced on `wdth` first, then subset. Subsetting a
    two-axis variable font first leaves the `wdth` axis pointing at glyphs the
    subset dropped.
  * Noto Sans Arabic is subset first, then instanced on `wght`. Instancing
    first trips `KeyError: '.notdef'` inside `gvar`.

Both orders were found by trying the other one first and reading the traceback.
"""

from __future__ import annotations

import io
import sys
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.subset import Options, Subsetter

FONT_DIR = Path(__file__).resolve().parent.parent / "public" / "fonts"

INSTRUMENT_SANS_URL = (
    "https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentsans/"
    "InstrumentSans%5Bwdth,wght%5D.ttf"
)
NOTO_ARABIC_URL = (
    "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansarabic/"
    "NotoSansArabic%5Bwdth,wght%5D.ttf"
)

# Latin, Latin-1 punctuation, general punctuation (dashes, quotes, bullets,
# ellipsis), the arrow the UI prints, and the minus sign. Deliberately excludes
# U+2260/2264/2265: Instrument Sans has no glyphs for them, so they fall through
# to system-ui, which is correct for comparison operators in the rule trace.
LATIN_UNICODES = (
    list(range(0x0020, 0x0100))  # basic latin + latin-1 supplement
    + list(range(0x2000, 0x2070))  # general punctuation
    + [0x2192, 0x2212]  # rightwards arrow, minus sign
)

# Arabic block and Arabic supplement only. Covers every Urdu-specific letter
# (U+0679 0688 0691 06BA 06BE 06C1 06D2 06AF 06CC) and both digit sets.
#
# The presentation-forms blocks (U+FB50-FDFF, U+FE70-FEFF) are deliberately
# excluded: they exist for legacy encodings that pre-date Unicode Arabic, no
# modern text uses them, and keeping them costs ~97 KB — five times the rest of
# the file. The @font-face `unicode-range` still lists them so that any stray
# codepoint routes here and falls through to the system Arabic face rather than
# to a Latin one.
ARABIC_UNICODES = list(range(0x0600, 0x0700)) + list(range(0x0750, 0x0780))


def fetch(url: str) -> TTFont:
    print(f"  fetching {url.rsplit('/', 1)[-1]}")
    with urllib.request.urlopen(url, timeout=60) as response:
        return TTFont(io.BytesIO(response.read()))


def subset(font: TTFont, unicodes: list[int]) -> TTFont:
    options = Options()
    options.layout_features = ["kern", "liga", "calt", "mark", "mkmk", "rlig"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.recalc_bounds = True
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    return font


def pin_axis(font: TTFont, axis: str, value: float) -> TTFont:
    """Drop one axis, keeping the other variable."""
    return instancer.instantiateVariableFont(font, {axis: value}, inplace=False)


def limit_axis(font: TTFont, axis: str, low: float, high: float) -> TTFont:
    """Keep an axis variable, but only across the range the UI actually uses.

    The @font-face blocks declare `font-weight: 400 700`, so the axis has to
    stay live; clamping it drops the masters outside that band and the bytes
    that go with them.
    """
    return instancer.instantiateVariableFont(font, {axis: (low, high)}, inplace=False)


def save(font: TTFont, name: str) -> None:
    path = FONT_DIR / name
    font.flavor = "woff2"
    font.save(path)
    print(f"  wrote {name}  {path.stat().st_size:,} bytes")


def main() -> int:
    FONT_DIR.mkdir(parents=True, exist_ok=True)

    print("Instrument Sans (Latin) — instance wdth, then subset")
    latin = fetch(INSTRUMENT_SANS_URL)
    latin = pin_axis(latin, "wdth", 100)
    latin = limit_axis(latin, "wght", 400, 700)
    latin = subset(latin, LATIN_UNICODES)
    save(latin, "InstrumentSans-subset.woff2")

    print("Noto Sans Arabic (Urdu) — subset, then pin wdth and clamp wght")
    urdu = fetch(NOTO_ARABIC_URL)
    urdu = subset(urdu, ARABIC_UNICODES)
    urdu = pin_axis(urdu, "wdth", 100)
    urdu = limit_axis(urdu, "wght", 400, 700)
    save(urdu, "NotoSansArabic-subset.woff2")

    print("\nDone. Re-run `npm run build` and check the precache size.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
