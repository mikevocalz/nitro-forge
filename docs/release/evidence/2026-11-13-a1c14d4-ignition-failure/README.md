# Ignition runner collision at a1c14d4

Workflow 43540683501, job 132280280070 failed when `pnpm --filter @nitro-forge/ignition test` invoked Vitest 5.1.0. Its default glob `**/*.{test,spec}.?(c|m)[jt]s?(x)` discovered the new node:test file plugin/withForge.test.cjs. Vitest reported “No test suite found”; one Node fixture assertion also ran under Vitest's module-resolution hooks. The existing 87 Ignition Vitest tests passed. Codegen, Ignition typecheck and 29 nf-sys Rust tests passed earlier in the job.

The correction renames the file to withForge.node.cjs and retains explicit `node --test` execution in the clean-consumer source job. It does not remove coverage, change production behavior or loosen global Vitest configuration. The 28 Node tests pass under their intended runner after renaming. Whole Ignition Vitest re-execution remains a CI result, not a local claim.

Pinned primary glob source: https://unpkg.com/vitest@5.1.0/dist/chunks/defaults.B1FCaFfh.js . Original decoded job log is retained here before the correction. No failed workflow was retried.
