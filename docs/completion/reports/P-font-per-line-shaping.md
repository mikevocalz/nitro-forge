# P-font-per-line-shaping — quill per-line re-shaping for `layout {font}`

2026-11-08. Third slice of `P-font-glyph-backend-decision.md` (hybrid c on
the fontations stack); branch `codex/w8-quill-perline`, worktree
`forge-w8-quill-perline`. Slice 2 (`codex/w5-quill-shaping`) shaped each
block once with whole-block context; this slice lands the deferred
fidelity fix: wrapped lines are re-shaped independently so
break-adjacent kern/ligature context never crosses a line boundary.

## Approach

`layout {font}` per block (unchanged entry point):

1. **Initial shape** — one `harfrust` pass over the whole block text
   (`FaceMeasure::shape_char_advances`), advances folded onto cluster-first
   chars, greedy `wrap_block_measured` produces the first line spans.
2. **Bounded re-shaping passes** — up to `MAX_LINE_SHAPE_PASSES` (4):
   `FaceMeasure::shape_span_char_advances` shapes every current line span
   independently (one `ShaperFont` + one reused `Buffer` per block pass,
   per-line `guess_segment_properties`, same cluster→char advance folding),
   the prefix is rebuilt, and `wrap_block_measured` re-wraps with
   identical semantics (contiguous `{start,end}` spans, `' '` separators,
   hard-break ≥1 char). A pass whose output spans equal the previous
   pass's has converged — the final lines were then measured in exactly
   the context those spans imply — and stops early.
3. **Fallback** — any shape error/panic at any pass (or a block over
   `MAX_SHAPED_CHARS_PER_BLOCK` = 131072 chars, or an empty block)
   produces the slice-1 unshaped `cmap`+`hmtx` wrap wholesale, never a
   half-shaped mix.

Work bound: `(1 + 4) × block chars` shaped chars per block per call —
each pass shapes exactly the block's char count because spans partition
the text. Deterministic termination: at most 4 passes regardless of
oscillation; every pass is pure functions of fixed font bytes.

## What changed observably

Break-adjacent shaping deltas no longer leak across lines. Fixture
example (`nftestmono.ttf`, GPOS kern `W`+`W` −300): `"WWW"` at
`font_size 10`, `page_width 15` whole-block-shaped to 7/7/10pt would
wrap `[(0,2),(2,3)]`; per-line shaping measures every lone `W` at 10pt
and converges to `[(0,1),(1,2),(2,3)]`. The h1 `"WWWW"` heading case
moved from `[(0,3),(3,4)]` to `[(0,2),(2,4)]` — the old split only fit
because the third W's advance was kerned against the fourth W on the
next line.

## Honest residual infidelity

- If 4 passes exhaust without convergence, the final spans were measured
  under the *previous* pass's line spans — the same class of bias as
  slice 2 but strictly smaller; spans stay contiguous either way.
- A multi-char cluster (ligature/grapheme) whose advance is folded onto
  its first char can still be split by a hard break; the misestimate is
  under one glyph advance.
- Glyph positions/extents, per-inline family/size resolution, fallback
  chains, rasterization, TOC page numbers, `renderPage` remain deferred.
- The 131072-char shaped-path cap is per block; a document of many
  large blocks still costs proportional unshaped-path work plus up to
  5× shaped work per capped block.

## Verification

- `cargo test -p quill-engine`: 240 pass (2 new —
  `layout_fontreshapes_each_wrapped_line` end-to-end wrap change +
  determinism, `span_shaping_is_per_line_and_validates_spans` unit
  coverage incl. malformed-span rejection; 1 slice-2 expectation updated
  for the now-correct h1 break).
- `cargo build -p nf-cli`: clean.
- `pnpm install --prefer-offline`: clean.
- `pnpm --filter @nitro-forge/quill test`: 56 pass (1 new fonts.e2e
  per-line kern-boundary case via nf-cli).
- `pnpm --filter @nitro-forge/quill typecheck`: clean.
