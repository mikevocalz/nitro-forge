# @nitro-forge/ignition

Nitro-Forge native integration layer: engine session contracts, Nitro HybridObject spec, and host transports.

In the packed tarball, ESM JavaScript and TypeScript declarations are in `dist/`
(the workspace manifest points at `src/`; see docs/PACKAGING.md). Metro selects the
same compiled ESM using the `react-native` export condition. CommonJS `require`
is not supported.

Node tooling imports `CliHost` from `@nitro-forge/ignition/cli` and supplies
a separately built `nf-cli` binary through its constructor or `NF_CLI`.
The CLI subpath is Node-only. `./nitro` exposes the codegen specification;
it is not a native implementation. Install compatible `react-native-nitro-modules`
when using the Nitro spec or its `Forge` type. The optional peer is not needed
for JavaScript headless imports.

These packages do not include Rust binaries, native iOS/Android bindings or WASM.
Native builds and device behavior remain unverified. See the repository
`docs/PACKAGING.md` for build, tarball and release checks.
