# F1 receipt: cargo audit

Date: 2026-11-13
Base commit: 93783680d7bf9a757170dc1cbec93c2c476c8e34 (master). The audit run's PR head and checked-out merge revision are recorded below.
Gate: F1, acceptance line "§5 table done" row "Rust crates": `cargo update`, `cargo audit`, full `cargo test --locked --workspace`.

## What this receipt covers

Only the `cargo audit` row. The F1 gate stays not-started: the other rows and the reviewer signature are outside this PR.

## Configuration

- Job: `.github/workflows/cargo-audit.yml`, runs `cargo audit --deny warnings` with cargo-audit 0.23.0.
- Ignores: `.cargo/audit.toml`, exactly RUSTSEC-2026-0187, -0194, -0195, -0367, -0368, -0369, -0429. Each has a reason and a return condition.
- Source of the seven: "Held" table in `docs/release/RELEASE_TRAIN.md` (quick-xml, lopdf, zip).

## Result

CI run 43387309013 (https://github.com/mikevocalz/nitro-forge/actions/runs/43387309013), job `cargo-audit`, PR #83 head `a2fd4cc4845389fe3ecb3fadbb3518b217e3c204`: success, 8s. The checkout log records merge revision `19ddd7d30db782058a48da01caf1e98c87bc609b` (that head merged into the base above). The log shows 1490 advisories loaded and Cargo.lock scanned (185 crate dependencies).

## Source check for the zip ignore rationale

Checked on 2026-11-13 at PR head `3d4cdec6b7ed124604312ba976422d6a649e66a1`, using all 181 tracked `.rs` files from that revision. This wording-only follow-up changes no Rust source or audit configuration.

```sh
rg -n '\bextract\s*\(' --glob '*.rs' .
```

Result: no matches, exit 1. No direct `extract(...)` call appeared in the tracked Rust sources; Tally and Quill's archive readers were inspected separately below. It does not audit dependency internals or prove the ignored advisories harmless.

```sh
rg -n 'ZipArchive|ZipStreamReader|by_name|\.extract' packages/tally/rust packages/quill/rust
```

The import readers construct `zip::ZipArchive` and read entries with `by_name`: Tally `packages/tally/rust/src/xlsx.rs:845–849,1452–1471`; Quill `packages/quill/rust/src/docx.rs:620–695`. The remaining matches are tests. No `ZipStreamReader` or `.extract` match appeared.

Local `cargo audit`: NOT RUN (cargo-audit is not installed; no local build was attempted).
