import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCompletionPlan} from './verify-completion-plan.mjs';
const baseline=readFileSync(new URL('../docs/completion/baseline-roster.tsv',import.meta.url),'utf8');
const source=JSON.parse(readFileSync(new URL('../docs/completion/components.json',import.meta.url),'utf8'));
const check=change=>{const plan=structuredClone(source);change(plan);return validateCompletionPlan(plan,baseline);};
test('all 341 IDs have one delivery phase and retain mandatory platform gates',()=>assert.deepEqual(validateCompletionPlan(source,baseline),[]));
test('dropping an absent component cannot silently shrink the scope',()=>assert.ok(check(p=>p.components.pop()).some(e=>e.includes('full baseline'))));
test('a component cannot be delivered in two phases',()=>assert.ok(check(p=>p.phases[1].components.push(p.components[0].id)).some(e=>e.includes('more than once'))));
test('legacy DONE or passing builds cannot promote an unverified component',()=>assert.ok(check(p=>p.components.find(c=>c.baselineStatus==='DONE').completion='complete').some(e=>e.includes('unverified gates'))));
test('passing gates require matching component-specific evidence',()=>assert.ok(check(p=>p.components[0].gates.integration={status:'pass',evidence:[]}).some(e=>e.includes('without evidence'))));
test('required target scope and dependencies cannot be silently removed or cycled',()=>{
 assert.ok(check(p=>p.requiredPlatforms.pop()).some(e=>e.includes('scope changed')));
 assert.ok(check(p=>p.phases[0].dependsOn=['P20']).some(e=>e.includes('cycle')));
});

test('unit/build records cannot masquerade as platform runtime and screen-reader evidence',()=>{
 const failures=check(p=>{
  const c=p.components[0];const kinds=p.gatePolicy.requiredPlatformProofs;
  p.evidence=kinds.map(gate=>({id:gate,componentIds:[c.id],platform:'ios',gate,revision:'a'.repeat(40),command:'test',artifact:'fixture-report.json',environment:'unit',result:'pass'}));
  c.platforms.ios={status:'pass',evidence:kinds};
 });
 assert.ok(failures.some(e=>e.includes('cannot prove runtime')));
 assert.ok(failures.some(e=>e.includes('cannot prove assistive')));
});
