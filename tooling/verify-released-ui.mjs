// Compile all recovered adapter contracts against installed release tarball declarations.
import {readFileSync,mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url));
const ui=realpathSync(join(root,'packages/splice/node_modules/@nyc-tron/ui'));
const manifest=JSON.parse(readFileSync(join(ui,'package.json'),'utf8'));
const pin=JSON.parse(readFileSync(join(root,'tooling/nyc-tron.json'),'utf8'));
if(manifest.version!==pin.packages['@nyc-tron/ui'].version)throw new Error('Installed UI differs from the release pin');
const paths=Object.fromEntries(Object.entries(manifest.exports).filter(([,entry])=>typeof entry.types==='string').map(([key,entry])=>['@nyc-tron/ui'+(key==='.'?'':key.slice(1)),[join(ui,entry.types)]]));
const temp=mkdtempSync(join(tmpdir(),'forge-released-ui-'));
try{
 const config=join(temp,'tsconfig.json');
 writeFileSync(config,JSON.stringify({extends:join(root,'tsconfig.base.json'),compilerOptions:{noEmit:true,lib:['ES2022','DOM'],types:['node'],typeRoots:[join(root,'node_modules/@types')],paths},files:['splice/contracts/timeline-cluster2.ts','prism/contracts/canvas-cluster.ts','cadence/contracts/audio-cluster.ts','ignition/contracts/workspace-cluster.ts'].map(file=>join(root,'packages',file))}));
 execFileSync(join(root,'node_modules/.bin/tsc'),['-p',config],{cwd:root,stdio:'inherit'});
 console.log(`All four recovered adapter contracts match released NYC-Tron ${manifest.version}`);
}finally{rmSync(temp,{recursive:true,force:true});}
