# Ignition for React Native Windows

An experimental Windows transport for Forge's existing Rust engines. The public
entry point returns the existing `EngineHost`; Tally and `DocumentHandle` keep
their current command and snapshot contracts.

```ts
import { DocumentHandle } from "@nitro-forge/ignition";
import { createWindowsHost } from "@nitro-forge/ignition-windows";

const host = createWindowsHost();
try {
  const document = await DocumentHandle.open(host, "tally");
  await document.apply("setCell", { addr: "A1", value: "42" });
  const snapshot = await document.snapshot();
  // Persist snapshot through the application's existing byte/file service.
  await document.close();
} finally {
  await host.dispose();
}
```

The native application must build the shared Rust libraries, import
[`windows/ForgeWindows.props`](windows/ForgeWindows.props), and call
`nitroforge::windows::RegisterForgeWindows(packageBuilder)` from its package
provider before invoking the JavaScript factory. This is explicit integration,
not an autolinked or published package.

Target source contract: React Native Windows **0.85.0**, with compatible 0.85.x
React Native supplied by the consuming Windows application. This private source
package has no RN/RNW dependency or peer declarations and does not install a
Windows host. Keep the consuming application's versions aligned with its audited
RNW template. Native worker and Rust checks can run independently of that app.

One owned FIFO thread serves all documents in this module. JSON and base64 are
internal transport copies; the public `EngineHost` still exchanges structured
commands and `Uint8Array` snapshots. This slice makes no zero-copy or throughput
claim.

See [the integration and evidence guide](../../docs/native/WINDOWS_RUST_HOST.md)
for build commands, exact source assumptions, the two-phase Tally acceptance
harness, and the remaining RNW compile/runtime gates.
