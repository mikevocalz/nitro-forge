import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = new URL('./src/', import.meta.url);
const visuals = new Set(['View', 'Text', 'Pressable', 'ScrollView', 'TextInput', 'Image', 'Button', 'Switch', 'Modal']);
const failures = [];
for (const name of await readdir(root)) {
  if (!name.endsWith('.tsx')) continue;
  const path = new URL(name, root);
  const source = ts.createSourceFile(name, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || node.moduleSpecifier.text !== 'react-native' || node.importClause?.isTypeOnly) continue;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
      const imported = binding.propertyName?.text ?? binding.name.text;
      if (!binding.isTypeOnly && visuals.has(imported)) failures.push(`${name}: raw native visual import ${imported}`);
    }
  }
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Studio visual imports use the required host UI boundary (${fileURLToPath(root)}).`);
