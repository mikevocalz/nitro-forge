import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyNativeCadenceAutolinking } from "./verify-native-cadence-autolinking.mjs";

test("rejects a stale pnpm patch source even when its old directory still exists", () => {
  const app = mkdtempSync(join(tmpdir(), "forge-spm-"));
  try {
    for (const name of ["platform-services", "hardware-keys", "reserved-regions"]) {
      const installed = join(app, "node_modules/@nyc-tron", name);
      const generated = join(app, "ios/build/generated/autolinking/expo/expo-source", `nyc-tron-${name}`);
      mkdirSync(installed, { recursive: true }); mkdirSync(generated, { recursive: true });
      symlinkSync(installed, join(generated, "root"));
      writeFileSync(join(generated, "Package.swift"), 'path: "root/ios"');
    }
    assert.doesNotThrow(() => verifyNativeCadenceAutolinking(app));
    const stale = join(app, "old-pnpm-patch"); mkdirSync(stale);
    const source = join(app, "ios/build/generated/autolinking/expo/expo-source/nyc-tron-platform-services/root");
    unlinkSync(source); symlinkSync(stale, source);
    assert.throws(() => verifyNativeCadenceAutolinking(app), /Stale SwiftPM source/);
  } finally { rmSync(app, { recursive: true, force: true }); }
});
