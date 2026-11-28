# Independent F1 review

Reviewer: `baseline_audit`, who did not implement the adoption. Reviewed 2026-11-23 against Forge baseline `dab27e177f05a747f2a234e3892f62e2f7b8c28b`, branch `codex/adopt-tron-component-program`. The writer confirmed the code, report and verification attachment were final before this conclusion. The candidate is uncommitted; `forge-f1-reviewed-files.json` records SHA256 and size for all nine changed/new files, including untracked files.

Verdict: no blocking findings. F1 is suitable for a draft PR with this evidence attached. This review does not merge, mark a PR ready, approve distribution, complete T4/F2, or pass GitHub Actions that has not run.

## Skill output

Applied `code-review` from `.claude/plugins/cache/knowledge-work-plugins/engineering/1.2.0/skills/code-review/SKILL.md` in standalone mode, and NYC-MON's `no-ai-slop` writing skill. This report is the output. Review covered correctness, source/path safety, state preservation, CI entrypoints, provenance, tests, public API stability and unsupported documentation claims. No external code-review service was used.

## Findings

No critical or blocking issue found. The writer corrected one minor report phrase from “nine external owners” to “nine externally owned rows,” because N-03 has two owner records. The final report was re-read and its file hash refreshed; code and tests stayed unchanged. The implementation report separates local checks, pending CI and runtime limits.

## Independent preservation check

The reviewer independently normalized the adopted ledger's URLs without using its adoption transformer, compared every parsed field against the original pinned ledger, then compared reconstructed pretty-printed bytes to the original bytes. Both comparisons passed. The only changes are 774 direct source/evidence/decision locations and the top-level canonicalPlan location.

All 341 canonical IDs, names, ordering and row fields match. The five W additions remain separate and unchanged. All 346 Tron acceptance values remain unverified. Forge's existing `components.json` is byte-identical to baseline, retaining 35 unverified, 274 in-progress and 32 blocked completion values. The original MIT license text is copied byte-for-byte.

These baseline files are also byte-identical:

- `docs/completion/baseline-roster.tsv`
- `docs/release/v1-readiness.json`, including F7
- `tooling/nyc-tron.json`

No public export, runtime source, native configuration, release pin or distribution record changed.

## Validator and CI review

The CLI requires an explicit Tron source checkout. It rejects the wrong Git root or HEAD, tracked/untracked dirt and source-checksum mismatches. The reviewer observed it reject a dirty checkout, then pass a separate clean source checkout supplied by the lead at `0e09d3be8263b3dbb2eab1a78e5dd66b83b68e44`.

Exact source/evidence URL prefixes permit only the pinned GitHub repository and commit. Path validation rejects traversal, encoded traversal, mutable refs, alternate hosts, query strings and the wrong source prefix. Files must stay inside their owned directory, exist in the pinned Git tree, and match the recorded Git blob bytes. Package export manifests use the same tree checks. The regression suite covers altered and untracked proof blobs.

The retained acceptance rules require completed implementation plus passed status and existing evidence for all eight platforms before a row can be accepted. The existing canonical baseline hash, canonical names and recorded-addition preservation remain enforced. Externally owned rows retain their exact repository/revision/source/public-export metadata.

The new CI job checks out the same pinned Tron revision, runs the adopted tests and invokes the explicit-source CLI. Repository permissions are read-only and checkout credentials are not persisted in the new job. PR and master-push path filters cover ledger, validator, tests and workflow changes. The old completion validator/job remains intact.

GitHub Actions execution of this new job is NOT RUN at this uncommitted candidate. The local production CLI exercises its validation entrypoint, not a simulated green CI run.

## Commands and observed output

Commands ran from the Forge candidate checkout. `TRON_SOURCE` denotes the lead's clean checkout at the pinned Tron revision; its machine-local path is omitted from this portable attachment.

```sh
node --test tooling/tests/component-program*.test.mjs
```

Exit 0. Actual summary:

```text
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

```sh
node tooling/verify-component-program.mjs --tron-source "$TRON_SOURCE"
```

Exit 0. Actual output:

```text
Forge component program: 341 canonical IDs; 332 Tron implementations, 0 partial, 9 pinned external implementations, 0 pending; 0 accepted with all eight platform proofs.
Recorded additions: 5; 0 accepted. No acceptance or Forge completion status changed.
Tron source and direct evidence files resolved at 0e09d3be8263b3dbb2eab1a78e5dd66b83b68e44; nested report links and external-owner source contents are not checked by this validator.
```

```sh
node tooling/verify-completion-plan.mjs
node --test tooling/verify-completion-plan.test.mjs
git diff --check
```

Each exited 0. Actual completion-validator output:

```text
Completion plan valid: 341 components, 21 phases, 8 required platforms; 0 fully verified; 329/329 library source reviews
```

Actual existing-test summary: seven tests passed; zero failed, cancelled, skipped or todo. `git diff --check` printed no findings. Separate Python read-only assertions printed:

```text
docs/completion/components.json: baseline bytes unchanged
docs/completion/baseline-roster.tsv: baseline bytes unchanged
docs/release/v1-readiness.json: baseline bytes unchanged
tooling/nyc-tron.json: baseline bytes unchanged
Independent normalized object/byte comparison: all341canonical+5addition rows identical;774location references converted; no other source fields changed
Original MIT notice: byte-identical
```

## Handoff evidence and limits

The earlier preflight resolved all 774 direct local ledger paths, 452 distinct files, against the original source tree. A separate GitHub check resolved all 29 external owner source paths at their exact revisions, with returned content and blob SHAs recorded in `tron-external-source-resolution.json`. Those external checks establish source availability; the F1 validator deliberately does not repeat remote-content resolution on every CI run.

Links embedded inside historical reports and proof files remain unverified. No browser, native, hardware or screen-reader acceptance was run for this review. The adopted ledger does not establish accepted component behavior. T4 must still replace Tron's old ledger with its final Forge pointer and move the old validator; F2 must still connect ownership to F7. Forge's release pin remains rc.2.
