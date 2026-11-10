import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {synchronizeLibrarySource} from './sync-library-implementation.mjs';

const plan=JSON.parse(readFileSync(new URL('../docs/completion/components.json',import.meta.url),'utf8'));
const revision='23f08c3b050c766222e5a8f33386fcca7bb8b6ac';
function source(){return {baselineSha256:plan.baselineSha256,requiredPlatforms:[...plan.requiredPlatforms],components:plan.components.map(row=>({id:row.id,name:row.name,phase:row.phase,libraryScope:row.librarySource.inScope,sourceCandidates:[...row.librarySource.candidatePaths],evidence:[...row.librarySource.reportPaths],implementationReview:row.librarySource.inScope?'implemented':'pending'}))};}
function external(data){const row=data.components.find(row=>row.id==='N-03');Object.assign(row,{libraryScope:false,sourceCandidates:[],evidence:['reports/V1-PLATFORM-CLOSURE.md'],implementationReview:'implemented-external',externalImplementation:{owners:[{repository:'mikevocalz/nitro-forge',revision,sourcePaths:['packages/spatial-ink/src/muse.ts'],publicExports:['@nitro-forge/spatial-ink']}]}});return row;}

test('sync records pinned ownership without accepting components or changing any gate',()=>{
 const data=source();external(data);data.components.forEach(row=>{row.acceptance='accepted';row.platformEvidence={ios:{status:'passed'}};});
 const before=structuredClone(plan);
 const result=synchronizeLibrarySource(plan,data,revision);
 assert.deepEqual(plan,before);
 assert.deepEqual(result.components.map(c=>[c.id,c.completion,c.gates,c.platforms]),before.components.map(c=>[c.id,c.completion,c.gates,c.platforms]));
 assert.deepEqual(result.phases.map(p=>[p.id,p.status]),before.phases.map(p=>[p.id,p.status]));
 assert.equal(result.components.find(c=>c.id==='N-03').librarySource.review,'implemented-external');
});
test('pending external work retains provenance and stays out of implemented totals',()=>{
 const data=source(),row=external(data);row.implementationReview='pending';
 const result=synchronizeLibrarySource(plan,data,revision);
 assert.equal(result.components.find(c=>c.id==='N-03').librarySource.review,'pending');
 assert.equal(result.components.filter(c=>c.librarySource.review==='implemented-external').length,0);
});
test('external ownership rejects absent and unsafe provenance',()=>{
 for(const mutate of [row=>delete row.externalImplementation,row=>delete row.externalImplementation.owners[0].revision,row=>row.externalImplementation.owners[0].revision='0'.repeat(40),row=>row.externalImplementation.owners[0].sourcePaths=['../different-repo/secret'],row=>row.externalImplementation.owners[0].sourcePaths=[],row=>row.externalImplementation.owners[0].publicExports=[],row=>row.evidence=[],row=>row.libraryScope=true]){
  const data=source();mutate(external(data));assert.throws(()=>synchronizeLibrarySource(plan,data,revision));
 }
});
test('sync cannot replace a canonical ID or drop a required platform',()=>{
 const changed=source();changed.components[0].id='new-unrelated-id';assert.throws(()=>synchronizeLibrarySource(plan,changed,revision));
 const fewer=source();fewer.requiredPlatforms.pop();assert.throws(()=>synchronizeLibrarySource(plan,fewer,revision));
 const duplicate=source();duplicate.components[0].id=duplicate.components[1].id;assert.throws(()=>synchronizeLibrarySource(plan,duplicate,revision));
});
