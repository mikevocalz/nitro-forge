# Changelog

All notable changes to Nitro-Forge are recorded here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Release
versions will follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

No version has been released. Everything below is on `master` and counts
toward v1. The v1 gates and their state are in
[docs/release/v1-readiness.json](docs/release/v1-readiness.json); most are not
passed yet.

## [Unreleased]

### Added

- A README for every public package, each with an install section, entry
  points and a usage example that CI runs against the real engine
  (`pnpm run test:readme-examples`, `.github/workflows/readme-examples.yml`).
- `CONTRIBUTING.md`, `SECURITY.md`, this changelog and `.github/CODEOWNERS`.
- `@nitro-forge/editor-controls`: the editor controls moved unchanged from
  NYC-Tron UI's `components/forge` into Forge, and every Forge package and app
  now imports them from here (#95). They compile under Forge's strict
  TypeScript flags (#96).
- The v1 gate file (F1 to F9) and `pnpm run validate:v1`, which fails a stable
  release until every gate has evidence, a full commit and a reviewer.
- Brand manifests for every app, one icon family for the suite and each studio,
  and a rebrand test. `apps/example` builds the suite or one studio with
  `FORGE_BRAND=<id>` (#79).
- A `cargo audit --deny warnings` CI job (#83).
- Tally accepts a pivot filter with no values as All. Cadence `detectBeats`
  takes a sensitivity and returns tick markers (#81).

### Changed

- Dependency baseline: Nitro `1.0.0-alpha.nightly.136.gdb81de61bd32`, pnpm
  12.18.0, Expo 58.0.24.
- Forge consumers pin NYC-Tron UI `v1.0.0-rc.2` release tarballs, checked
  against their published SHA-256 and SHA-512 (#85). A patch adds the twenty
  export-map entries rc.2 lacks until the next Tron release.
- The root README lists the release set, the deferred packages, the supporting
  packages and the apps, and says that `createNitroHost()` is native only;
  Node code uses `CliHost` from `@nitro-forge/ignition/cli`.

### Fixed

- `apps/studio-preview` renders on the web again (#82).

### Security

- Seven advisories are held, each with a reason and a removal condition, in
  [`.cargo/audit.toml`](.cargo/audit.toml): two in quick-xml 0.37.5, one in
  lopdf 0.36.0 and four in zip 2.6.1. Any other advisory fails CI.

[Unreleased]: https://github.com/mikevocalz/nitro-forge/commits/master
