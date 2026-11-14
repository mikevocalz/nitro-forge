import assert from 'node:assert/strict';

/** First Linux resolution is explicit; native graph reuse and repeat installs
 * remain frozen. A package-manager-only lock is not an app graph. */
export function consumerInstallArgs({ frozen = false, stages }) {
  assert.equal(typeof frozen, 'boolean');
  assert.ok(Array.isArray(stages) && stages.every(stage => typeof stage === 'string'));
  const installed = stages.some(stage => stage === 'install' || stage.startsWith('install:'));
  return ['pnpm', 'install', '--strict-peer-dependencies', '--ignore-scripts',
    frozen || installed ? '--frozen-lockfile' : '--no-frozen-lockfile'];
}
