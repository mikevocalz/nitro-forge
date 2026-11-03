# Package builds and distribution

Ignition and all seven engine APIs build as ESM JavaScript plus declarations in
`dist/`. Build Ignition first; `pnpm run build:packages` orders workspace dependencies
automatically. Each build clears its own output directory before compiling.
Package builds exclude tests. Source maps and declaration maps resolve to the
included `src/` files. Node and Metro use the same compiled JavaScript.

```sh
pnpm install --frozen-lockfile
pnpm run check:packages
```

This builds all eight packages, runs `pnpm pack` for each and verifies the actual
archives in a temporary directory outside the workspace. The verifier checks all
export targets, exact rewritten Ignition dependencies, imports under Node and
the React Native export condition, and a strict TypeScript consumer without React,
Nitro or `skipLibCheck`. Tarballs appear in `artifacts/packages/` (gitignored).
Each package also builds in `prepack`; use pnpm for packing so `workspace:*` is
converted to a concrete version. `npm pack` does not perform that conversion.

For runtime checks against packaged code and the real Rust engines:

```sh
cargo build --locked -p nf-cli
NF_CLI="$PWD/target/debug/nf-cli" node tooling/packages/verify.mjs --engines
```

CI runs both stages and uploads local preview tarballs. It does not publish to npm.
Changing package versions requires updating all eight together while they share
the same Ignition contract, rebuilding and repeating these checks.

## Consumer boundaries

The package root is ESM-only (`import`, not CommonJS `require`). Engine roots
depend only on Ignition. Node CLI support lives at `@nitro-forge/ignition/cli`,
which is unavailable to non-Node resolvers. Supply the separately built `nf-cli`
through `new CliHost('/absolute/path/to/nf-cli')` or `NF_CLI`. The default relative
path is only a monorepo development convenience; no binary ships in these tarballs.

`Forge` is now exported only from `@nitro-forge/ignition/nitro`; update previous
type imports from the package root. This isolates the codegen-specific type from
headless declarations. Install compatible `react-native-nitro-modules` to use that
subpath. `ForgeNitro` and `EngineHost` remain transport-independent root types.
The optional peer stays on the current master 0.29.x contract; this work does not
merge or supersede the separate Nitro v1 migration PRs.

## Native release remains pending

These are JavaScript/TypeScript preview artifacts. They do not contain a linked
Rust runtime, generated Nitro glue, CocoaPods/Gradle integration, or WASM. A Nitro
spec is not executable native support. Before publishing a native release, include
the generated bindings and native build assets, verify npm installation in clean
iOS/Android apps, run on-device lifecycle/ownership tests, and record the exact
toolchain and device evidence in `ROSTER.md`. A Node export-condition smoke check
does not establish a Metro bundle or device test.
