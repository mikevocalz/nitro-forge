// Compile all recovered adapter contracts against installed release tarball
// declarations. The contracts import NYC-Tron shell components and the editor
// controls in @nitro-forge/editor-controls; the controls are compiled first,
// with their own tsconfig.json, against the same release declarations.
import {readFileSync,mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {root,tronSubpathsMissing,emitEditorControlsDeclarations} from './editor-controls-contract.mjs';
const ui=realpathSync(join(root,'packages/splice/node_modules/@nyc-tron/ui'));
const manifest=JSON.parse(readFileSync(join(ui,'package.json'),'utf8'));
const pin=JSON.parse(readFileSync(join(root,'tooling/nyc-tron.json'),'utf8'));
if(manifest.version!==pin.packages['@nyc-tron/ui'].version)throw new Error('Installed UI differs from the release pin');
const missing=tronSubpathsMissing(ui);
if(missing.length)throw new Error('The installed @nyc-tron/ui does not export what the editor controls import:\n  '+missing.join('\n  '));
const paths=Object.fromEntries(Object.entries(manifest.exports).filter(([,entry])=>typeof entry.types==='string').map(([key,entry])=>['@nyc-tron/ui'+(key==='.'?'':key.slice(1)),[join(ui,entry.types)]]));
const editorControls=emitEditorControlsDeclarations(paths);
const temp=mkdtempSync(join(tmpdir(),'forge-released-ui-'));
try{
 const config=join(temp,'tsconfig.json');
 writeFileSync(config,JSON.stringify({extends:join(root,'tsconfig.base.json'),compilerOptions:{noEmit:true,lib:['ES2022','DOM'],types:['node'],typeRoots:[join(root,'node_modules/@types')],paths:{...paths,...editorControls.paths}},files:['splice/contracts/timeline-cluster2.ts','prism/contracts/canvas-cluster.ts','cadence/contracts/audio-cluster.ts','ignition/contracts/workspace-cluster.ts'].map(file=>join(root,'packages',file))}));
 execFileSync(join(root,'node_modules/.bin/tsc'),['-p',config],{cwd:root,stdio:'inherit'});
 console.log(`All four recovered adapter contracts match released NYC-Tron ${manifest.version} through @nitro-forge/editor-controls`);
}finally{rmSync(temp,{recursive:true,force:true});editorControls.dispose();}
