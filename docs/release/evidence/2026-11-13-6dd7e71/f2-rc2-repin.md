# F2: published Tron rc.2 repin

Recorded 2026-11-13. Source checks apply to Forge
`6dd7e713707395be903effd084b2e0ccf18f06a6`, based on master
`fe6cc5a3b3e9fbba72be7bca3e6aa9453b8c256e`.
This completes the local pin/lock preparation for the rc.2 step. Independent
R2 review and candidate-bound installed consumer CI remain pending. F2 also
requires the later stable `1.0.0` repin; Forge v1 cannot ship on this prerelease.

## Published inputs

The source is the actual published
[Tron v1.0.0-rc.2 release](https://github.com/mikevocalz/NYC-Tron-UI/releases/tag/v1.0.0-rc.2),
tagged at `0e09d3be8263b3dbb2eab1a78e5dd66b83b68e44`. The upstream release
[run 43522767083](https://github.com/mikevocalz/NYC-Tron-UI/actions/runs/43522767083)
completed successfully on attempt 2. The integrator supplied the downloaded
published bytes and their independently reviewed release verification. This
repin independently re-hashed all seven consumed asset downloads with both
existing pin verifiers.

The original published sixteen-archive manifest is retained as
[`upstream-SHA256SUMS`](upstream-SHA256SUMS). Its SHA-256 is
`3a44d1bc5b50df8de783010badaf543cac6495fd746d8acd333b1e0be197d3e7`.
[`upstream-published-inputs.json`](upstream-published-inputs.json) records the
release/run identity, seven asset IDs/URLs, byte counts, versions, SHA-256
and computed SHA-512 values. Actual archive package names, private flags and
versions were inspected before the pin changed. The earlier PR #77 candidate
packet was not used as the source of release bytes or hashes.

## Change and graph boundary

`tooling/nyc-tron.json` now records the rc.2 tag, full source commit,
checksum-manifest URL and, for every consumed package, the exact rc.2
`version`, `file`, download URL and verified SHA-256. All **26 install-section
references in fourteen manifests** move together, preserving dev-only versus
runtime dependency sections. Forge still consumes seven upstream packages.

Both locks were regenerated with pnpm **12.18.0** using `--lockfile-only
--ignore-scripts --no-frozen-lockfile`. No `node_modules` dependency installation
or native build ran. The package-manager document and the complete dependency
document of each multi-document YAML lock were parsed separately. Inspecting
only the first document would miss the application graph.

| Check | Root lock | Native-cadence lock |
| --- | ---: | ---: |
| YAML documents parsed | 2 | 2 |
| Bootstrap package records, unchanged | 15 | 15 |
| Application package records, before → after | 774 → 774 | 716 → 716 |
| Application snapshots, before → after | 774 → 774 | 716 → 716 |
| Non-Tron package records/snapshots | Exactly unchanged | Exactly unchanged |
| Tron SHA-512 integrity versus published bytes | Matches every entry | Matches every entry |

Importer and snapshot differences are confined to Tron release URLs and their
Tron peer-context identities. Their remaining keys/values compare equal. The
Tron package metadata differences are the expected internal peer versions
`^1.0.0-rc.1` → `^1.0.0-rc.2` and UI's already published gesture-handler peer
floor `>=3.4.0 <4` → `>=3.3.0 <4`. Each was compared with the actual archive's
manifest. No third-party version, patch policy, ABI pin or Forge public API
changed in this repin.

The complete parsed comparison is in
[`lock-graph-comparison.json`](lock-graph-comparison.json). Its executable
[`verify-lock-graph.py`](verify-lock-graph.py) uses Ruby/Psych to parse both
YAML documents, compares non-Tron records exactly, checks normalized Tron
URL/context-only edges, and computes SHA-512 from supplied published archives.
The durable script was replayed and produced the same report. Example:

```sh
python3 docs/release/evidence/2026-11-13-6dd7e71/verify-lock-graph.py \
  /path/to/forge-checkout /path/to/verified-published-archives /path/to/scratch
```

Root Forge version `0.0.0`, its own `1.0.0-rc.1` readiness/F9 contract,
`native/persona/nitro/pnpm-lock.yaml`, workspace/patch settings, compatibility
record and both v1 validator files were compared with the base and are
unchanged. The Splice pin test now reads the central pin instead of asserting
the old literal URL, following the other consumer suites. The active pin
documentation and AGENTS release pointer were refreshed; historical checkpoints
retain their versions. Stale comments about URL tarballs having no integrity
were corrected: these pnpm 12 locks retain SHA-512 in addition to the release
SHA-256 check. No validator requirement was relaxed.

## Disk-bound execution

Each lock command required at least **10,100,000,000 free bytes** before
starting: the owner's 10,000,000,000-byte floor plus 100,000,000 bytes estimated
headroom. A one-second monitor would terminate the command if observed free
space dropped below the owner's floor. Both commands exited 0. The first npx
bootstrap used more space than the headroom estimate; the actual measured
space nevertheless remained above the floor throughout the observed checks.

| Command | Before bytes | Minimum during polling | After bytes |
| --- | ---: | ---: | ---: |
| Root lockfile-only | 10,516,353,024 | 10,223,898,624 | 10,219,991,040 |
| Native-cadence lockfile-only | 10,187,079,680 | 10,180,194,304 | 10,178,445,312 |

The minimum measured value including the final checks was **10,178,445,312
bytes**. Raw command outputs and disk records are retained in the two
`*-lockfile-only.log` and `*-lockfile-only-result.json` pairs. No physical
iPhone, established window contract or platform configuration was touched.

## Checks actually run

| Command/check | Actual result | Output |
| --- | --- | --- |
| `node tooling/verify-nyc-tron-pin.mjs --download` | 26 manifest references match; release assets re-hashed | `pin-download.log` |
| `node tooling/verify-nyc-tron.mjs` | Seven packages pinned, used and verified | `pin-used-packages.log` |
| Node config/autolinking/v1 gate tests | 18 passed, 0 failed, 0 skipped | `source-tests.log` |
| Forge prerelease readiness | `candidate`; 0/9 gates passed; no status changed by the checker | `readiness.log` |
| Complete parsed graph and actual asset SHA-512 comparison | Passed; bounded delta above | `lock-graph-comparison.json` |
| `git diff --check` | Exit 0, no output | No text emitted |

The eighteen tests ran with Node `v26.13.0`:

```sh
node --test tooling/lab-metro-config.test.cjs \
  tooling/native-cadence-autolinking.test.mjs tooling/validate-v1.test.mjs
```

These tests check Metro/dev-link isolation, native source-link ownership and
gate record semantics. They do not typecheck the Splice assignments or run
Forge engine/UI consumers. The pin test's TypeScript changes and all wired
consumer contracts still require installed-dependency CI.

NOT RUN locally: frozen dependency installation, `verify-released-ui.mjs`,
package/app TypeScript suites, Vitest consumer/engine suites, studio-preview
rendering, Metro export/singleton execution and iOS/Android native compile or
runtime. Existing CI lanes must run against the pushed candidate; source checks
or successful upstream consumer tests do not stand in for Forge results.

## Skills, review and rollback

Applied engineering `deploy-checklist`/`documentation`, React Native best
practices and NYC-MON no-ai-slop; read the current Forge AGENTS and existing
pin/consumer contracts. Their outputs are the bounded change, actual result
table, graph/byte identities and rollback conditions here. No native contract,
module spec or engine operation changed, so no native generator result is
claimed. This implementation agent is not the independent R2 reviewer.

Keep F2 in progress until the remaining rc.2 consumer validation is reviewed,
and retain the separate requirement to repin to stable `1.0.0`. Stop adoption
on a release checksum/identity mismatch, a non-cohort graph change or a failing
wired contract. Preserve upstream tags/assets. If a merged Forge repin must
be rolled back, revert its pin/manifests/locks together to the previously
verified cohort through a reviewed PR. Corrected upstream bytes need a new
immutable version. No stable release or distribution approval is claimed here.
