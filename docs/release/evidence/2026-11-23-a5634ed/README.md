# 2026-11-23, a5634ed: B-11 Layers panel with six layers

Both PNGs are full-viewport screenshots written by
`apps/studio-preview/verify-prism-blend.mjs` and not edited afterwards. They
show the Prism Layers panel after decision D7: blend mode in Tron's
`MenuButton`, "Straight alpha" as text, and Forge's opacity `PrecisionScrubber`.

How they were made, on Linux with node v22.23.5 and pnpm 12.18.0, at commit
`a5634ed`:

```bash
cargo build --locked -p nf-cli
cd apps/studio-preview
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome \
  node verify-prism-blend.mjs ../../docs/release/evidence/2026-11-23-a5634ed
```

The script starts the Vite dev host (engines through the loopback nf-cli
bridge), opens Prism in headless Chromium 1243 with a fresh browser context,
opens the Layers panel from the toolbar if it starts closed, and presses the
Rectangle tool five times, so the document has Layer 1 and Rectangle 2 to 6
and Rectangle 6 is selected. It moves the mouse to (0, 0) and takes the
screenshot before it checks anything or touches the blend menu or the
scrubber. Nothing in the page is changed.

- `f3-b11-layers-six-1280x1000.png`: 1280x1000 viewport. The editor is
  1228x552; the panel is 524 px tall with a 208 px layer list, and the head
  above the list measures 316 px against the 320 px budget in
  `prism-layout.ts`.
- `f3-b11-layers-six-1024x768.png`: 1024x768 viewport. The editor is only
  972x320, so the panel (304 px) cannot hold the head and the rows. The blend
  menu and the whole opacity scrubber are on screen with nothing scrolled;
  the panel body scrolls, head first, and the first layer row shows below the
  scrubber.

The same run passed every check in the script, including forced colours
(emulated) and two presses of "−" from 100 % to 98 %. Those states have no
capture.
