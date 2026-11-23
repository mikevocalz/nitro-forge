# 2026-11-23, 80e5934: superseded B-11 Layers panel capture

Superseded by [`../2026-11-23-a5634ed/`](../2026-11-23-a5634ed/README.md)
(decision D7). This frame shows Tron's whole `LayerBlendAndOpacity` in the
Layers panel, which `a5634ed` replaced: its opacity scrubber rendered blank
under forced colours, stepped 0.0001 %, and sat below the blend section's
fold.

`f3-b11-layers-panel.png` is a headless Chromium 1243 capture (Playwright,
`apps/studio-preview/verify-prism-blend.mjs` at `80e5934`) of the Prism
Layers panel at its shipped size then: 1280x1000 viewport, Vite dev host,
engines through the loopback nf-cli bridge, nothing in the page changed. It
was taken before the script drove the blend menu. The blend section scrolls,
so the compositing-space value and "Straight alpha" sit below its fold in
this frame.
