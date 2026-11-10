# Ignition

Ignition connects Nitro Forge's eleven Rust document engines to their native
owners and typed JavaScript API. Reusable widgets remain in NYC-Tron UI.

```ts
import { createNitroHost } from '@nitro-forge/ignition';

const host = createNitroHost();
const document = await host.open('tally');
await host.apply(document, { op: 'new', payload: {} });
await host.apply(document, {
  op: 'setCell', payload: { addr: 'A1', value: '42' },
});
const checkpoint = await host.snapshot(document);
await host.close(document);
await host.dispose();
```

## Qt hosts

The `qnx` and `marathon` package conditions select the shared `nitro-core`
JavaScript classes. The host must install its native Nitro runtime, real Qt
JavaScript dispatcher, and this package's generated classes before loading the
application bundle. The generic React Native QNX native-package loader discovers
`rnqnxNative` metadata from the application's installed production dependencies;
it links the CMake entry and generates that registration call.

The reviewed Qt source profile uses exactly
`1.0.0-alpha.nightly.105.g69d365fc9b18` and the host's
`rnqnx-qt-alpha105` dispatcher compatibility profile. Ignition compiles against
that single host core. Its Apple/Android generator remains pinned to
`1.0.0-alpha.nightly.120.g33ef045b96c0`. The two exact peer versions describe these
separate source profiles; they do not permit mixing two Nitro runtimes.
The default mobile route is validated only with its matching alpha120 mobile
runtime. The alpha105 allowance is for the Qt host dependency graph.
`react-native-nitro-modules` is optional for a Qt consumer because the host owns
installation. Apple/Android consumers still need their normal native installer.

Supply `NITRO_FORGE_RUST_ARCHIVE` as an absolute path to `nf-sys` built for the
consumer's architecture, either as a CMake definition or environment variable.
This source package does not silently download a binary or use a host archive in
a QNX build. A native build still needs the selected platform SDK and matched
Rust archive.

## Portable C++

`require.resolve('@nitro-forge/ignition/native')` resolves the installed package's
`CMakeLists.txt`. Add its directory with `add_subdirectory` and link
`NitroForge::RustSession` and, for ordered worker scheduling,
`NitroForge::SerialQueue`. These targets use the same C ABI and ownership classes
as the generated native host. They do not require Nitro, Qt, or a source checkout
of this monorepo. Expensive operations must run on a native worker.

Hosts with a reviewed Nitro core can also call
`nitroforge_add_nitro_bindings(NITRO_TARGET their_core_target)` and link
`NitroForge::Nitro`. The core must advertise `NITRO_CORE_VERSION`; the older Qt
profile additionally requires `NITRO_SOURCE_COMPATIBILITY_PROFILE`.

Native package discovery and host execution do not establish acceptance of all
341 UI contracts on a device. See the repository's
`docs/native/IGNITION_QT.md` for the verified scope and remaining target gates.
