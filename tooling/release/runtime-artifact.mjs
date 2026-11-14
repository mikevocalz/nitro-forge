import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { files, hash, inside, json, requireDisk } from './archive-files.mjs';

const { values } = parseArgs({ options: { platform: { type: 'string' }, app: { type: 'string' }, consumer: { type: 'string' }, output: { type: 'string' }, 'android-tools': { type: 'string' } } });
assert.ok(['android', 'ios'].includes(values.platform));
assert.ok(values.app && values.consumer && values.output);
const app = resolve(values.app), consumer = resolve(values.consumer), output = resolve(values.output);
assert.ok(!existsSync(output), 'Runtime artifact output must be fresh');
const receipt = json(resolve(consumer, 'forge-consumer-receipt.json'));
assert.ok(receipt.stages.includes(`compile:${values.platform}`), 'Successful compile receipt required');
assert.equal(receipt.nativeRuntime, 'NOT RUN', 'Artifact creation is not runtime acceptance');
assert.equal(receipt.configuration, 'Release');
requireDisk(consumer, 512 * 1024 * 1024);
mkdirSync(output, { recursive: true });
let archive, embeddedBundleSha256, applicationId, architectures, signingVerification;
if (values.platform === 'ios') {
  assert.equal(process.platform, 'darwin');
  assert.equal(statSync(app).isDirectory(), true);
  const bundle = resolve(app, 'main.jsbundle');
  assert.ok(statSync(bundle).size > 0, 'Release simulator app must contain its actual embedded JS/Hermes bundle');
  embeddedBundleSha256 = hash(bundle);
  const plist = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, resolve(app, 'Info.plist')], { encoding: 'utf8' }).trim();
  applicationId = plist('CFBundleIdentifier');
  assert.equal(applicationId, 'dev.nitroforge.f6.consumer');
  architectures = execFileSync('lipo', ['-archs', inside(app, plist('CFBundleExecutable'))], { encoding: 'utf8' }).trim().split(/\s+/);
  assert.ok(architectures.includes('arm64') || architectures.includes('x86_64'), 'Simulator executable architecture required');
  files(app); // Reject filesystem aliases before preserving the app directory.
  archive = 'forge-consumer-ios-simulator.tar.gz';
  execFileSync('tar', ['-czf', resolve(output, archive), '-C', dirname(app), basename(app)]);
} else {
  assert.ok(values['android-tools'], 'Actual Android SDK build-tools directory required');
  const tools = resolve(values['android-tools']);
  const badging = execFileSync(resolve(tools, 'aapt'), ['dump', 'badging', app], { encoding: 'utf8' });
  applicationId = badging.match(/^package: name='([^']+)'/m)?.[1];
  assert.equal(applicationId, 'dev.nitroforge.f6.consumer');
  architectures = [...(badging.match(/^native-code: (.+)$/m)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.ok(architectures.length > 0, 'Actual APK native architectures required');
  signingVerification = execFileSync(resolve(tools, 'apksigner'), ['verify', '--print-certs', app], { encoding: 'utf8' });
  assert.ok(statSync(app).isFile());
  const members = execFileSync('unzip', ['-Z1', app], { encoding: 'utf8' }).split('\n');
  assert.ok(members.includes('assets/index.android.bundle'), 'Release APK must contain its embedded JS/Hermes bundle');
  const bundle = execFileSync('unzip', ['-p', app, 'assets/index.android.bundle'], { maxBuffer: 128 * 1024 * 1024 });
  assert.ok(bundle.length > 0);
  const { createHash } = await import('node:crypto');
  embeddedBundleSha256 = createHash('sha256').update(bundle).digest('hex');
  archive = 'forge-consumer-android.apk';
  copyFileSync(app, resolve(output, archive));
  assert.equal(hash(resolve(output, archive)), hash(app));
}
copyFileSync(resolve(consumer, 'pnpm-lock.yaml'), resolve(output, 'pnpm-lock.yaml'));
copyFileSync(resolve(consumer, 'forge-consumer-receipt.json'), resolve(output, 'forge-consumer-receipt.json'));
writeFileSync(resolve(output, 'runtime-artifact.json'), JSON.stringify({
  schemaVersion: 1, platform: values.platform, configuration: 'Release', sourceCommit: receipt.sourceCommit,
  manifestSha256: receipt.manifestSha256, lockSha256: hash(resolve(output, 'pnpm-lock.yaml')),
  archive, sha256: hash(resolve(output, archive)), bytes: statSync(resolve(output, archive)).size,
  embeddedBundleSha256, applicationId, architectures,
  signingVerification,
  signing: values.platform === 'android' ? 'Ordinary Expo template acceptance build; default debug signing, not a publication credential' : 'Unsigned iOS Simulator application',
  nativeRuntime: 'NOT RUN',
}, null, 2) + '\n');
console.log(JSON.stringify({ stage: 'bundled-runtime-artifact', platform: values.platform, archive, nativeRuntime: 'NOT RUN' }));
