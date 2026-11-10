import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { APP_PAYLOAD_ALGORITHM, APK_ALGORITHM, fingerprintNativeArtifact, recordNativeArtifact } from "./native-artifact.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "native-artifact-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, "Candidate.app"); mkdirSync(app);
  writeFileSync(join(app, "Launcher"), "unchanged debug launcher");
  chmodSync(join(app, "Launcher"), 0o755);
  writeFileSync(join(app, "Candidate.debug.dylib"), "native implementation one");
  writeFileSync(join(app, "Info.plist"), "bundle metadata");
  return { root, app };
}

test("iOS identity changes when native debug code changes despite an unchanged launcher", t => {
  const { app } = fixture(t), launcher = readFileSync(join(app, "Launcher"));
  const before = fingerprintNativeArtifact("ios", app);
  writeFileSync(join(app, "Candidate.debug.dylib"), "native implementation two");
  const after = fingerprintNativeArtifact("ios", app);
  assert.deepEqual(readFileSync(join(app, "Launcher")), launcher);
  assert.notEqual(before.sha256, after.sha256);
  assert.equal(after.algorithm, APP_PAYLOAD_ALGORITHM);
  const manifest = JSON.parse(after.manifestText);
  assert.ok(manifest.entries.some(entry => entry.path === "Candidate.debug.dylib" && /^[a-f0-9]{64}$/.test(entry.sha256)));
  assert.equal(after.sha256, createHash("sha256").update(after.manifestText).digest("hex"));
});

test("app identity is independent of its absolute path and file enumeration order", t => {
  const { root, app } = fixture(t);
  const moved = join(root, "elsewhere", "Renamed.app");
  mkdirSync(join(root, "elsewhere"));
  cpSync(app, moved, { recursive: true, verbatimSymlinks: true });
  const original = fingerprintNativeArtifact("ios", app), relocated = fingerprintNativeArtifact("ios", moved);
  assert.equal(original.manifestText, relocated.manifestText);
  assert.equal(original.sha256, relocated.sha256);
  const paths = JSON.parse(original.manifestText).entries.map(entry => entry.path);
  assert.deepEqual(paths, [...paths].sort());
  assert.ok(!original.manifestText.includes(root));
  chmodSync(join(moved, "Launcher"), 0o644);
  assert.notEqual(original.sha256, fingerprintNativeArtifact("ios", moved).sha256);
});

test("framework symlinks are recorded without duplicate traversal and retain relocation identity", t => {
  const { root, app } = fixture(t), framework = join(app, "Frameworks", "Engine.framework");
  for (const version of ["A", "B"]) {
    mkdirSync(join(framework, "Versions", version), { recursive: true });
    writeFileSync(join(framework, "Versions", version, "Engine"), "identical framework bytes");
  }
  symlinkSync("A", join(framework, "Versions", "Current"));
  symlinkSync("Versions/Current/Engine", join(framework, "Engine"));
  const before = fingerprintNativeArtifact("ios", app), entries = JSON.parse(before.manifestText).entries;
  assert.equal(entries.filter(entry => entry.type === "symlink").length, 2);
  assert.ok(!entries.some(entry => entry.path.includes("Current/Engine")));
  const relocated = join(root, "Relocated.app"); cpSync(app, relocated, { recursive: true, verbatimSymlinks: true });
  assert.equal(fingerprintNativeArtifact("ios", relocated).sha256, before.sha256);
  rmSync(join(framework, "Versions", "Current")); symlinkSync("B", join(framework, "Versions", "Current"));
  assert.notEqual(fingerprintNativeArtifact("ios", app).sha256, before.sha256);
});

test("app identity rejects external, dangling and cyclic symlinks without following them", t => {
  const { root, app } = fixture(t), link = join(app, "Link");
  writeFileSync(join(root, "outside"), "not part of the app");
  for (const [target, pattern] of [["../outside", /escapes/], [join(root, "outside"), /internal relative/], ["missing", /missing internal/], ["Link", /cycle/]]) {
    symlinkSync(target, link);
    assert.throws(() => fingerprintNativeArtifact("ios", app), pattern);
    rmSync(link);
  }
  // Lexical normalization alone misses this escape through a directory link.
  mkdirSync(join(app, "deep"));
  symlinkSync("deep", join(app, "directory"));
  symlinkSync("..", join(app, "deep", "up"));
  symlinkSync("directory/up/../outside", link);
  assert.throws(() => fingerprintNativeArtifact("ios", app), /escapes/);
});

test("Android identity hashes raw APK bytes and both platforms persist a verifiable manifest", t => {
  const { root, app } = fixture(t), apk = join(root, "candidate.apk"), output = join(root, "evidence");
  mkdirSync(output); writeFileSync(apk, Buffer.from("504b030461706b", "hex"));
  const android = recordNativeArtifact("android", apk, output);
  assert.equal(android.algorithm, APK_ALGORITHM);
  assert.equal(android.sha256, createHash("sha256").update(readFileSync(apk)).digest("hex"));
  assert.equal(android.manifest.sha256, createHash("sha256").update(readFileSync(join(output, android.manifest.file))).digest("hex"));
  const relocated = join(root, "renamed.apk"); cpSync(apk, relocated);
  assert.equal(fingerprintNativeArtifact("android", relocated).sha256, android.sha256);
  writeFileSync(relocated, "changed APK"); assert.notEqual(fingerprintNativeArtifact("android", relocated).sha256, android.sha256);
  const ios = recordNativeArtifact("ios", app, output);
  assert.equal(ios.sha256, ios.manifest.sha256);
  assert.equal(JSON.parse(readFileSync(join(output, ios.manifest.file))).algorithm, APP_PAYLOAD_ALGORITHM);
  const alias = join(root, "alias.apk"); symlinkSync("candidate.apk", alias);
  assert.throws(() => fingerprintNativeArtifact("android", alias), /root must not be a symlink/);
});
