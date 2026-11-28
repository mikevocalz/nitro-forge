# T4 and F2: paired program handoff

Dated 2026-11-22 (New York), checked 2026-11-23 UTC. Status: in-progress
pending owner review and merge. Implementer: `forge_ledger`; independent
reviewer/handoff auditor: `skill_discovery`. The
[independent review](standalone-v1-2026-11-22-T4-F2-review.md) passed with no
outstanding findings. The lead records both commits and paired draft PRs. No merge, release, pin or acceptance promotion
is performed by this slice.

## Ownership and preserved records

Tron's old `docs/completion/library-progress.json` is now a short pointer to
Forge commit `5902e64d6ad01090f5e9a40f8402ec0cbcb39a71`, where F1 adopted the
program. Its original ledger, frozen baseline, validator and tests remain in
the dated `docs/completion/reports/2026-11-22-forge-program/` source archive in Tron. Existing phase
reports and evidence stay at their original paths. Program/issue-status pages
are explicitly marked historical; current Qt documentation describes a dated
downstream correspondence study, not library scope. The Forge import map remains
a lookup, and accepts both historical paths and adopted immutable source URLs.

Forge's F7 now states that the application program and its per-platform
acceptance belong to Forge. The original baseline has 341 canonical rows,
with five separately counted window-control additions. All eight platform
requirements remain: iOS, Android, web, macOS, Windows, visionOS, Quest and PICO.
F7 points to both ledgers, the validator/CI workflow and the consumer release
pin. New application acceptance must identify that exact release. The adoption
source revision is historical provenance and does not stand in for candidate
runtime evidence. The pin remains `v1.0.0-rc.2`.

The paired [audit output](standalone-v1-2026-11-22-handoff-audit.json) and
[reproducible script](standalone-v1-2026-11-22-handoff-audit.py) establish:

- 341 canonical IDs out and in, plus the same five additions; names, ordering
  and every row field match after reversing only the pinned location changes.
- All 346 acceptance values remain `unverified`. Forge's distinct completion
  values remain 35 unverified, 274 in-progress and 32 blocked.
- All 774 direct references resolve across 452 unique source/evidence paths;
  retained bytes match the original pinned Git tree. No direct link is missing.
- The archived ledger, baseline, validator and tests match their original Git
  bytes. Forge's completion ledger and consumer pin, all gate statuses/review
  fields, and Tron's owner distribution-review record remain unchanged.

The independent preflight's [external-source results](standalone-v1-2026-11-22-external-sources.json)
record resolution of all 29 pinned external source paths using GitHub file
reads. This implementation did not repeat those network reads. Neither direct
file existence nor those responses establish runtime acceptance. Nested links
inside historical reports are not recursively audited here.

## Temporary compatibility boundary

T3 must change the stable validator in its own reviewed PR after T2/T4 merge.
To keep this intermediate branch usable, the former validator path is now a
small compatibility wrapper around the immutable archived code. Release CLI
and Qt analysis read the SHA-256-guarded historical snapshot rather than trying
to interpret the moved-ledger pointer. The wrapper supplies the current source
root, preserving the existing release policy exactly; it is explicitly removed
from release readiness by T3.

The original root baseline remains a historical compatibility input for that
intermediate policy and its fixture tests. No row changes or weakened proof
rules are used to make the handoff pass. Independent review found that the new
bridge could silently skip CLI validation through a directory alias. It now
reuses T2’s realpath-aware entry guard. A real subprocess regression asserts
validation output through a symlink/Windows junction and nonzero rejection
of a tampered archive through an alias. The archived validator remains
byte-identical; independent re-review of this correction is pending. The separate T3 change will remove
the old program from the library's stable check. This report does not claim that
T3 or the final repository-wide scope search has passed: legacy release-policy
text remains until that PR. D9 also retains the owner's required verbatim quote.
Forge's explicit lookup and dated history are not library inventory.

The archive has a scoped `-text` Git attribute. A regression creates a real Git
index, checks out all four archived record types with `core.autocrlf=true`,
asserts their original bytes and snapshot hash, then proves that changing an
acceptance value is rejected. Existing Git attributes are retained.

## Validation

Tron's [complete command output](standalone-v1-2026-11-22-T4-checks.txt) records
63 targeted and archived tests, including dependency boundaries, manifest and
lookup behavior, release readiness, Qt correspondence and the archive guard.
Manifest/lookup/Qt checks and prerelease reporting pass. Stable readiness still
blocks on the old application program, additions, pending owner review and
missing local release archives, with the same actual message as before this
slice. That expected block is preserved policy, not a T3 pass.

Forge's paired output records 42 program/completion/readiness tests, pinned-source
validation, the existing completion validator and a candidate readiness report.
F7 remains in-progress; the report still has zero of nine gates passed. The new
ownership regression checks the ledgers, platform scope and consumer-pin link.
Workflow path filters include changes to that gate record and pin. Existing
readiness evidence and signing fields are not rewritten.

New GitHub CI on these proposed commits, full builds, installed-tarball/native
mounts, browser rendering, screen-reader speech, hardware and WCAG runtime
audits are NOT RUN by this handoff. No public component API or native/config
file is changed. No reference-library code, tokens, copy or layout is copied.

## Skills and review outputs

Applied `coding-standards`: output is the small compatibility boundary, explicit
immutable source links, preserved input data, real checkout/changed-input
regressions and a nonmutating paired audit. The historical validator is copied
verbatim, not refactored during the handoff.

Applied NYC-MON `no-ai-slop` and its evaluation checklist: this report separates
source existence, historical receipts, current checks and unrun platform work;
it names both status fields and the exact remaining transition. No completion
or distribution approval is inferred from implementation.

Independent standalone `code-review` and handoff audit passed; see the
[paired review](standalone-v1-2026-11-22-T4-F2-review.md). The reviewer found
and verified a fix for the new bridge CLI alias guard, independently reran
its subprocess/tamper tests, and reproduced the full preservation audit.
There are no new app screens or component presentation changes in this slice;
screen design/Mobbin work and new native skills are not claimed.

Open owner decisions remain the complete stability list, public path policy,
npm distribution and any future change to Forge's platform requirement. This
handoff preserves existing paths, distribution, APIs and platform scope.
