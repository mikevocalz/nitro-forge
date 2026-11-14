# Original F6 candidate failure

Run 43537901544, author head
`05030f6439f6928d084cc47fae828d604da9ade5`, executed merge
`65fe6dad5567c3ebd02e233ed4eda30ac162012e` into base b000c8a.
This record is retained before the corrected candidate; it is not relabeled
as evidence for a later commit.

- Source job 132271238176: PASS, 25 Node tests plus headless boundary policy.
- Android payload job 132271773383: PASS, four declared Rust ABI archives
  and their object-header checks; artifact 14090627556 uploaded.
- Apple payload job 132271773291: all three Rust builds and XCFramework
  creation succeeded. The native-fragment verification step FAILED when
  invoking lipo with two required architectures in one command.
- Archives, clean bundle and native compile stages: SKIPPED. No application
  install, launch or visible document workflow ran.

The actual failure was:

```text
lipo <universal-simulator-libnf_sys.a> -verify_arch arm64 x86_64
lipo: -verify_arch requires exactly one input file
```

`lipo-readonly-isolation.json` records a bounded read-only reproduction on
the existing /usr/bin/true Mach-O: multiple architecture arguments fail
with the same message, independent required-architecture calls succeed,
and an absent armv7 architecture fails. This isolates CLI parsing; it is
not a Forge native build or runtime test. The correction verifies every
required architecture separately and retains the exact XCFramework
architecture-set and header checks.

Raw original logs, normalized job/artifact metadata and the downloaded
Android manifest are alongside this file. The original Android ZIP is
retained in task scratch; original-outcome.json records its absolute path,
74,706,088-byte size and SHA256
`b3aadbcb35c0c3c02618f163ba007b06740180a8746a73b35997220fa25f14ab`.
Its four payload hashes and executed-merge identity were independently
checked from the ZIP without extracting/reusing its libraries. Apple
upload was skipped, so no Apple payload artifact exists for this run.

The missing licensing materials found in source review are a separate
packaging defect; they did not cause this executed lipo failure. The owner
subsequently authorized the original-code MIT text, and required native
source/license material checks are being added before any new candidate
can be consumed. No old failed run was retried or canceled.
