# P02 recovery and checkpoint-buffer source checkpoint

2026-11-07. This checkpoint changes recovery ownership and resource cleanup. It does not complete P02 or certify storage delivery, native cancellation or platform acceptance.

## Grounded defects and changes

Recovery checked a storage-owned snapshot, awaited a new engine handle, and only then copied its bytes. A provider that reused that buffer could change the restore input while open was pending. Recovery now copies and validates the owned snapshot before opening. It uses the existing openInitialized owner, which closes unpublished failed sessions and preserves both initialization and cleanup failures in an AggregateError rather than replacing the restore failure with a close failure.

Recovery also accepts an optional AbortSignal. It checks cancellation before storage admission and after storage, open and restore settle. A cancelled attempt cannot publish the newly opened handle; openInitialized closes it on the cancellation path. Already-submitted storage or engine work may finish. This is admission and unpublished-resource cleanup, not a claim that native I/O is interrupted immediately.

NFC1 reads previously copied their payload before applying the NFD1 256 MiB bound. The storage envelope now checks the corresponding maximum length before that allocation. Snapshot ownership uses Uint8Array.from, which also copies Node Buffer inputs; Buffer.slice would retain borrowed memory. Autosave writes and both collaboration checkpoint frames use the same ownership rule. Collaboration record reads copy the provider record before the asynchronous, yielding CRC calculation.

An autosave revision observer can synchronously close its owner during notification. The event handler previously resumed and scheduled another timer after that close. It now checks the stopped flag before handling the event and again after notification, so a closed owner cannot install that later timer.

## Scope and verification

Only autosave.ts and collaboration-checkpoint.ts product source changed. Transfer modules were inspected; no transfer-format or delivery behavior was changed in this checkpoint. Destination writing, account/document storage scoping and the provider's atomic replacement contract remain host responsibilities.

The ignition TypeScript check and static diff inspection are the only execution checks for this batch. No unit, source/browser, runtime, native or full suite ran under the user review gate. Follow-up acceptance should cover buffer reuse while opening/checksumming, cancelled storage/open/restore boundaries, simultaneous restore/cleanup rejection and close during autosave notification. Earlier autosave/storage proof does not certify these changes.

## Focused regression execution after review

The user subsequently authorized affected regression tests. Added `packages/ignition/tests/recovery-ownership.test.ts` with seven cases covering detached Node Buffer storage reads, buffer reuse while session open waits, cancellation before/read/open/restore admission boundaries, simultaneous restore and cleanup rejection, synchronous autosave close during notification, owned local/pending collaboration Buffer frames, and raw record reuse while CRC validation yields. Fault-injected EngineHost fixtures test lifecycle failures deterministically; existing autosave/collaboration suites additionally use the real nf-cli engine host.

Executed `pnpm --filter @nitro-forge/ignition exec vitest run tests/recovery-ownership.test.ts tests/autosave.test.ts tests/collaboration-checkpoint.test.ts`: **3 files, 20 tests passed**. The new file also passed independently before the combined run. No product source change was needed. No broad suite, native build, device check or native cancellation proof was performed. The storage provider's atomic replacement contract remains outside these unit fixtures.
