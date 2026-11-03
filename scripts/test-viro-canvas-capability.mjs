import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Archive fixtures exercise the Gradle source selector, not Java execution or
// Viro runtime support. Marker entries deliberately contain no implementation.
const temp = mkdtempSync(join(tmpdir(), 'forge-viro-capability-'));
const run = (command, args, cwd = temp) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stdout + result.stderr);
  return result.stdout;
};
try {
  for (const [name, entry] of [
    ['old', 'com/viromedia/bridge/OldRegistry.class'],
    ['canvas', 'com/viromedia/bridge/canvas/CanvasSurfaces.class'],
  ]) {
    const content = join(temp, name);
    const marker = join(content, 'classes', entry);
    mkdirSync(join(marker, '..'), { recursive: true });
    writeFileSync(marker, 'archive entry fixture; not executable bytecode');
    run('jar', ['--create', '--file', join(content, 'classes.jar'), '-C', join(content, 'classes'), '.']);
    run('jar', ['--create', '--file', join(temp, `${name}.aar`), '-C', content, 'classes.jar']);
  }
  writeFileSync(join(temp, 'settings.gradle'), "rootProject.name = 'viro-capability-fixtures'\n");
  writeFileSync(join(temp, 'build.gradle'), `
apply from: file(findProperty('capabilityScript'))
tasks.register('verifyCapability') {
  doLast {
    assert !forgeBoardHasViroCanvas(null)
    assert !forgeBoardHasViroCanvas(file('missing.aar'))
    assert !forgeBoardHasViroCanvas(file('old.aar'))
    assert forgeBoardHasViroCanvas(file('canvas.aar'))
    println('PASS: missing/old Viro selects unavailable backend; canvas registry selects Viro source')
  }
}
`);
  const wrapper = resolve('apps/board-native-lab/android/gradlew');
  const capability = resolve('packages/board/android/viro-canvas-capability.gradle');
  console.log(run('bash', [wrapper, '-p', temp, 'verifyCapability', '--no-daemon', '--max-workers=1',
    '-Dorg.gradle.jvmargs=-Xmx512m', `-PcapabilityScript=${capability}`]));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
