// Fails when any workspace package or app other than the AGPL package itself
// depends on @nitro-forge/agpl-speed-curve. Expo autolinking only links native
// modules an app depends on, so this keeps the AGPL-derived code out of every
// Forge build until a distribution decision is recorded.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const AGPL = "@nitro-forge/agpl-speed-curve";
const fields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const offenders = [];
for (const dir of ["packages", "apps"]) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    if (pkg.name === AGPL) continue;
    for (const field of fields) {
      if (pkg[field] && AGPL in pkg[field]) offenders.push(`${file} (${field})`);
    }
  }
}
if (offenders.length > 0) {
  console.error(`${AGPL} is AGPL-3.0-or-later and must stay opt-in. Declared by:\n  ${offenders.join("\n  ")}`);
  console.error("Record a combined-work licensing decision before linking it (see packages/agpl-speed-curve/NOTICE.md).");
  process.exit(1);
}
console.log(`OK: no workspace package depends on ${AGPL}`);
