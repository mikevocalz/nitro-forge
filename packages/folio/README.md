# @nitro-forge/folio

Nitro-Forge folio document API.

In the packed tarball, ESM JavaScript and TypeScript declarations are in `dist/`
(the workspace manifest points at `src/`; see docs/PACKAGING.md). Metro selects the
same compiled ESM using the `react-native` export condition. CommonJS `require`
is not supported.

```js
import { FolioDocument } from "@nitro-forge/folio";
import { CliHost } from "@nitro-forge/ignition/cli";

const host = new CliHost(process.env.NF_CLI);
try {
  const doc = await FolioDocument.create(host);
  const bytes = await doc.save(); // NFD1 snapshot
  await doc.close();
} finally {
  await host.dispose();
}
```

These packages do not include Rust binaries, native iOS/Android bindings or WASM.
Native builds and device behavior remain unverified. See the repository
`docs/PACKAGING.md` for build, tarball and release checks.
