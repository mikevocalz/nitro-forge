# Security policy

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and
choose **Report a vulnerability**. Do not open a public issue, pull request or
discussion with the details.

If that button is not there, open a public issue that asks for a private
contact and leave every detail out of it.

Include:

- the package or crate and the commit you tested
- a minimal input that triggers the problem (a file, a snapshot or a sequence
  of ops), or steps to build one
- what happens (crash, hang, memory growth, wrong output, data reaching the
  wrong place) and what you expected

## Supported versions

No version has been released yet. Until v1 ships, fixes land on `master` only.
After that, the latest release gets security fixes.

## Scope

Anything that reads bytes a user or another app supplied is in scope. That
includes:

| Area | Code |
| --- | --- |
| Spreadsheet import: XLSX, CSV, TSV | `tally-engine` (`importXlsx`, `importCsv`, `importTsv`) |
| Word import: DOCX | `quill-engine` (`importDocx`) |
| PDF open, decryption and annotations | `folio-engine` (lopdf) |
| PDF page rendering | `rust/folio-render` (pdfium) |
| Camera RAW probing and decoding | `rust/raw-decode`, `rust/nf-raw` (LibRaw), `@nitro-forge/photo/raw` |
| Snapshot restore | `ignition-core` NFD1 envelope decoding and every engine's `restore` |
| Command input | `nf-cli` JSON-lines protocol, `nf-sys` C ABI |
| Network service | `@nitro-forge/collaboration-server` |

Out of scope:

- NYC-Tron UI controls. Report those to the NYC-Tron UI repository.
- A vulnerability in a third-party crate or package that Forge cannot reach.
  Report it upstream; if Forge does reach it, report it here too.

## Known advisories

`cargo audit --deny warnings` runs in CI
(`.github/workflows/cargo-audit.yml`). The advisories it is told to ignore
are listed, each with its reason and the change that removes it, in
[`.cargo/audit.toml`](.cargo/audit.toml). They cover quick-xml 0.37.5 (used
by the XLSX and DOCX readers), lopdf 0.36.0 and zip 2.6.1. Any other advisory
fails the job. The same held dependencies are recorded in
[docs/release/RELEASE_TRAIN.md](docs/release/RELEASE_TRAIN.md).
