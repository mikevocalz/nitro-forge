#!/usr/bin/env node
/**
 * Reads an `expo export --dump-sourcemap` output directory and fails when a
 * shared runtime package was bundled from more than one install location, or
 * when a NYC-Tron package came from anywhere but its release tarball.
 *
 *   node tooling/native/check-bundle-singletons.mjs <export-dir> <platform>
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [exportDir, platform] = process.argv.slice(2);
if (!exportDir || !platform) throw new Error("Usage: check-bundle-singletons.mjs <export-dir> <platform>");
const bundleDir = join(exportDir, "_expo/static/js", platform);
const mapFile = readdirSync(bundleDir).find((file) => file.endsWith(".map"));
if (!mapFile) throw new Error(`No source map in ${bundleDir}; export with --dump-sourcemap`);
const { sources } = JSON.parse(readFileSync(join(bundleDir, mapFile), "utf8"));

const copies = new Map();
for (const source of sources) {
  const match = source.match(/node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (!match) continue;
  const [, instance, name] = match;
  if (!copies.has(name)) copies.set(name, new Set());
  copies.get(name).add(instance);
}

const SINGLETONS = ["react", "react-native", "react-native-nitro-modules", "zustand", "@expo/ui",
  "@nyc-tron/ui", "@nyc-tron/native-controls"];
const problems = [];
for (const name of SINGLETONS) {
  const found = copies.get(name);
  if (!found) problems.push(`${name} is not in the ${platform} bundle`);
  else if (found.size > 1) problems.push(`${name} is bundled ${found.size} times: ${[...found].join(", ")}`);
  else if (name.startsWith("@nyc-tron/") && ![...found][0].includes("+NYC-Tron-UI+releases+download+"))
    problems.push(`${name} did not come from a NYC-Tron release tarball: ${[...found][0]}`);
  else process.stdout.write(`${name}: 1 copy\n`);
}
if (problems.length) {
  process.stderr.write(problems.map((p) => "  - " + p).join("\n") + "\n");
  process.exit(1);
}
