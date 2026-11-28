import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import ts from '@typescript/typescript6';
const require=createRequire(new URL('../package.json',import.meta.url));
const installed=dirname(require.resolve('react-native-gesture-handler/package.json'));
const runtime=ts.createSourceFile('usePanGesture.ts',readFileSync(join(installed,'src/v3/hooks/gestures/pan/usePanGesture.ts'),'utf8'),ts.ScriptTarget.Latest,true);
const declarations=['validateOffsetsArray','validatePanConfig'].map(name=>{
 const fn=runtime.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(fn,`Pinned RNGH must expose its ${name} validation implementation`);return fn.getText(runtime);
}).join('\n');
const javascript=ts.transpileModule(declarations,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const validate=Function('maybeUnpackValue',javascript+'\nreturn validatePanConfig;')(value=>value);
const root=new URL('../src/',import.meta.url);
function* files(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){const path=new URL(entry.name+(entry.isDirectory()?'/':''),directory);if(entry.isDirectory())yield* files(path);else if(entry.name.endsWith('.tsx'))yield path;}}
const fields=new Set(['minDistance','activeOffsetX','activeOffsetY','failOffsetX','failOffsetY']);
function literal(node){if(ts.isNumericLiteral(node))return Number(node.text);if(ts.isPrefixUnaryExpression(node)&&ts.isNumericLiteral(node.operand))return node.operator===ts.SyntaxKind.MinusToken?-Number(node.operand.text):Number(node.operand.text);if(ts.isArrayLiteralExpression(node))return node.elements.map(literal);if(ts.isIdentifier(node)&&node.text==='undefined')return undefined;return 1;}
test('native pan object configurations satisfy the installed RNGH v3 validator',()=>{
 let checked=0;
 for(const file of files(root)){
  const source=ts.createSourceFile(file.pathname,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=node=>{
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='usePanGesture'&&node.arguments[0]&&ts.isObjectLiteralExpression(node.arguments[0])){
    const config={};for(const property of node.arguments[0].properties)if(ts.isPropertyAssignment(property)&&fields.has(property.name.getText(source)))config[property.name.getText(source)]=literal(property.initializer);
    assert.doesNotThrow(()=>validate(config),file.pathname);checked++;
   }
   ts.forEachChild(node,visit);
  };visit(source);
 }
 assert.ok(checked>10,'Inspect the actual native component configuration sites');
});
test('the pinned validator rejects the conflicting thresholds the regression prevents',()=>{
 assert.throws(()=>validate({minDistance:4,activeOffsetX:[-4,4]}),/minDistance/);
 assert.throws(()=>validate({minDistance:4,failOffsetY:[-8,8]}),/minDistance/);
 assert.doesNotThrow(()=>validate({activeOffsetX:[-4,4],failOffsetY:[-8,8]}));
});
