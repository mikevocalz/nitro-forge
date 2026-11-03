# @nitro-forge/cadence

Nitro-Forge cadence document API.

ESM JavaScript and TypeScript declarations are in `dist/`. Metro selects the
same compiled ESM using the `react-native` export condition. CommonJS `require`
is not supported.

```js
import { CadenceDocument } from "@nitro-forge/cadence";
import { CliHost } from "@nitro-forge/ignition/cli";

const host = new CliHost(process.env.NF_CLI);
try {
  const doc = await CadenceDocument.open(host);
  const bytes = await doc.save(); // NFD1 snapshot
  await doc.close();
} finally {
  await host.dispose();
}
```

These packages do not include Rust binaries, native iOS/Android bindings or WASM.
Native builds and device behavior remain unverified. See the repository
`docs/PACKAGING.md` for build, tarball and release checks.
