# Independent paired review: T4 handoff and F2 ownership

Reviewer: `skill_discovery`; implementer: `forge_ledger`.
Review date: 2026-11-23 UTC.
Tron base: `57913c86`; Forge base: `5902e64d`.
Skill: `knowledge-work-plugins/engineering` 1.2.0 standalone `code-review`.

Verdict: passed after the compatibility-bridge CLI entry-point defect was
corrected. No outstanding critical or warning findings remain.
This is not stable readiness, gate approval, release or merge authorization.

## Finding

| Severity | File | Finding | Required correction |
| --- | --- | --- | --- |
| Warning, resolved | `tooling/verify-component-program.mjs` in Tron | The rewritten compatibility wrapper originally compared the lexical CLI argument with Node's canonical module path, allowing an absolute directory-alias invocation to skip validation. | Implementer reused the realpath-aware T2 direct-entry guard and added an actual alias invocation regression requiring nonempty stdout and tampered-archive rejection. Archived source bytes and unrelated legacy guards remain unchanged. |

Independent reproduction used the same wrapper first through an absolute
symlinked checkout path and then via its documented repository-relative path.
Before the fix, the former returned no stdout; the latter printed the expected
compatibility validation. After the fix, the absolute alias invocation prints
the validation result. No source file was changed by the reviewer.

## Preserved boundaries and evidence

- The former ledger is a short pointer to Forge's immutable F1 commit and a retained dated history path. It is not a component inventory.
- The archived ledger, TSV, original validator and original fourteen tests are byte-identical to the original pinned Tron tree.
- The wrapper supplies the current repository root to the historical validator; historical source, proof and export checks therefore retain their original policy. The archived tests intentionally validate the archived baseline and fixtures, rather than treating the pointer as a ledger.
- The scoped archive `-text` attribute retains other attributes and preserves exact bytes on a real `core.autocrlf=true` checkout. Changed historical acceptance values fail the snapshot digest guard.
- Release readiness and Qt correspondence explicitly read the historical snapshot during this intermediate transition. The stable program blocker remains unchanged; its removal belongs to the separate T3 PR.
- The lookup accepts only the pinned Tron GitHub source URL shape for remote source paths, rejects traversal, and resolves to the same import paths as the original local record. It invents no external-owner imports.
- F7 retains its original status, evidence and review/signing fields. It explicitly owns the canonical application rows, eight platforms, five separately counted additions, both ledgers, validator/CI and exact consumer-release pin.
- Forge's completion values remain separate from adopted acceptance. A Tron release or source adoption is not promoted to Forge acceptance.
- No component source, public export, declaration, native manifest/config, consumer pin or owner distribution approval changed. The existing Tron dependency-boundary check passes.
- Current docs describe independent library ownership and historical program data; remaining release-policy hard counts are explicitly deferred to T3, not claimed removed.

## Independently run checks

Tron targeted tests before the final bridge correction, including historical fixtures:

```text
$ node --test tooling/tests/legacy-program-handoff.test.mjs tooling/tests/library-components.test.mjs tooling/tests/release-readiness.test.mjs tooling/tests/qt-component-coverage.test.mjs packages/ui/tests/contracts.test.mjs docs/completion/reports/2026-11-22-forge-program/tooling/tests/component-program.test.mjs
tests 62
pass 62
fail 0
skipped 0
```

Forge targeted tests:

```text
$ node --test tooling/tests/component-program.test.mjs tooling/tests/component-program-handoff.test.mjs tooling/tests/component-program-ownership.test.mjs tooling/verify-completion-plan.test.mjs tooling/validate-v1.test.mjs
tests 42
pass 42
fail 0
skipped 0
```

Also independently ran the reproducible paired audit with explicit disposable
checkout inputs (machine-specific paths omitted). Its output agrees with the
attached audit exactly:

```text
status: passed
canonical rows out/in: 341 / 341
additions out/in: 5 / 5
IDs, names, ordering and all row fields equal after location reversal: true
acceptance: 346 unverified
Forge completion: 35 unverified, 274 in-progress, 32 blocked
direct references resolved: 774
unique pinned source/evidence paths resolved with original bytes: 452
consumer pin, gate statuses/reviews and owner distribution review unchanged: true
nested report hyperlinks and runtime acceptance: NOT RUN
```

Tron's inventory, lookup and Qt read-only generators pass. The inventory
remains 478 public exposures/456 declaration identities with owner labels
pending. Forge's pinned-source validator passes against the original immutable
Tron checkout, and its existing completion validator reports 341 components,
21 phases and eight required platforms, zero fully verified.

Forge prerelease readiness reports candidate with 0/9 gates passed; F7 remains
in-progress. Tron stable readiness exits 1 with the unchanged message:

```text
Release readiness: stable publication blocked: 341 of 341 components lack accepted eight-platform proof; 5 of 5 added rows lack accepted eight-platform proof; owner distribution review is pending; the sixteen actual release archives and SHA256SUMS are required
```

Both repositories' `git diff --check` pass. Local Markdown targets across all
changed/added Markdown documents resolve. New reports and code contain no
machine-specific user/private paths. The byte-preserved historical TSV retains
its previously published source-location text; it was not newly sourced from
private machine files or sanitized during this history-preserving transfer.

## Scope limits

The separate external-source preflight's 29 pinned-path network reads were
not repeated by this reviewer. Direct references were independently resolved
against pinned Git objects; nested report links were not recursively audited.
No new remote CI, full builds, installed-tarball mounts, browser render,
physical-device, screen-reader speech or WCAG runtime audit was run here.
No owner decision is inferred on stability labels, path aliases, npm,
platform reductions or distribution approval. The final global scope-search
criterion remains staged pending T3 and its required D9 wording exception.

## Final correction verification and artifact binding

After the sole finding was fixed, independently reran all four handoff bridge
tests: four passed, zero failed, zero skipped. This includes real symlink/
Windows-junction subprocess invocation with required validation stdout and a
changed archived acceptance value rejected by the SHA guard. The shared T2
helper loads no compiler at import time. Absolute alias CLI validation was
also run separately and printed the expected historical compatibility result.

The implementer's refreshed full 63-test stdout was inspected; all 63 passed
with no skips. The reviewer did not repeat the unchanged Forge suite after
this Tron-only correction; its earlier independent 42-test pass still applies
to the unchanged Forge implementation. The paired audit was rerun after the
bridge change and remains passed. Dated archive bytes remain unchanged.

| Artifact | SHA-256 |
| --- | --- |
| Tron compatibility bridge | `e1d1748f47b879134ed8adc8f82a1a7d93e67f22503df893a0016789184ac96a` |
| Tron handoff regression tests | `4764e4f887b33127eddc74c7ef581a5f30b17758a699948e11a6435daceac1e6` |
| Tron moved-ledger pointer | `06b0da5d3efe88fa524708b099ad9114507cf70fca8aec82bc9e05c5bb432b13` |
| Tron lookup generator | `a558c00b0ff2b55c5e1f9aff1c6ae8a2353c2b5783b0d35063e81dfa856636f1` |
| Tron release-readiness adapter | `969873b5f325b2af093b15ed1a15d5e9c8d561e38ca8486d4e5be3d758344737` |
| Tron Qt correspondence adapter | `c206c04304dfb168777e7363ffc5ce9682dbb8b8ab0470b5d8e25888907fe083` |
| Tron complete final checks stdout | `aff33de2087db727a21735ee7fa9c8f9f00f197a4c944b7a4f0cfa39753cb874` |
| Forge readiness file | `b8abe5db38e7b6ba6c181f5ed4660195427479dbd7f2f4a71976d4b497e02526` |
| Forge ownership regression | `10ab16cf07080048fe772858a5b4e687875d23aadcc8870fc8dfb9e0eefc632e` |
| Forge completion workflow | `76e8016702341b66eb61dc17b120f9d8e66f5fdd953e92edebc6f09c18a17eca` |

The lead may synchronize duplicated review/report attachments across the paired
drafts and record the final commit/PR links. That metadata does not promote
acceptance, owner approval or runtime evidence.
