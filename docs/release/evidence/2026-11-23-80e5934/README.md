# 2026-11-23, 80e5934: B-11 Layers panel capture

`f3-b11-layers-panel.png` is a headless Chromium 1243 capture (Playwright,
`apps/studio-preview/verify-prism-blend.mjs`) of the Prism Layers panel at its
shipped size: 1280x1000 viewport, Vite dev host, engines through the loopback
nf-cli bridge, nothing in the page changed. It was taken before the script
drove the blend menu. The blend section scrolls, so the compositing-space
value and "Straight alpha" sit below its fold in this frame.
