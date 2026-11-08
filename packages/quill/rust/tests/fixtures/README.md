# Test fixtures

`nftestmono.ttf` — deterministic minimal TrueType face generated locally with
fontTools (4.61.1) for the font-registry/measured-layout tests. It contains no
third-party font bytes and carries no license restrictions. Metrics used by the
tests: units_per_em 1000; advance widths in font units — space 250, `i` 200,
`W` 1000, `m` 800, digits 600, other printable ASCII 500, `.notdef` 500.

Regenerate with a fontTools `TTFont` script if the face ever needs changing;
keep the advance table above stable or update the Rust/TS test expectations.
