import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingFileUri, planarPeak, stopAfterStart } from '../src/audioApiContracts.ts';
import { ForgeAudioPlayback } from '../src/audioPlayback.ts';
const fixture = () => {
  const events = []; const sources = []; let closed = 0;
  const context = { currentTime: 5, destination: {}, resume: async () => {}, close: async () => { closed++; },
    decodeAudioData: async () => ({ duration: 2, length: 96000, numberOfChannels: 1 }),
    createBufferSource: () => { const source = { buffer: null, onended: null, stopped: 0, disconnected: 0,
      connect() {}, start(when) { assert.equal(when, 5); }, stop() { this.stopped++; }, disconnect() { this.disconnected++; } }; sources.push(source); return source; } };
  return { context, sources, events, player: new ForgeAudioPlayback(() => context, e => events.push(e)), closed: () => closed };
};
test('normalizes Android raw paths and rejects missing/segmented output', () => {
  assert.equal(recordingFileUri(['/data/a #?.wav']), 'file:///data/a%20%23%3F.wav');
  assert.equal(recordingFileUri(['file:///a.wav']), 'file:///a.wav');
  for (const paths of [[], ['x'], ['/a','/b']]) assert.throws(() => recordingFileUri(paths));
});
test('planar PCM preserves asymmetric extrema and validates dimensions/data', () => {
  assert.deepEqual(planarPeak([new Float32Array([-.5,.25]),new Float32Array([-.75,.1])],2),{min:-.75,max:.25});
  assert.throws(() => planarPeak([new Float32Array([NaN])],1));
  assert.throws(() => planarPeak([new Float32Array(1)],2));
});
test('injected graph lifecycle uses fresh one-shot nodes and clears subscriptions', async () => {
  const f=fixture(); await f.player.play('file:///a.wav',2); assert.equal(f.events.at(-1).phase,'playing');
  const first=f.sources[0]; await f.player.play('file:///b.wav',2);
  assert.equal(first.stopped,1); assert.equal(first.onended,null); assert.equal(first.disconnected,1);
  f.sources[1].onended({}); assert.equal(f.events.at(-1).phase,'stopped'); assert.equal(f.sources[1].buffer,null);
  await f.player.dispose(); await f.player.dispose(); assert.equal(f.closed(),1);
});
test('late decode cannot play after stop/unmount', async () => {
  const f=fixture(); let resolve; f.context.decodeAudioData=()=>new Promise(r=>{resolve=r;});
  const pending=f.player.play('blob:recording',2); f.player.stop(); resolve({duration:2,length:96000,numberOfChannels:1}); await pending;
  assert.equal(f.sources.length,0); await f.player.dispose();
  await assert.rejects(f.player.play('blob:x',2),/disposed/);
});
test('invalid input and oversized decode fail visibly without playback', async () => {
  const f=fixture(); await assert.rejects(f.player.play('file:///a',61),/60 seconds/);
  await assert.rejects(f.player.play('https://example.com/a',2),/local recording/);
  f.context.decodeAudioData=async()=>({duration:2,length:20e6,numberOfChannels:2});
  await assert.rejects(f.player.play('file:///a',2),/32 MiB/); assert.equal(f.events.at(-1).phase,'error'); assert.equal(f.sources.length,0);
});
test('native cleanup exceptions cannot skip remaining cleanup or context close', async () => {
  const f=fixture(); await f.player.play('file:///a',2);
  f.sources[0].stop=()=>{throw new Error('already stopped');};
  f.sources[0].disconnect=()=>{throw new Error('invalidated');};
  await f.player.dispose(); assert.equal(f.closed(),1); assert.equal(f.sources[0].buffer,null); assert.equal(f.sources[0].onended,null);
});

test('capture shutdown waits for pending native start and still stops on rejected start', async () => {
  let resolve; const events=[];
  const pending=new Promise(r=>{resolve=r;});
  const stopping=stopAfterStart(pending,async()=>{events.push('stop'); return 'saved';});
  await Promise.resolve(); assert.deepEqual(events,[]);
  events.push('start'); resolve(); assert.equal(await stopping,'saved'); assert.deepEqual(events,['start','stop']);
  await stopAfterStart(Promise.reject(new Error('start failed')),async()=>{events.push('cleanup');});
  assert.equal(events.at(-1),'cleanup');
});

test('preview position follows the graph clock and resets on stop/end', async () => {
  const f=fixture(); assert.equal(f.player.positionSeconds(),0);
  await f.player.play('file:///a.wav',2);
  f.context.currentTime=6.25; assert.equal(f.player.positionSeconds(),1.25);
  f.context.currentTime=99; assert.equal(f.player.positionSeconds(),2);
  f.sources[0].onended({}); assert.equal(f.player.positionSeconds(),0);
  f.context.currentTime=5; await f.player.play('file:///a.wav',2); f.player.stop(); assert.equal(f.player.positionSeconds(),0);
  await f.player.dispose();
});
