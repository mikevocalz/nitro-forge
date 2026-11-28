import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWaveformGesture,waveformPosition,createWaveformLaneStore,stepWaveformPosition} from '../src/waveform-gesture.ts';
const range={start:.25,end:.75};
test('ordinary tap and sideways drag use captured real coordinates once',()=>{
 const g=createWaveformGesture();g.begin('source',200,range);
 assert.deepEqual(g.release('source',100),{kind:'seek',position:.5});assert.equal(g.release('source',100),null);
 g.begin('source',200,range);assert.equal(g.move('source',5,true),null);
 const preview=g.move('source',40,true);assert.deepEqual(preview,{start:.15,end:.65});
 assert.deepEqual(g.release('source',100),{kind:'range',range:preview,changed:true});
 g.begin('source',200,range);assert.equal(g.move('source',40,false),null);assert.equal(g.release('source',0).kind,'seek');
});
test('resize, disable, source replacement or termination consume release instead of seeking',()=>{
 for(const scrolling of [false,true]){
  const g=createWaveformGesture();g.begin('old',200,range);if(scrolling)g.move('old',40,true);
  assert.equal(g.cancel(),scrolling);assert.equal(g.move('new',80,true),null);assert.equal(g.release('new',100),null);
  g.begin('new',400,range);assert.equal(g.release('new',100).position,.375);
 }
 const g=createWaveformGesture();g.begin('old',200,range);assert.equal(g.release('new',100),null);
 g.begin('new',0,range);assert.equal(g.release('new',100),null);
});
test('native lane remains mounted and measured width changes cancel the actual session',()=>{
 const source=readFileSync(new URL('../src/WaveformLane.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/<WaveformLaneBody\s+[^>]*\bkey=/);
 assert.match(source,/gestureBoundary=\{owner\}/);
 assert.match(source,/if\(next!==width.current\)\{const scrolling=session.cancel\(\);store.setState\(\{active:false\}\)/);
 assert.match(source,/if\(!result\|\|p.disabled\)return/);
 assert.match(source,/committedBoundary.current=gestureBoundary;session.cancel\(\)/);
});

test('source-tagged fallback is zero immediately before any new source seek or extra render',()=>{
 const last={source:'a',value:.8};
 assert.equal(waveformPosition(undefined,'a',last),.8);
 assert.equal(waveformPosition(undefined,'b',last),0);
 assert.equal(waveformPosition(undefined,'b',last)+.05,.05);
 assert.equal(waveformPosition(.6,'b',last),.6);
 const source=readFileSync(new URL('../src/WaveformLane.tsx',import.meta.url),'utf8');
 assert.match(source,/writeWaveformPosition\(store,latest.current.sourceBoundary,next\)/);
 assert.match(source,/if\(g.numberActiveTouches>1\)\{const scrolling=session.cancel\(\)/);
});

test('actual Zustand fallback advances twice without render and authoritative position wins',()=>{
 const store=createWaveformLaneStore(range,'a');const seen=[];
 const step=authority=>{const value=stepWaveformPosition(store,authority,.05);seen.push(value);assert.equal(store.getState().fallback.value,value);};
 step({source:'a'});step({source:'a'});assert.deepEqual(seen,[.05,.10]);
 step({source:'b'});assert.equal(seen.at(-1),.05);
 step({source:'b',position:.7});assert.equal(seen.at(-1),.75);
 step({source:'b',position:.7});assert.equal(seen.at(-1),.75);
 assert.equal(waveformPosition(undefined,'b',store.getState().fallback),.75);
});
