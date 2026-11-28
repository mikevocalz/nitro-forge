# Active config passed; manager-only lock mistaken for app graph

Run43552579982, author0c07863f215420f2ef40c1c5ecb6151b5167193d, executed merge3dbad8666fb4c8b8f09952d9813a40bf8ef6eaf5 into dab27e1. Source47/47 and both producers/archive succeeded. Candidate artifact14096403889, SHA256ad624c5181b8be0c61cd5318d3fffcfbe70e81f132bbc012a9dc8641c54f4289, remains source-specific internal assembly evidence.

Job132320861372 prepared the external consumer and the actual pinned PNPM12.18 CLI reported all intended active overrides/linker/store settings correctly. Installation then failed ERR_PNPM_NO_LOCKFILE because the bootstrap used file existence to select --frozen-lockfile.

The retained graph artifact14096179432, SHA25684021df78c5a6dac2ceab5d2d8c0f5e0f927cbb45c48d6b937493f593cf6a1e3, was read and hash-verified entirely in memory without local filesystem writes. Its4604-byte pnpm-lock.yaml contains only packageManagerDependencies for pnpm itself. There is no application dependency graph. The exact observed manager-only lock is retained as the package-manager regression fixture; this is not a stub engine or app graph.

The correction explicitly allows first Linux app resolution with --no-frozen-lockfile. Native jobs explicitly require --frozen-lockfile for their copied successful Linux graph; repeated successful installs remain frozen. Manager-only lock existence/size no longer selects the mode. A tiny local-tarball package-manager regression exercises the actual pinned CLI's rejection of manager-only frozen install, first resolution, frozen reuse and rejection of changed manifest under frozen mode. It invokes no engine/native API or product UI.

New regression execution remains NOT RUN locally under the write/disk hold. Changed statement syntax was parsed in memory only; fresh module/CLI CI is required before producers. No source/gate/version/auth/publication changes or weaker native reuse are introduced. Import/TypeScript/Metro/prebuild/native/runtime stages were not reached on this run and no acceptance is inferred. API-authored source preserves the local write hold; local checkout reconciliation remains pending.
