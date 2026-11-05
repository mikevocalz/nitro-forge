#!/usr/bin/env node
// Checks every workspace dependency on an @nyc-tron/* package against
// tooling/nyc-tron.json: the specifier must be the pinned release URL, the
// lockfile must resolve that URL, and (with --download) the tarball's sha256
// must match the SHA256SUMS value recorded in the pin.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pin = JSON.parse(readFileSync(join(root, "tooling/nyc-tron.json"), "utf8"));
const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
const failures = [];

const manifests = ["packages", "apps"].flatMap((dir) =>
  existsSync(join(root, dir))
    ? readdirSync(join(root, dir))
        .map((name) => join(root, dir, name, "package.json"))
        .filter(existsSync)
    : [],
);
let consumers = 0;
for (const file of manifests) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (!name.startsWith("@nyc-tron/")) continue;
      consumers++;
      const pinned = pin.packages[name];
      if (!pinned) failures.push(`${manifest.name}: ${name} is not pinned in tooling/nyc-tron.json`);
      else if (field !== "peerDependencies" && spec !== pinned.url) {
        failures.push(`${manifest.name}: ${name}@${spec} does not match pinned ${pinned.url}`);
      }
    }
  }
}
for (const [name, pinned] of Object.entries(pin.packages)) {
  if (!lock.includes(pinned.url)) failures.push(`pnpm-lock.yaml does not resolve ${name} from ${pinned.url}`);
}
if (process.argv.includes("--download")) {
  for (const [name, pinned] of Object.entries(pin.packages)) {
    const response = await fetch(pinned.url, { redirect: "follow" });
    if (!response.ok) {
      failures.push(`${name}: GET ${pinned.url} returned ${response.status}`);
      continue;
    }
    const digest = createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
    if (digest !== pinned.sha256) failures.push(`${name}: sha256 ${digest} != pinned ${pinned.sha256}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`NYC-Tron pin ${pin.tag}: ${consumers} workspace dependencies match.`);
