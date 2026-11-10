import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const requiredPlatforms=['ios','android','web','macos','windows','visionos','quest','pico'];
const safePaths=paths=>Array.isArray(paths)&&paths.every(path=>typeof path==='string'&&path.length>0&&path.length<=1024&&!path.startsWith('/')&&!path.includes('\\')&&!path.includes('\0')&&!path.split('/').some(part=>part==='..'||part==='.'||part===''));
const validRevision=value=>typeof value==='string'&&/^[0-9a-f]{40}$/.test(value)&&!/^0+$/.test(value);
function assertExternal(value,id){
 if(!value||!Array.isArray(value.owners)||value.owners.length===0)throw new Error('Missing external implementation owner: '+id);
 const seen=new Set();
 for(const owner of value.owners){
  if(!owner||!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(owner.repository??'')||seen.has(owner.repository)||!validRevision(owner.revision)||!safePaths(owner.sourcePaths)||owner.sourcePaths.length===0||!Array.isArray(owner.publicExports)||owner.publicExports.length===0||owner.publicExports.some(path=>typeof path!=='string'||path.length===0||path.length>1024||/[\s\0]/.test(path)||path.split('/').includes('..')))throw new Error('Invalid pinned external implementation: '+id);
  seen.add(owner.repository);
 }
}

/** Copy source ownership only. Never promote component, phase or platform acceptance. */
export function synchronizeLibrarySource(input,source,revision,raw=JSON.stringify(source)){
 if(!validRevision(revision))throw new Error('Supply a nonzero 40-character NYC-Tron commit');
 const plan=structuredClone(input);
 const acceptance=JSON.stringify({phases:plan.phases.map(p=>[p.id,p.status]),components:plan.components.map(c=>[c.id,c.completion,c.gates,c.platforms])});
 const planIds=new Set(plan.components.map(row=>row.id));
 const rows=new Map(source.components.map(row=>[row.id,row]));
 if(planIds.size!==341||[...planIds].some(id=>!rows.has(id))||rows.size!==341||source.components.length!==341||plan.components.length!==341||source.baselineSha256!==plan.baselineSha256||JSON.stringify(source.requiredPlatforms)!==JSON.stringify(requiredPlatforms)||JSON.stringify(plan.requiredPlatforms)!==JSON.stringify(requiredPlatforms))throw new Error('Source inventory must preserve the canonical IDs, baseline and platform scope');
 for(const component of plan.components){
  const row=rows.get(component.id);
  const candidatePaths=row?.sourceCandidates??(row?.libraryScope===false?[]:undefined),reportPaths=row?.evidence??(row?.libraryScope===false?[]:undefined);
  if(!row||!safePaths(candidatePaths)||!safePaths(reportPaths)||row.phase!==component.phase||row.name!==component.name||typeof row.libraryScope!=='boolean'||!['implemented','implemented-external','partial','pending'].includes(row.implementationReview))throw new Error('Mismatched source row: '+component.id);
  if(['implemented','partial'].includes(row.implementationReview)&&(!row.libraryScope||candidatePaths.length===0||reportPaths.length===0))throw new Error('Local implementation needs owned source and reports: '+component.id);
  if(row.implementationReview==='implemented-external'&&(row.libraryScope||candidatePaths.length!==0||reportPaths.length===0))throw new Error('External implementation must retain its proper owner: '+component.id);
  if(row.externalImplementation!==undefined){
   if(row.libraryScope||candidatePaths.length!==0||reportPaths.length===0)throw new Error('External metadata cannot masquerade as local source: '+component.id);
   assertExternal(row.externalImplementation,component.id);
  }else if(row.implementationReview==='implemented-external')throw new Error('Missing external implementation: '+component.id);
  component.librarySource={inScope:row.libraryScope,review:row.libraryScope||row.externalImplementation?row.implementationReview:'outside-library-scope',candidatePaths,reportPaths};
  if(row.externalImplementation)component.librarySource.externalImplementation=structuredClone(row.externalImplementation);
 }
 for(const phase of plan.phases){
  const components=plan.components.filter(component=>component.phase===phase.id);
  phase.librarySourceSummary={inScope:components.filter(component=>component.librarySource.inScope).length,reviewedImplemented:components.filter(component=>component.librarySource.review==='implemented').length,reviewedExternal:components.filter(component=>component.librarySource.review==='implemented-external').length,enginePlatformIds:components.filter(component=>!component.librarySource.inScope).map(component=>component.id)};
 }
 plan.librarySourceSnapshot={repository:'mikevocalz/NYC-Tron-UI',revision,path:'docs/completion/library-progress.json',sha256:createHash('sha256').update(raw).digest('hex'),meaning:'Recorded local and pinned external implementation reviews; component gates and phase acceptance retain their own evidence requirements.'};
 if(acceptance!==JSON.stringify({phases:plan.phases.map(p=>[p.id,p.status]),components:plan.components.map(c=>[c.id,c.completion,c.gates,c.platforms])}))throw new Error('Source synchronization changed acceptance records');
 return plan;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
 const sourcePath=option('--source'),revision=option('--revision');
 if(!sourcePath||!validRevision(revision))throw new Error('Supply --source library-progress.json and --revision <40-character NYC-Tron commit>');
 const absoluteSource=realpathSync(sourcePath);
 const repository=execFileSync('git',['-C',dirname(absoluteSource),'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
 const sourceRelative=relative(repository,absoluteSource).split(sep).join('/');
 if(sourceRelative!=='docs/completion/library-progress.json')throw new Error('Source must be the tracked NYC-Tron library progress document');
 const committedSource=execFileSync('git',['-C',repository,'show',`${revision}:${sourceRelative}`]);
 if(!committedSource.equals(readFileSync(absoluteSource)))throw new Error('Source bytes differ from the specified committed inventory');
 const planPath=new URL('../docs/completion/components.json',import.meta.url);
 const input=JSON.parse(readFileSync(planPath,'utf8')),raw=committedSource.toString('utf8'),source=JSON.parse(raw);
 const plan=synchronizeLibrarySource(input,source,revision,raw);
 if(args.includes('--write'))writeFileSync(planPath,JSON.stringify(plan,null,2)+'\n');
 else if(readFileSync(planPath,'utf8')!==JSON.stringify(plan,null,2)+'\n')throw new Error('Library implementation snapshot differs; inspect and rerun with --write');
 console.log(`Local source reviews: ${plan.components.filter(c=>c.librarySource.review==='implemented').length}/${plan.components.filter(c=>c.librarySource.inScope).length}; pinned external: ${plan.components.filter(c=>c.librarySource.review==='implemented-external').length}; fully accepted: ${plan.components.filter(c=>c.completion==='complete').length}`);
}
