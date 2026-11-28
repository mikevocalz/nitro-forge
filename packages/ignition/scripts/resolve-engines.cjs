#!/usr/bin/env node
'use strict';

// Resolves which studio engines build-apple.sh / build-android.sh compile
// into nf-sys, and prints the answer for the shell script.
//
//   node resolve-engines.cjs <android|apple> list   -> "prism,tally"
//   node resolve-engines.cjs <android|apple> cargo  -> cargo feature flags
//
// Source, first match wins:
//   1. NF_ENGINES: comma-separated engine names, or "all".
//   2. NF_APP_ROOT: an Expo app whose config plugin set `engines`; reads
//      android/gradle.properties or ios/Podfile.properties.json
//      (key nitroForge.engines), as written by `expo prebuild`.
//   3. Every engine (the default; cargo gets no feature flags, so the build
//      is byte-for-byte the one before engine selection existed).

const fs = require('node:fs');
const path = require('node:path');
const { ENGINES, ENGINES_PROPERTY, parseEngineList } = require('../plugin/withForge.cjs');

function fromApp(platform, appRoot) {
  if (platform === 'android') {
    const file = path.join(appRoot, 'android/gradle.properties');
    if (!fs.existsSync(file)) return undefined;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([^#!=:\s]+)\s*[=:]\s*(.*?)\s*$/);
      if (match && match[1] === ENGINES_PROPERTY) return match[2];
    }
    return undefined;
  }
  const file = path.join(appRoot, 'ios/Podfile.properties.json');
  if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))[ENGINES_PROPERTY];
  return value === undefined ? undefined : String(value);
}

function resolve(platform, env) {
  if (env.NF_ENGINES !== undefined && env.NF_ENGINES !== '') {
    return parseEngineList(env.NF_ENGINES, 'NF_ENGINES');
  }
  if (env.NF_APP_ROOT) {
    const value = fromApp(platform, path.resolve(env.NF_APP_ROOT));
    if (value !== undefined) return parseEngineList(value, `${ENGINES_PROPERTY} in ${env.NF_APP_ROOT}`);
  }
  return [...ENGINES];
}

function cargoArgs(engines) {
  if (engines.length === ENGINES.length) return '';
  return `--no-default-features --features ${engines.join(',')}`;
}

module.exports = { resolve, cargoArgs };

if (require.main === module) {
  const [platform, mode] = process.argv.slice(2);
  if (!['android', 'apple'].includes(platform) || !['list', 'cargo'].includes(mode)) {
    process.stderr.write('usage: resolve-engines.cjs <android|apple> <list|cargo>\n');
    process.exit(2);
  }
  try {
    const engines = resolve(platform, process.env);
    process.stdout.write(`${mode === 'list' ? engines.join(',') : cargoArgs(engines)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
