# F6 refresh: master merge and iOS timeout review (2026-11-28)

This note records bringing PR #88 up to date with master. It is not an F6 pass.
The gate stays `in-progress` until fresh CI on the merged source, independent
R2 source/runtime/visual/license review and final F1 graph reconciliation are
done.

## Merge

Branch `feat/f6-clean-consumer-20261113` at `f1b5b48382f385d255904ad0f5411255a4835365`
merged master `e44e715c7e5adf2e5f0b6690f288e84afb83cdf2` (#95 editor controls,
#96 strict TypeScript) as `cafeefc8f23abd9748e89ff045c255d77c06ca1c`.

Six `package.json` files conflicted: cadence, folio, pitch, quill, splice and
tally. Each resolution keeps master's `@nitro-forge/editor-controls`
`workspace:*` dev dependency and this branch's `files` allowlist and `license`
field. No other file conflicted. `pnpm-lock.yaml` is master's; the branch never
changed it.

The clean consumer does not need the editor controls. `@nitro-forge/editor-controls`
is `private`, so `pack-candidate.mjs` cannot pack it, and no file under the
`src/` of the eight packed packages imports it (it appears only in `contracts/`
and tests, which are outside each `files` allowlist). The consumer fixture uses
only `@nyc-tron/ui/components/Button` and `SegmentedControl` from the pinned
rc.2 release, never `@nyc-tron/ui/components/forge/*`. Master's Nitro
`1.0.0-alpha.nightly.138` pin (draft PR #97) is not merged and is not included;
the candidate stays on nightly.136.

## iOS timeout: cause and current state

The iOS timeout was at source `722a2fef3746c96817388aa3380f83619325d710`,
[run 43598783276](https://github.com/mikevocalz/nitro-forge/actions/runs/43598783276),
job 132461833658. Its log ends with
`maestro failed: spawnSync .../maestro ETIMEDOUT`: the first full flow hit
run.mjs's 1,200,000 ms Maestro process deadline during Quill's redo capture.

The cause was the flow, not the simulator, build, install or a missing testID.
Re-reading the retained native log
([packet](../2026-11-14-722a2fe-ios-picker-cost-timeout/README.md)) per command:

| Command kind (pass 1, 722a2fe) | Count | Total ms | Scroll tries |
| --- | --- | --- | --- |
| Centered UP scroll to `f6-studio` (picker) | 13 | 210,572 | 6 every time |
| Centered DOWN scroll to `f6-result` (captures) | 39 | 166,594 | 1 to 2, twice 6 |
| Plain UP scroll to `f6-selected` | 79 | 184,514 | 1 |

Every picker centering made Maestro's maximum six attempts and ended where it
started (y106), because the picker sits at the top scroll boundary and cannot
be centered. That cost 3.5 minutes and pushed the pass over the deadline.

Commit `f1b5b48` replaced picker centering with a bounded UP scroll to the
`Forge clean consumer` heading, an exact heading assertion, then the original
picker scroll, tap and selected/closed assertion. No assertion, capture guard,
engine action, second pass or deadline was removed or raised.

At `f1b5b48`, [run 43603701341](https://github.com/mikevocalz/nitro-forge/actions/runs/43603701341)
iOS job 132476868100 step "Execute installed iOS Release app through XCTest OS
touches" concluded `success` (14:39:24 to 15:22:44 UTC). run.mjs throws on any
flow failure, so a zero exit means the picker and both full flows returned.
Android job 132476868068 also succeeded, and all 13 workflows at that head
succeeded. These job results were read from the GitHub API on 2026-11-28.

The PR description reports iOS full flows of 1,074,232 ms and 866,111 ms. I
could not re-check those numbers or the artifact contents: downloading run
artifacts from this environment was refused by the network proxy. If they are
right, pass 1 used 90% of the deadline. The remaining boundary-centering cost
is in result captures (twice 6 tries in the old log), and the 208 s gap
between pass 1 and pass 2 is not explained by anything I could read. Both are
flake risks to watch on the next iOS run, not proven causes.

## Local checks at `cafeefc` (Linux, no Xcode or Android SDK)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` (pnpm 12.18.0) | passed; lock unchanged |
| `cargo build --locked -p nf-cli` | passed |
| `cargo test --locked -p tally-engine` | 234 passed |
| `node tooling/verify-nyc-tron-pin.mjs` | passed; no editor-control imports from Tron in 1271 files |
| `node --test tooling/validate-v1.test.mjs` | 14/14 passed |
| CI source job tests (`archive-boundaries`, `withForge.node.cjs`, `native-ui/*.test.mjs`) | 65/65 passed with `NODE_PATH` unset and `TMPDIR` on tmpfs |
| `node tooling/release/check-package-boundaries.mjs` | passed |
| Stage the eight packages as `pack-candidate.mjs` does, then its `checkExports` and `checkSourceClosure` | all eight passed |
| `pnpm --filter @nitro-forge/editor-controls build`, then typecheck of it and the eight packages | passed |
| vitest for the eight packages | all passed; cadence's two WAV export tests timed out at 5 s when eight suites ran at once on 4 CPUs against a debug nf-cli, and passed (47/47) when cadence ran alone |

The first source-test attempt failed three tests for environment reasons: this
sandbox sets `NODE_PATH`, which `consumer-smoke.mjs` correctly refuses, and the
root disk was below the 10 GB floor that `requireDisk` enforces.

Not run here: `pack-candidate.mjs` and `consumer-smoke.mjs` against a real
candidate (they need the Apple xcframework and Android static libraries from
the macOS and NDK producer jobs), Expo prebuild, Xcode/Gradle builds and both
Maestro flows. These need the CI workflow on the merged source.

## Left for F6

- Fresh `Forge clean tarball consumer` run on the merged head, both platforms.
- Independent R2 source, runtime, visual and license review.
- Final F1 graph reconciliation, including the Nitro nightly.138 move in #97.
