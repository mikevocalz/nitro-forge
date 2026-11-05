import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const names = ['ignition', 'prism', 'cadence', 'splice', 'folio', 'pitch', 'tally', 'quill'];
export const artifacts = resolve(root, 'artifacts/packages');
export function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}
