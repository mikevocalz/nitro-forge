import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MAESTRO } from "./ui-evidence.mjs";

const [destination, localArchive] = process.argv.slice(2);
if (!destination || process.argv.length > 4) throw new Error("Usage: node tooling/native/install-maestro.mjs <new-directory> [reviewed-local-archive]");
const directory = resolve(destination);
mkdirSync(directory); // Never replace another tool installation.
let bytes;
if (localArchive) bytes = readFileSync(resolve(localArchive));
else {
  const response = await fetch(MAESTRO.url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error("Official Maestro download failed: HTTP " + response.status);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash("sha256").update(bytes).digest("hex") !== MAESTRO.archiveSha256) throw new Error("Official Maestro archive SHA256 differs from the pinned release");
const archive = join(directory, "maestro.zip");
writeFileSync(archive, bytes);
const extracted = spawnSync("unzip", ["-q", archive, "-d", directory], { stdio: "inherit", timeout: 60000 });
if (extracted.error || extracted.status !== 0) throw new Error("Could not extract the verified Maestro archive");
const binary = join(directory, "maestro/bin/maestro");
chmodSync(binary, 0o755);
writeFileSync(join(directory, "provenance.json"), JSON.stringify(MAESTRO, null, 2) + "\n");
console.log(binary);
