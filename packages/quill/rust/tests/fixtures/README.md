# Test fixtures

`nftestmono.ttf` — deterministic minimal TrueType face generated locally with
fontTools (4.61.1) for the font-registry/measured-layout/shaping tests. It
contains no third-party font bytes and carries no license restrictions.
Metrics used by the tests: units_per_em 1000; advance widths in font units —
space 250, `i` 200, `W` 1000, `m` 800, digits 600, other printable ASCII 500,
`.notdef` 500. Shaping tables (added for the harfrust slice): GPOS `kern`
pair `W`+`W` = -300 units (lands on the first glyph of each pair, so
"WWWW" shapes to per-char advances 700/700/700/1000) and GSUB `liga`
`f`+`i` → `f_i` glyph with advance 600 ("fi" shapes to a single 600-unit
cluster). The face has 97 glyphs (`.notdef` + printable ASCII + `f_i`).

Regenerate with `python3 make_nftestmono.py` in this directory; keep the
advance table and the kern/ligature pairs above stable or update the
Rust/TS test expectations.
