# F1 receipt: cargo audit

Date: 2026-11-13
Base commit: 93783680d7bf9a757170dc1cbec93c2c476c8e34 (master). The PR head commit is the one CI ran on; see below.
Gate: F1, acceptance line "§5 table done" row "Rust crates": `cargo update`, `cargo audit`, full `cargo test --locked --workspace`.

## What this receipt covers

Only the `cargo audit` row. The F1 gate stays not-started: the other rows and the reviewer signature are outside this PR.

## Configuration

- Job: `.github/workflows/cargo-audit.yml`, runs `cargo audit --deny warnings` with cargo-audit 0.23.0.
- Ignores: `.cargo/audit.toml`, exactly RUSTSEC-2026-0187, -0194, -0195, -0367, -0368, -0369, -0429. Each has a reason and a return condition.
- Source of the seven: "Held" table in `docs/release/RELEASE_TRAIN.md` (quick-xml, lopdf, zip).

## Result

CI run 43387309013 (https://github.com/mikevocalz/nitro-forge/actions/runs/43387309013), job `cargo-audit`, PR #83 head at the time of the run: success, 8s. The log shows 1490 advisories loaded and Cargo.lock scanned (185 crate dependencies). The reviewer has not inspected it yet.

Local run: NOT RUN (no cargo-audit installed; the disk budget rules out building it).
