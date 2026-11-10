const path = require('node:path');

/** Keep native app requests and authored acceptance entries in the same root. */
function withAcceptanceEntry(config, projectRoot, mode = process.env.FORGE_ACCEPTANCE) {
  const entry = { media: 'media-acceptance', checkpoints: 'checkpoint-acceptance',
    transactions: 'transaction-acceptance', telemetry: 'telemetry-acceptance',
    collaboration: 'collaboration-acceptance', runtime: 'runtime-acceptance' }[mode];
  if (!entry) return config;
  const rewrite = config.server?.rewriteRequestUrl;
  config.server = { ...config.server, rewriteRequestUrl(url) {
    const rewritten = rewrite ? rewrite(url) : url;
    const parsed = new URL(rewritten, 'http://metro.local');
    if (!/\/(?:index|\.expo\/\.virtual-metro-entry)\.bundle$/.test(parsed.pathname)) return rewritten;
    const relative = path.relative(config.server.unstable_serverRoot ?? projectRoot, path.join(projectRoot, entry));
    parsed.pathname = '/' + relative.split(path.sep).join('/') + '.bundle';
    return /^https?:/.test(rewritten) ? parsed.href : parsed.pathname + parsed.search;
  }};
  return config;
}
module.exports = { withAcceptanceEntry };
