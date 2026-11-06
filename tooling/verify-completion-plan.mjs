import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export function validateCompletionPlan(plan, baseline) {
 const errors=[];
 const reject=message=>errors.push(message);
 const lines=baseline.trimEnd().split('\n');
 const ids=lines.slice(1).map(line=>line.split('\t')[0]);
 if(ids.length!==341||new Set(ids).size!==341)reject('Baseline must retain all 341 unique IDs');
 if(plan.baselineSha256!==createHash('sha256').update(baseline).digest('hex'))reject('Baseline hash mismatch');
 const required=['ios','android','web','macos','windows','visionos','quest','pico'];
 if(JSON.stringify(plan.requiredPlatforms)!==JSON.stringify(required))reject('Required platform scope changed');
 const phases=new Map(plan.phases.map(p=>[p.id,p]));
 if(phases.size!==plan.phases.length)reject('Duplicate phase IDs');
 const seen=new Set(),visiting=new Set();
 function visit(id){
  if(visiting.has(id)){reject('Phase dependency cycle: '+id);return;}
  if(seen.has(id))return;
  const phase=phases.get(id);if(!phase){reject('Unknown phase dependency: '+id);return;}
  visiting.add(id);for(const parent of phase.dependsOn)visit(parent);visiting.delete(id);seen.add(id);
 }
 for(const id of phases.keys())visit(id);
 if(plan.gatePolicy?.defaultStatus!=='unverified')reject('Unspecified gates must remain unverified');
 const components=new Map(plan.components.map(c=>[c.id,c]));
 if(components.size!==341||components.size!==plan.components.length||ids.some(id=>!components.has(id)))reject('Component IDs must match the full baseline exactly');
 const assignments=new Map();
 for(const phase of phases.values())for(const id of phase.components){
  if(assignments.has(id))reject('Component assigned more than once: '+id);
  assignments.set(id,phase.id);if(!components.has(id))reject('Unknown assigned component: '+id);
 }
 const evidence=new Map();
 for(const e of plan.evidence){
  if(evidence.has(e.id))reject('Duplicate evidence ID: '+e.id);
  evidence.set(e.id,e);
  if(!/^[0-9a-f]{40}$/.test(e.revision??'')||!e.command||!e.artifact||!e.environment)reject('Incomplete evidence provenance: '+e.id);
 }
 const gateNames=['requirements','visual_or_service_implementation','engine_behavior','integration','undo_and_persistence','error_and_cancellation','accessibility','adaptive_layout','performance','licenses','distribution'];
 if(JSON.stringify(plan.gatePolicy.requiredComponentGates)!==JSON.stringify(gateNames))reject('Mandatory component gates changed');
 if(JSON.stringify(plan.gatePolicy.requiredPlatformProofs)!==JSON.stringify(['build','runtime','accessibility','lifecycle','error_paths','input_layout']))reject('Mandatory platform proofs changed');
 const validStatus=new Set(['unverified','in-progress','pass','failed','blocked','not-applicable']);
 for(const c of components.values()){
  if(assignments.get(c.id)!==c.phase||!phases.has(c.phase))reject('Missing or mismatched component phase: '+c.id);
  const gates=[];
  if(!['unverified','in-progress','blocked','complete'].includes(c.completion))reject('Invalid component completion status: '+c.id);
  for(const name of gateNames){
   const g=c.gates[name]??{status:'unverified',evidence:[]};gates.push(g);
   if(!validStatus.has(g.status))reject('Invalid gate status '+c.id+':'+name);
   if(g.status==='not-applicable'){
    const review=evidence.get(g.reviewEvidence);
    if(['requirements','visual_or_service_implementation','integration','licenses','distribution'].includes(name)||!g.rationale||!review||review.result!=='pass'||review.gate!=='scope_review'||!review.componentIds?.includes(c.id))reject('Unreviewed inapplicable gate '+c.id+':'+name);
   }
   if(g.status==='pass'){
    if(!g.evidence?.length)reject('Passing gate without evidence '+c.id+':'+name);
    for(const ref of g.evidence??[]){const e=evidence.get(ref);if(!e||e.result!=='pass'||!e.componentIds?.includes(c.id)||e.gate!==name)reject('Evidence does not verify gate '+c.id+':'+name);}
   }
  }
  for(const platform of required){
   const p=c.platforms[platform]??{status:'unverified',evidence:[]};gates.push(p);
   if(!validStatus.has(p.status)||p.status==='not-applicable')reject('Required platform cannot be omitted '+c.id+':'+platform);
   if(p.status==='pass'){
    const proofs=(p.evidence??[]).map(id=>evidence.get(id)).filter(e=>e?.result==='pass'&&e.platform===platform&&e.componentIds?.includes(c.id));
    for(const kind of ['build','runtime','accessibility','lifecycle','error_paths','input_layout'])if(!proofs.some(e=>e.gate===kind))reject('Missing platform proof '+c.id+':'+platform+':'+kind);
    if(proofs.some(e=>e.gate==='runtime')&&!proofs.some(e=>e.gate==='runtime'&&['browser','simulator','physical_device'].includes(e.environment)))reject('Source/build evidence cannot prove runtime '+c.id+':'+platform);
    if(proofs.some(e=>e.gate==='accessibility')&&!proofs.some(e=>e.gate==='accessibility'&&e.environment==='assistive_technology'))reject('Source/build evidence cannot prove assistive technology '+c.id+':'+platform);
   }
  }
  if(c.completion==='complete'&&gates.some(g=>!['pass','not-applicable'].includes(g.status)))reject('Component cannot be complete with unverified gates: '+c.id);
 }
 return errors;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const dir=new URL('../docs/completion/',import.meta.url);
 const plan=JSON.parse(readFileSync(new URL('components.json',dir),'utf8'));
 const baseline=readFileSync(new URL('baseline-roster.tsv',dir),'utf8');
 const errors=validateCompletionPlan(plan,baseline);
 if(errors.length){process.stderr.write(errors.join('\n')+'\n');process.exitCode=1;}
 else console.log(`Completion plan valid: ${plan.components.length} components, ${plan.phases.length} phases, ${plan.requiredPlatforms.length} required platforms; ${plan.components.filter(c=>c.completion==='complete').length} fully verified`);
}
