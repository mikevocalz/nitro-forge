/**
 * `pnpm run check:packages`: typecheck, build (where a package has a build
 * script) and `pnpm pack` every release package, then verify each tarball and
 * write SHA256SUMS. Local files only. It never publishes, tags or uploads.
 *
 *   node tooling/release/pack-packages.mjs [--out dist/release]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  DEFERRED_PACKAGES, RELEASE_PACKAGES, checkTarMembers, classifyWorkspace, formatSha256Sums,
  listFiles, verifyPackedPackage,
} from "./package-verify.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const { values } = parseArgs({ options: { out: { type: "string", default: "dist/release" } } });
const out = resolve(root, values.out);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", ...opts });
const step = (msg) => console.log(`\n== ${msg}`);

const manifests = {};
for (const dir of readdirSync(join(root, "packages"))) {
  try { manifests[dir] = readJson(join(root, "packages", dir, "package.json")); } catch { /* not a package */ }
}
const classes = classifyWorkspace(manifests);
step("Package set");
console.log(`release:  ${RELEASE_PACKAGES.map((n) => manifests[n]?.name ?? n).join(", ")}`);
for (const name of classes.deferred) console.log(`deferred: ${manifests[name].name} (${DEFERRED_PACKAGES[name]})`);
const failures = [];
if (classes.unclassified.length) {
  failures.push(`Non-private packages missing from the release/deferred lists: ${classes.unclassified.join(", ")}`);
}
if (classes.missing.length) failures.push(`Release packages missing or private: ${classes.missing.join(", ")}`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}

step("Boundary check");
process.stdout.write(run(process.execPath, ["tooling/release/check-package-boundaries.mjs"]));

const filters = RELEASE_PACKAGES.flatMap((n) => ["--filter", manifests[n].name]);
step("Typecheck and build");
run("pnpm", [...filters, "run", "typecheck"], { stdio: "inherit" });
run("pnpm", [...filters, "run", "--if-present", "build"], { stdio: "inherit" });
const unbuilt = RELEASE_PACKAGES.filter((n) => !manifests[n].scripts?.build);
if (unbuilt.length) console.log(`no build script (TypeScript source ships as-is): ${unbuilt.join(", ")}`);

step(`Pack into ${values.out}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const releaseVersions = Object.fromEntries(RELEASE_PACKAGES.map((n) => [manifests[n].name, manifests[n].version]));
const scratch = mkdtempSync(join(tmpdir(), "nf-pack-"));
const results = [];
try {
  for (const name of RELEASE_PACKAGES) {
    const cwd = join(root, "packages", name);
    const packed = JSON.parse(run("pnpm", ["pack", "--pack-destination", out, "--json"], { cwd }));
    const tarball = packed.filename;
    const file = tarball.split("/").pop();
    const memberNames = run("tar", ["-tzf", tarball]).split("\n").filter(Boolean);
    const errors = checkTarMembers(memberNames);
    const dest = join(scratch, name);
    mkdirSync(dest);
    if (!errors.length) {
      run("tar", ["-xzf", tarball, "-C", dest, "--no-same-owner", "--no-same-permissions"]);
      errors.push(...verifyPackedPackage({ packedDir: join(dest, "package"), source: manifests[name], releaseVersions }));
    }
    const sha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex");
    const count = errors.length ? memberNames.length : listFiles(join(dest, "package")).length;
    results.push({ name: manifests[name].name, file, sha256, count, bytes: packed.size, errors });
    console.log(`${errors.length ? "FAIL" : "ok  "} ${file}  ${count} files  ${packed.size} bytes`);
    for (const e of errors) console.log(`     ${e}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

writeFileSync(join(out, "SHA256SUMS"), formatSha256Sums(results));
step("SHA256SUMS");
process.stdout.write(readFileSync(join(out, "SHA256SUMS"), "utf8"));

// The Ignition native build reads ../native/<platform>/libnf_sys.a (android/CMakeLists.txt).
// Producing those static libraries needs the Apple and Android Rust toolchains; this
// step does not run them, so the tarballs below do not link natively on their own.
const nativePayload = manifests.ignition.files?.includes("native") ? "declared" : "not packed";
console.log(`\nIgnition Rust static libraries (native/): ${nativePayload}. Native iOS/Android builds from these tarballs are NOT verified here.`);

const failed = results.filter((r) => r.errors.length);
if (failed.length) {
  console.error(`\ncheck:packages FAILED for ${failed.map((r) => r.name).join(", ")}`);
  process.exit(1);
}
console.log(`\ncheck:packages passed: ${results.length} tarballs and SHA256SUMS in ${values.out}`);
