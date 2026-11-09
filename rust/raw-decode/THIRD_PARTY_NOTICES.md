# THIRD_PARTY_NOTICES — raw-decode

`raw-decode` is first-party Forge code (MIT, workspace license). It adds
no new third-party dependency of its own: its only non-workspace
dependency is `nf-raw`, which statically links **LibRaw 0.22.3**.

## LibRaw 0.22.3 (via nf-raw) — CDDL-1.0 election

- Source: pinned tarball `LibRaw-0.22.3.tar.gz`, SHA-256
  `789f3c33466210a1a0907f747a97c715d21bbf4af712f257fcbbd90111b227e4`
  (https://www.libraw.org/data/LibRaw-0.22.3.tar.gz); pin matches
  `tooling/raw-prototype/manifest.json`.
- License: dual-licensed **LGPL-2.1-only OR CDDL-1.0**; this project
  elects **CDDL-1.0** (file-level copyleft). Full terms:
  `rust/nf-raw/THIRD_PARTY_NOTICES.md` and the `LICENSE.CDDL` /
  `LICENSE.LGPL` / `COPYRIGHT` files inside the pinned LibRaw tree.
- Any distributed binary containing `raw-decode` also contains
  `libraw_r.a` and must reproduce the CDDL text, LibRaw copyright
  notices, and provide the covered source (or written offer) per CDDL
  §3 — see `docs/completion/reports/P10-raw-product-admission.md`
  §THIRD_PARTY_NOTICES for the release-engineering obligations. The
  CDDL source-offer mechanics for tarball/App Store distribution are
  still an open decision in that record.

## Workspace dependencies

`ignition-core`, `serde`, `serde_json` — MIT/Apache-2.0 workspace and
crates.io dependencies already noticed elsewhere in the repo.
