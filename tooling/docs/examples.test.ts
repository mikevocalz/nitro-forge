// Runs every example in tooling/docs/examples/ against the real Rust engines through nf-cli and checks
// that the ops each one sends are the ops it declares, that every declared op is documented for that
// engine in docs/ENGINE_OPS.md, and that the package source names it. The examples are the code shown
// in docs/engines/<name>.md, so a renamed op or a changed API fails here before the docs go stale.
//   cargo build --locked -p nf-cli && pnpm test:docs-examples
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_KINDS, type Command, type EngineHost } from '@nitro-forge/ignition';
import { CliHost } from '@nitro-forge/ignition/cli';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXAMPLES = join(ROOT, 'tooling/docs/examples');
const FOUNDATIONS = ['ignition', 'studio-layout', 'editor-controls'];
const opsDoc = readFileSync(join(ROOT, 'docs/ENGINE_OPS.md'), 'utf8');
const universal = opsDoc.slice(0, opsDoc.indexOf('\n---\n'));

function opsSection(kind: string) {
  const start = opsDoc.indexOf(`\n## ${kind}-engine`);
  if (start < 0) throw new Error(`docs/ENGINE_OPS.md has no "## ${kind}-engine" section`);
  const end = opsDoc.indexOf('\n## ', start + 1);
  return opsDoc.slice(start, end < 0 ? undefined : end);
}

function sourceText(dir: string): string {
  return readdirSync(dir).map((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceText(path);
    return /\.tsx?$/.test(name) ? readFileSync(path, 'utf8') : '';
  }).join('\n');
}

/** Wraps a host and records every op name it is asked to apply, including the steps of a batch. */
function recording(inner: EngineHost) {
  const sent = new Set<string>();
  const host: EngineHost = {
    open: (kind) => inner.open(kind),
    apply(handle, cmd: Command) {
      sent.add(cmd.op);
      if (cmd.op === '__batch') for (const step of (cmd.payload as { commands: Command[] }).commands) sent.add(step.op);
      return inner.apply(handle, cmd);
    },
    snapshot: (handle) => inner.snapshot(handle),
    restore: (handle, bytes) => inner.restore(handle, bytes),
    undo: (handle) => inner.undo(handle),
    redo: (handle) => inner.redo(handle),
    close: (handle) => inner.close(handle),
    dispose: () => inner.dispose(),
  };
  return { host, sent };
}

type EngineExample = { example: (host: EngineHost) => Promise<void>; ops: string[]; engine?: string };
type PlainExample = { example: () => Promise<void> };

let cli: CliHost;
beforeAll(() => { cli = new CliHost(); });
afterAll(async () => { await cli.dispose(); });

it('has one example per engine and foundation page, and no others', () => {
  const files = readdirSync(EXAMPLES).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3)).sort();
  expect(files).toEqual([...ENGINE_KINDS, ...FOUNDATIONS].sort());
});

describe.each([...ENGINE_KINDS, 'ignition'])('%s example (real Rust via nf-cli)', (name) => {
  it('runs, sends exactly the ops it declares, and each op is in ENGINE_OPS.md and the package source', async () => {
    const mod = (await import(join(EXAMPLES, `${name}.ts`))) as EngineExample;
    const kind = mod.engine ?? name;
    const { host, sent } = recording(cli);
    await mod.example(host);

    expect([...sent].sort()).toEqual([...mod.ops].sort());
    const section = opsSection(kind);
    const engineSource = sourceText(join(ROOT, 'packages', kind, 'src'));
    const ignitionSource = sourceText(join(ROOT, 'packages/ignition/src'));
    for (const op of mod.ops) {
      const tick = `\`${op}\``;
      expect(section.includes(tick) || universal.includes(tick), `${op} is not in ENGINE_OPS.md for ${kind}`).toBe(true);
      const quoted = new RegExp(`['"]${op}['"]`);
      expect(quoted.test(engineSource) || quoted.test(ignitionSource), `${op} is not named in packages/${kind}/src`).toBe(true);
    }
  });
});

describe.each(['studio-layout', 'editor-controls'])('%s example', (name) => {
  it('runs', async () => {
    const mod = (await import(join(EXAMPLES, `${name}.ts`))) as PlainExample;
    await mod.example();
  });
});

it('every engine page shows its example file unchanged', () => {
  for (const name of [...ENGINE_KINDS, ...FOUNDATIONS]) {
    const page = join(ROOT, 'docs/engines', `${name}.md`);
    expect(existsSync(page), `docs/engines/${name}.md`).toBe(true);
    const code = readFileSync(join(EXAMPLES, `${name}.ts`), 'utf8').trimEnd();
    expect(readFileSync(page, 'utf8').includes(code), `docs/engines/${name}.md does not contain tooling/docs/examples/${name}.ts; run node tooling/docs/build-docs.mjs`).toBe(true);
  }
});
