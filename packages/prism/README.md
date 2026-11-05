# @nitro-forge/prism

Nitro-Forge prism document API.

In the packed tarball, ESM JavaScript and TypeScript declarations are in `dist/`
(the workspace manifest points at `src/`; see docs/PACKAGING.md). Metro selects the
same compiled ESM using the `react-native` export condition. CommonJS `require`
is not supported.

```js
import { PrismDocument } from "@nitro-forge/prism";
import { CliHost } from "@nitro-forge/ignition/cli";

const host = new CliHost(process.env.NF_CLI);
try {
  const doc = await PrismDocument.open(host);
  const bytes = await doc.save(); // NFD1 snapshot
  await doc.close();
} finally {
  await host.dispose();
}
```

These packages do not include Rust binaries, native iOS/Android bindings or WASM.
Native builds and device behavior remain unverified. See the repository
`docs/PACKAGING.md` for build, tarball and release checks.
