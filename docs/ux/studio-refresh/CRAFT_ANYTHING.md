# Craft Anything inspection

User-requested tool: https://github.com/storytold/craft-anything.

Official release v0.3.0, source tag
`e6280b5dc518b9f3266c82d794a4e2f0367d9a53`, inspected November 3, 2026.
The macOS universal CLI archive was downloaded from the official release;
SHA-256 matched its published GitHub asset digest:
`1418b98291630713670a4c4ccfa9048f2e2ef358be10cc9a8df50f0ff5ae417e`.
The executable and bundled license notices stay in ignored
`artifacts/craft-anything/tool`; nothing was installed globally.

This is an inspection tool, not a replacement component library. Studio keeps
NYC's semantic/native UI, Zustand, separate application sessions and its real
Rust document engines. No nested coding agent or autonomous rebuild was started.
No agent configuration, account, secret or native window settings were changed.

The CLI ran `--help`, `commands` and `capabilities`. Its own MCP server supplies
the persistent browser session needed for `web_site_open` followed by
`web_site_capture`; separate CLI invocations do not share that browser. Captures
use a fresh private browser profile in Clean room mode, with rendered evidence
at 390, 768 and 1440 CSS pixels. Raw evidence remains under ignored
`artifacts/craft-anything/inspection`.

A host CSS correction puts explicit important semantic role overrides in
Tailwind's base layer. Important layer precedence runs in reverse, so these
rules override canonical utility defaults for text colours and container rows.
The production build passed after this correction. The first actual captures then exposed black helper/footer text and a compact
hide rule that relied on `<span>` output. Explicit semantic-role classes now
style those elements independently of the canonical component's rendered tag.

## Results

- Studio launcher: first capture completed at 390, 768 and 1440. It identified
  the helper/footer defect described above.
- Launcher final recapture: all three images inspected by the main agent and
  continued design critic. Helper/footer contrast is corrected, the helper is
  hidden at 390, and one-/two-column directories fit the supplied widths.
  Evidence images: `docs/ux/evidence/craft-launcher-{390,768,1440}.png`.
- Affinity official iPad page: capture completed at all three widths, bounded
  to the first 1800px in height; the desktop image was inspected. Its marketing
  layout is context for the product imagery, not Studio's application shell.
- Prism: capture completed at all three widths; all three images inspected.
  Compact bottom navigation and wide toolrail layouts render, with the real
  empty artboard. This is a visual baseline, not a new interaction test.
- Quill: `web_site_open` timed out. No successful capture or file-picker check
  is claimed for this run.

Native runtime, physical devices, screen readers, full OS/browser matrix and
file-picker interaction remain outside this capture proof. Typecheck and
production build passed after the fixes (the existing large-chunk warning
remains). Prior engine tests and DOCX integration results are recorded separately
in ROSTER.md.

Evidence identifiers from Craft Anything:

- Launcher final: `ev_62031c3553905e31319b5f0740e770c9650ba04b62e6875d544b2c09f831ea73`
- Prism: `ev_54c6cda085b2dbd7a6337e80a8891313f3a00180614ef1ad686d8948bf348259`
- Affinity: `ev_a0a34b45bb4cf9d4d1cad9ea3b27d495c9981efeeaf98325fb67037d31c0950a`

The wrapper closes its owned private browser before stopping the MCP process.
These are bounded captures and visual review, not a computed Affinity likeness
score or interactive editor acceptance suite.
