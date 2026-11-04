import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
const root = new URL('./src/', import.meta.url);
const visuals = new Set(['View', 'Text', 'Pressable', 'ScrollView', 'TextInput', 'Image', 'Button', 'Switch', 'Modal']);
const failures = [];
for (const name of await readdir(root)) {
  if (!name.endsWith('.tsx')) continue;
  const path = new URL(name, root);
  const source = parse(await readFile(path, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  for (const node of source.program.body) {
    if (node.type !== 'ImportDeclaration' || node.source.value !== 'react-native' || node.importKind === 'type') continue;
    for (const binding of node.specifiers) {
      if (binding.type !== 'ImportSpecifier' || binding.importKind === 'type') continue;
      const imported = binding.imported.type === 'Identifier' ? binding.imported.name : binding.imported.value;
      if (visuals.has(imported)) failures.push(`${name}: raw native visual import ${imported}`);
    }
  }
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Studio visual imports use the required host UI boundary (${fileURLToPath(root)}).`);
