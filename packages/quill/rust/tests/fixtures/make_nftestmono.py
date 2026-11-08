#!/usr/bin/env python3
"""Regenerate nftestmono.ttf — deterministic minimal TrueType face for the
font-registry/measured-layout/shaping tests. No third-party font bytes.

Metrics (units_per_em 1000, hmtx advances in font units):
  space 250, 'i' 200, 'W' 1000, 'm' 800, digits 600,
  other printable ASCII 500, '.notdef' 500.

Shaping tables (added for the harfrust slice):
  GPOS 'kern': 'W' followed by 'W' kerns -300 units
               ("WW" shapes to 1700 units vs 2000 unshaped).
  GSUB 'liga': 'f' 'i' ligates to glyph 'f_i' with advance 600
               ("fi" shapes to 600 units vs 700 unshaped).

Requires fontTools (developed with 4.61.1). Run from the fixtures dir:
  python3 make_nftestmono.py
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000

# (codepoint, advance overrides); default 500, digits 600, space 250,
# 'i' 200, 'W' 1000, 'm' 800 — matching the slice-1 fixture contract.
ADVANCES = {0x20: 250, 0x69: 200, 0x57: 1000, 0x6D: 800}
DEFAULT_ADVANCE = 500
DIGIT_ADVANCE = 600

glyphs = [".notdef"]
metrics = {".notdef": (DEFAULT_ADVANCE, 0)}
cmap = {}
for cp in range(0x20, 0x7F):
    name = f"u{cp:04X}"
    glyphs.append(name)
    adv = ADVANCES.get(cp, DIGIT_ADVANCE if 0x30 <= cp <= 0x39 else DEFAULT_ADVANCE)
    metrics[name] = (adv, 0)
    cmap[cp] = name

# Ligature glyph for GSUB 'liga' f+i -> f_i (advance 600).
LIGA = "f_i"
glyphs.append(LIGA)
metrics[LIGA] = (600, 0)

fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder(glyphs)
fb.setupCharacterMap(cmap)
fb.setupGlyf(
    {name: TTGlyphPen(None).glyph() for name in glyphs}
)
fb.setupHorizontalMetrics(metrics)
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupOS2()
fb.setupNameTable({"familyName": "NFTestMono", "styleName": "Regular"})
fb.setupPost()
fb.setupMaxp()

font = fb.font
addOpenTypeFeaturesFromString(
    font,
    """
languagesystem DFLT dflt;
languagesystem latn dflt;

feature kern {
    pos u0057 u0057 -300;
} kern;

feature liga {
    sub u0066 u0069 by f_i;
} liga;
""",
)

font.save("nftestmono.ttf")
print("wrote nftestmono.ttf:", len(glyphs), "glyphs")
