#!/usr/bin/env node
/**
 * Fail before an Xcode build when the selected toolchain is older than the
 * swift-tools-version that react-native-nitro-modules' Package.swift declares.
 * Without this, SwiftPM fails late with "package 'nitromodules' is using Swift
 * tools version X but the installed version is Y".
 *
 * node tooling/native/check-swift-tools.mjs <app-dir>
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const appDir = resolve(process.argv[2] ?? ".");
const require = createRequire(join(appDir, "package.json"));
const nitroRoot = dirname(require.resolve("react-native-nitro-modules/package.json"));
const manifest = readFileSync(join(nitroRoot, "Package.swift"), "utf8");
const declared = /^\/\/\s*swift-tools-version:\s*(\d+)\.(\d+)/m.exec(manifest);
if (!declared) throw new Error("No swift-tools-version line in " + join(nitroRoot, "Package.swift"));

const versionText = execFileSync("swift", ["--version"], { encoding: "utf8" });
const installed = /Swift version (\d+)\.(\d+)/.exec(versionText);
if (!installed) throw new Error("Cannot read the Swift version from: " + versionText);

const [needMajor, needMinor] = declared.slice(1).map(Number);
const [haveMajor, haveMinor] = installed.slice(1).map(Number);
const need = `${needMajor}.${needMinor}`;
const have = `${haveMajor}.${haveMinor}`;
if (haveMajor < needMajor || (haveMajor === needMajor && haveMinor < needMinor)) {
  console.error(`react-native-nitro-modules needs Swift tools ${need}; the selected toolchain is Swift ${have}.`);
  console.error("Run this job on a runner image whose Xcode ships that Swift version.");
  process.exit(1);
}
console.log(`Swift ${have} satisfies react-native-nitro-modules' swift-tools-version ${need}.`);
