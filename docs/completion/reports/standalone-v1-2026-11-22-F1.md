# F1: component-program adoption

Prepared 2026-11-23 UTC. Status: in-progress pending owner review and merge.
Implementer: `forge_ledger`; independent reviewer: `baseline_audit`.
The [independent review](standalone-v1-2026-11-22-F1-review.md) passed with no
blocking findings. The lead records the commit and draft PR at publication. No release or merge
is performed by this slice.

## Reconciliation before adoption

Compared Forge `dab27e177f05a747f2a234e3892f62e2f7b8c28b` with Tron
`0e09d3be8263b3dbb2eab1a78e5dd66b83b68e44` (`v1.0.0-rc.2`). Both frozen
TSV files are byte-identical, SHA256
`a1fd6593a84f899dc2946e6337fde7c59897607701516b6d64732d51d44b75db`.
The 341 canonical IDs, names and order match.

The status fields differ in purpose and value. Tron has `acceptance`, with
341 unverified canonical rows. Forge has `completion`: 35 unverified,
274 in-progress and 32 blocked. The move preserves both records separately;
no value is normalized or promoted. Tron's five additional window-control
rows, W-01 through W-05, remain separate from the frozen canonical count and
remain unverified. Their IDs, names, implementation reviews and evidence
are preserved.

## Adopted records and validator

Forge now carries `docs/completion/library-progress.json`, while its existing
`components.json` remains byte-for-byte unchanged. The source pin records the
original ledger, validator and test SHA256 values. Every direct Tron source,
evidence and decision location is an immutable GitHub blob URL at the source
commit. External-owner repository/revision/path tuples remain unchanged.
The canonical-plan link points to Forge's inspected baseline commit.

The migrated ledger can reconstruct the exact original Tron ledger bytes by
reversing only these location changes. A regression test verifies its original
SHA256, all row fields and acceptance values. That test records this handoff;
future owner-authorized acceptance work must retain this immutable provenance
and update the program deliberately, rather than treating the migration as
acceptance evidence.

`tooling/verify-component-program.mjs` is ported from the pinned Tron validator.
It validates Forge's frozen baseline and the retained eight-platform rules.
Source candidates, public exports, evidence and addition decisions resolve
against a clean checkout of the pinned Tron revision, not paths in Forge.
The production command checks the checkout's Git root/HEAD, its clean status,
three recorded source checksums and every referenced file's Git blob identity.
An existing ignored or untracked file cannot stand in for a pinned source blob.
Package export manifests are checked against the same tree. The port retains
the original MIT notice in `tooling/licenses/NYC-Tron-UI-MIT.txt`.

The existing completion-plan workflow gains a separate job that checks out the
immutable Tron source, runs the adopted validator tests and validates the ledger.
It uses read-only repository permissions and disables persisted checkout
credentials. Source/fixture tests are local checks; the new GitHub Actions job
has not yet run on the proposed commit.

## Checks and evidence

Complete command output and exit codes are in
[the verification log](standalone-v1-2026-11-22-F1-checks.txt).

- Adopted-program tests: 20 passed. These include the ported acceptance rules,
  URL safety, exact migration preservation, source pin/checkout provenance,
  missing and altered blobs, independent public export maps, and CI pin
  agreement.
- Production validator against the clean pinned source: passed, with 332 Tron
  implementations, nine pinned external implementations, zero accepted canonical
  rows, and five unverified additions.
- Existing Forge completion validator: passed; seven existing regression tests
  passed.
- `git diff --check`: passed. Existing `components.json`, release pin and F7
  readiness record have no diff.

The 774 direct path references are pinned and resolve against their recorded
Git tree. Their existence does not certify the claims in their contents.
Nested hyperlinks inside historical reports and runtime acceptance are not
checked by this validator. The nine externally owned rows' source paths retain their
existing immutable tuples; external content validation remains separately
attributed to the handoff auditor.

## Skills and independent review

Applied `no-ai-slop` from NYC-MON and its evaluation checklist. Output: this
report states source resolution, tests and pending CI separately; it preserves
the distinct status fields, gives exact counts and revisions, and claims no
device or release acceptance.

Applied `coding-standards` to the Node tooling. Output: the adoption transformer
clones its input, the CLI accepts an explicit source checkout, URL/path checks
fail closed, errors return a nonzero exit, and regression tests cover changed
inputs and forged provenance. No runtime dependencies or React state were added.
The original validator's accumulation style is retained for a reviewable port.

Independent `code-review` and the handoff auditor's adopted-row check passed:
see [the review output](standalone-v1-2026-11-22-F1-review.md). The reviewer
reproduced the tests and validator checks, reconstructed the original ledger
bytes, and verified both status records remained unchanged.
No user-facing app screen or component presentation is added, so screen design,
Mobbin references and WCAG UI audits are NOT RUN for F1. No native code is changed.

## Remaining work

F2 must connect this ownership to F7 alongside T4's pointer/handoff changes.
Tron's old ledger and validator remain untouched by this additive F1 slice.
Forge stays pinned to rc.2. No acceptance, implementation-review, distribution
approval, public export or native configuration is changed.

Owner decisions remain the public professional-control paths, complete
stable/preview list, npm distribution and any future change to Forge's eight
platforms. This adoption keeps existing paths, distribution and platform rules.
New CI, native/browser/hardware acceptance, T4 removal/pointer, F2 integration
and rc.3 pin verification remain NOT RUN by this slice.
