import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,relative,sep} from 'node:path';
const args=process.argv.slice(2);
const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const sourcePath=option('--source'),revision=option('--revision');
if(!sourcePath||!revision||!/^[0-9a-f]{40}$/.test(revision))throw new Error('Supply --source library-progress.json and --revision <40-character NYC-Tron commit>');
const absoluteSource=realpathSync(sourcePath);
const repository=execFileSync('git',['-C',dirname(absoluteSource),'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const sourceRelative=relative(repository,absoluteSource).split(sep).join('/');
if(sourceRelative!=='docs/completion/library-progress.json')throw new Error('Source must be the tracked NYC-Tron library progress document');
const committedSource=execFileSync('git',['-C',repository,'show',`${revision}:${sourceRelative}`]);
if(!committedSource.equals(readFileSync(absoluteSource)))throw new Error('Source bytes differ from the specified committed inventory');
const planPath=new URL('../docs/completion/components.json',import.meta.url);
const plan=JSON.parse(readFileSync(planPath,'utf8')),raw=committedSource.toString('utf8'),source=JSON.parse(raw);
const acceptance=JSON.stringify({phases:plan.phases.map(p=>[p.id,p.status]),components:plan.components.map(c=>[c.id,c.completion,c.gates,c.platforms])});
const planIds=new Set(plan.components.map(row=>row.id));
const safePaths=paths=>Array.isArray(paths)&&paths.every(path=>typeof path==='string'&&path.length>0&&path.length<=1024&&!path.startsWith('/')&&!path.includes('\\')&&!path.includes('\0')&&!path.split('/').includes('..'));
const rows=new Map(source.components.map(row=>[row.id,row]));
if(planIds.size!==341||[...planIds].some(id=>!rows.has(id))||rows.size!==341||source.components.length!==341||plan.components.length!==341||source.baselineSha256!==plan.baselineSha256||JSON.stringify(source.requiredPlatforms)!==JSON.stringify(plan.requiredPlatforms))throw new Error('Source inventory must preserve the canonical IDs, baseline and platform scope');
for(const component of plan.components){
 const row=rows.get(component.id);
 const candidatePaths=row?.sourceCandidates??(row?.libraryScope===false?[]:undefined),reportPaths=row?.evidence??(row?.libraryScope===false?[]:undefined);
 if(!row||!safePaths(candidatePaths)||!safePaths(reportPaths)||row.phase!==component.phase||row.name!==component.name||typeof row.libraryScope!=='boolean'||!['implemented','pending'].includes(row.implementationReview))throw new Error('Mismatched source row: '+component.id);
 component.librarySource={inScope:row.libraryScope,review:row.libraryScope?row.implementationReview:'outside-library-scope',candidatePaths,reportPaths};
}
for(const phase of plan.phases){
 const components=plan.components.filter(component=>component.phase===phase.id);
 phase.librarySourceSummary={inScope:components.filter(component=>component.librarySource.inScope).length,reviewedImplemented:components.filter(component=>component.librarySource.review==='implemented').length,enginePlatformIds:components.filter(component=>!component.librarySource.inScope).map(component=>component.id)};
}
plan.librarySourceSnapshot={repository:'mikevocalz/NYC-Tron-UI',revision,path:'docs/completion/library-progress.json',sha256:createHash('sha256').update(raw).digest('hex'),meaning:'Recorded library implementation reviews; component gates and phase acceptance retain their own evidence requirements.'};
if(acceptance!==JSON.stringify({phases:plan.phases.map(p=>[p.id,p.status]),components:plan.components.map(c=>[c.id,c.completion,c.gates,c.platforms])}))throw new Error('Source synchronization changed acceptance records');
if(args.includes('--write'))writeFileSync(planPath,JSON.stringify(plan,null,2)+'\n');
else if(readFileSync(planPath,'utf8')!==JSON.stringify(plan,null,2)+'\n')throw new Error('Library implementation snapshot differs; inspect and rerun with --write');
console.log(`Library source reviews: ${plan.components.filter(c=>c.librarySource.review==='implemented').length}/${plan.components.filter(c=>c.librarySource.inScope).length}; fully accepted: ${plan.components.filter(c=>c.completion==='complete').length}`);
