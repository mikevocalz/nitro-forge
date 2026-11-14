# F1 routine dependency and evidence slice — 2026-11-13

Base: `dab27e177f05a747f2a234e3892f62e2f7b8c28b`. This packet records the
modified working tree through exact input SHA256 values in
`dated-freshness.json`; its baseCommit alone is not the changed-source identity.
F1 remains **in-progress**, with zero v1 gates passed. No native startup, full
suite or new advisory-database result is claimed by this local packet.

## Graph changes and dated disposition

| Dependency | Before | Candidate | Admission evidence |
|---|---|---|---|
| Expo (four admitted manifests; both locks) | 58.0.24 | 58.0.25 | Actual published package dependency maps are identical. Both CLI entrypoints delegate to @expo/cli; core remains58.1.0/macros 0.33.0. Preserve the Xcode macro workaround. |
| expo-dev-client | 58.0.19 | 58.0.20 | Published patch changes its dev-launcher floor from ~58.0.19 to ~58.0.20; Expo peer remains `*`; SDK 58 family retained. Actual frozen/native checks run in CI. |
| Playwright / core | 1.62.1 | 1.65.1 | Published package retains Node>=20 and exact matching core. Current render jobs use Node 26 and install the selected browser. No old screenshot is relabeled as this browser build. |
| adaptive-layout @types/node floor | ^26.6.5 | ^26.6.6 | Matches admitted Node 26 and existing resolved26.6.6; no locked package version changed. |
| media-ui @types/react floor | ^19.2.0 | ^19.3.0 | Matches React 19.3 family and existing resolved19.3.0; this type-only declaration does not prove native renderer startup. |
| enhanced-resolve override | 5.26.1 | 5.27.0 | Published same-major package retains Node>=10.13 and identical tapable/graceful-fs ranges. Full build/typecheck/render verification remains CI work. |

`tooling-admission-source.json` records actual metadata and archive verification.
The official published RN 0.88.1 template pins CLI and both platform CLIs20.2.0;
upstream CLI guidance warns against independent updates. The CLI 21 README matrix
is stale rather than evidence of another RN lane. Retain coherent20.2.0 until
RN 0.88/SPM compatibility is proved; do not infer a CLI 21/RN 0.89 mapping.

`dated-freshness.json` covers **all 32 tracked package manifests**, both workspace
override files, dependency/dev/optional/peer declarations, root and isolated
packageManager pins, the linked Persona package and vendored/URL sources:
**281 declarations,73 queried registry names, zero unclassified items**. Peer
ranges remain compatibility contracts rather than being raised to latest and
silently pruning supported consumers. Nitro's exact nightly 136 trio is compared
to the official published v1 channel, separately from stable0.x npm tags.
Source/version choices are frozen as of 2026-11-13 local; future latest tags need a
new dated review. The generic older Node audit omitted native/example manifests,
peer dependencies and isolated overrides; the new collector includes them.

The actual `pnpm outdated -r --format json` commands both returned **exit1**:
root lists Skia 3.9.1→3.10.1, WebGPU 0.21.0→0.21.4 and SVG15.16.0→15.16.1;
isolated native lists the three CLI 20.2→21 declarations. They are retained as
nonzero freshness output, not passed checks. The native trio is isolated here
because a separate stacked trial will integrate/test it, not because lack of
proof is a final F1 hold. `native-hold-source.json` binds the actual archives:
current Skia/WebGPU use Dawn 157.1.0; latest3.10.1/0.21.4 both use158.0.0, and
WebGPU's actual Swift package checks shared Dawn identity. Latest SVG ships its
own Package.swift while the local15.16.0 patch creates that file. The trial must
replace obsolete patch integration and prove iOS/SPM+Android support.

Unchanged source-backed holds: vendored video generated with nightly 120 despite
the nightly 136 runtime override; Metro0.87.2 family with its reviewed file-map
port; Rust quick-xml/lopdf/zip engine migrations and their seven existing advisory
return conditions; documented major crate migrations. No ignore was added.
The Expo macro workaround is independent of those Rust advisories; there is no
identified Expo npm advisory here. Actual0.33/0.35 macro Package.swift files are
identical, and Expo 58.0.25 still resolves core 58.1.0/macros 0.33.0. No new Xcode
reproduction or claim that every later release fails is made.

React/DOM19.3.1 and RN 0.88.1 remain unchanged per§5. RN's published renderer
version/guard and actual startup require separate evidence; permissive package
peers and successful native compilation alone do not prove that startup works.
No renderer guard was bypassed and no silent React downgrade was made.

## Exact lock verification and local commands

Managed pnpm12.18.0 ran via its existing Node entrypoint (the top-level shim
failed macOS ENOEXEC); no npx bootstrap, node_modules install or local build.
Both bounded lockfile-only commands returned0, with a10,000,000,000-byte floor
and200MB projected buffer. Minimum observed across initial and final operations:
**10,243,014,656bytes**. Exact commands, exits and measurements are retained.

Both lockfiles contain two YAML documents. A real Ruby/Psych parser inspected
both, not only the15-entry bootstrap document. The complete graph comparison:

- Root active graph774→773 packages/snapshots: six package replacements,
  removal of Playwright's obsolete optional fsevents2.3.2, six existing semver
  edges deduplicated7.8.5→7.8.6 and regenerated peer identity hashes.
- Isolated native active graph716→716: Expo archive replacement and regenerated
  peer identity hashes only. Both bootstrap documents are byte/structure-equivalent.
- Every other package entry/edge matches after the enumerated changes. Every
  replaced package's locked SHA512 matches actual published metadata. Tron
  archive SHA512, Nitro 136, RN 0.88.1 and Cargo.lock are unchanged.

`verified-complete-graph.json`, `lock-graph-delta.json` and
`lock-new-package-metadata.json` retain the full comparison and exact edge list.
`source-tests.log`: **29 Node checks passed**, zero failed/skipped. Candidate
validator:0/9 gates, no status changed. Actionlint and YAML parsing passed for
all four edited/new workflows. `git diff --check` passed.

NOT RUN locally: full typecheck/build/package suites, Rust workspace tests,
Nitrogen generation, fresh cargo audit/database fetch, native build/startup,
physical devices or new browser captures. Existing older source receipts remain
unchanged. F2 and F6 gates, app windows/orientation and public APIs are unchanged.

## CI collection and original 22 coverage

New `f1-evidence.yml` records exact checkout/toolchain, raw stdout/stderr, actual
command arguments/exits and artifact metadata for full forced typecheck/build,
package tasks at concurrency4, locked Rust workspace, Ignition and Persona
generation with clean diffs, a fresh explicitly identified advisory database
revision and existing-ignore audit, both actual outdated commands, full declared
freshness inventory and online official Nitro release check. Required command
failures fail their job. Freshness exit1 remains explicitly review-required;
its full output must be reviewed for outdated findings versus command errors.
No freshness result or artifact creates a gate signature.

Original22 remain the acceptance inventory; current workflows are now26 after
this additional evidence lane. The two pure Node lanes now expose manual
workflow_dispatch. Observer manual dispatch defaults to read-only validation;
its scheduled master writer is preserved, while manual writes need explicit
`propose_update=true`. The writer is intentionally NOT RUN in the read-only
matrix and must not be called passed. No writer or CI dispatch was invoked here.

At one reviewed final head, rerun/reconcile all original 22 plus current added
checks. Adaptive layout, completion ledger and Persona native core already
support dispatch; they were absent from #85, as were observer/precision/persona
continuity. The added dispatches remove the two pure Node trigger gaps, without
manufactured path-change commits. Full source identities, job-level conditional
skips (including optional online jobs), native runtime limits and independent
R2 signoff remain required before any F1 pass. A later compatible Cargo update
transcript and the stacked native trial must be reconciled too. F6 consumer
integration must adopt the reviewed final graph separately.
