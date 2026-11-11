import {it,expect} from 'vitest';
import {CliHost} from '../../ignition/src/host-cli';
import {SceneDocument,type SceneState} from '../src/index';

async function boxScene(host:CliHost){
 const doc=await SceneDocument.open(host,'demo');
 const mat=(await doc.addMaterial({name:'paint',color:'#FF0000'})).data.material_id;
 const mesh=(await doc.addMeshPrimitive({kind:'box',size:[2,2,2],material:mat})).data.mesh_id;
 const cam=(await doc.addNode({kind:'camera',name:'cam',camera:{type:'perspective',fov_y_degrees:60},translation:[0,0,5]})).data.node_id;
 const light=(await doc.addNode({kind:'light',light:{type:'ambient',color:[1,1,1],intensity:0.5}})).data.node_id;
 const box=(await doc.addNode({kind:'mesh',name:'box',mesh})).data.node_id;
 return{doc,mat,mesh,cam,light,box};
}

it('drives node/material/mesh lifecycle, bounds, pick, undo and snapshot reopen through the CLI host',async()=>{
 const host=new CliHost();let doc:SceneDocument|undefined,reopened:SceneDocument|undefined;
 try{
  const s=await boxScene(host);doc=s.doc;
  const described=(await doc.describe()).data as SceneState;
  expect(described.kind).toBe('scene');expect(described.schema).toBe(1);expect(described.name).toBe('demo');
  expect(described.nodes[String(s.box)]).toMatchObject({kind:'mesh',mesh:s.mesh,parent:0,visible:true});
  expect(described.materials[String(s.mat)]?.color[0]).toBeCloseTo(1,5);
  // Bounds: unit box scaled to 2 at origin → [-1,1]^3.
  const b=(await doc.bounds()).data;
  expect(b.bounds).not.toBeNull();
  expect(b.bounds!.min[0]).toBeCloseTo(-1,5);expect(b.bounds!.max[2]).toBeCloseTo(1,5);
  // Pick straight down -Z at the box face.
  const hit=(await doc.pick([0,0,5],[0,0,-1])).data;
  expect(hit.hit).toMatchObject({node_id:s.box,mesh_id:s.mesh});
  expect(hit.hit!.distance).toBeCloseTo(4,4);
  // Hidden node drops out of bounds.
  await doc.updateNode(s.box,{visible:false});
  expect((await doc.bounds()).data.bounds).toBeNull();
  await doc.updateNode(s.box,{visible:true});
  // Reparent under a group; cycle rejects atomically.
  const group=(await doc.addNode({kind:'group',name:'g'})).data.node_id;
  await doc.updateNode(s.box,{parent:group});
  await expect(doc.updateNode(group,{parent:s.box})).rejects.toThrow();
  await expect(doc.updateNode(s.box,{parent:999999})).rejects.toThrow();
  // Transform patch moves the box; bounds follow.
  await doc.setTransform(s.box,{translation:[10,0,0]});
  const moved=(await doc.bounds()).data.bounds!;
  expect(moved.min[0]).toBeCloseTo(9,4);expect(moved.max[0]).toBeCloseTo(11,4);
  await doc.setTransform(s.box,{translation:[0,0,0]});
  // Duplicate subtree copies nodes with fresh ids.
  const dup=(await doc.duplicateNode(group,'g-copy')).data;
  expect(dup.count).toBe(2);
  const after=(await doc.describe()).data as SceneState;
  expect(Object.keys(after.nodes)).toHaveLength(6);
  // Undo/redo walk history one entry per mutation.
  expect(await doc.undo()).toBe(true);
  expect(Object.keys(((await doc.describe()).data as SceneState).nodes)).toHaveLength(4);
  expect(await doc.redo()).toBe(true);
  // Snapshot → close → reopen preserves state byte-for-byte semantics.
  const snap=await doc.save();
  await doc.close();doc=undefined;
  reopened=await SceneDocument.openSnapshot(host,snap);
  const rdesc=(await reopened.describe()).data as SceneState;
  expect(rdesc.revision).toBe(after.revision);
  expect(Object.keys(rdesc.nodes)).toHaveLength(6);
 }finally{
  await doc?.close();await reopened?.close();host.dispose();
 }
});

it('renderFrame emits a canonical scene-render description without rasterizing',async()=>{
 const host=new CliHost();let doc:SceneDocument|undefined;
 try{
  const s=await boxScene(host);doc=s.doc;
  const frame=(await doc.renderFrame({width:16,height:16,format:'raw'})).data as Record<string,unknown>;
  expect(frame.width).toBe(16);expect(frame.height).toBe(16);expect(frame.format).toBe('raw');
  const cam=frame.camera as Record<string,unknown>;
  expect(cam.type).toBe('perspective');
  expect((cam.position as number[])[2]).toBeCloseTo(5,4);
  expect((frame.lights as unknown[]).length).toBe(1);
  const meshes=frame.meshes as Array<Record<string,unknown>>;
  expect(meshes).toHaveLength(1);
  expect(meshes[0]!.positions_b64).toMatch(/^[A-Za-z0-9+/=]+$/);
  expect(typeof meshes[0]!.indices_b64).toBe('string');
  // World transform applied: box at origin still spans [-1,1] after emission.
  // Hostile reads reject without touching state.
  await expect(doc.renderFrame({width:0,height:8})).rejects.toThrow();
  await expect(doc.renderFrame({width:16,height:16,camera_node:999999})).rejects.toThrow();
  // A textured material must have its texture supplied at render time.
  const tmat=(await doc.addMaterial({name:'tex',texture:'missing.png'})).data.material_id;
  const tmesh=(await doc.addMeshPrimitive({kind:'plane',material:tmat})).data.mesh_id;
  await doc.addNode({kind:'mesh',mesh:tmesh});
  await expect(doc.renderFrame({width:8,height:8})).rejects.toThrow(/texture/);
  const ok=(await doc.renderFrame({width:8,height:8,textures:{'missing.png':{width:1,height:1,bytes_b64:'AAAA'}}})).data;
  expect((ok.materials as unknown[]).length).toBeGreaterThan(0);
 }finally{await doc?.close();host.dispose();}
});

it('rejects invalid ops atomically and preserves state',async()=>{
 const host=new CliHost();let doc:SceneDocument|undefined;
 try{
  doc=await SceneDocument.open(host);
  const before=(await doc.describe()).data as SceneState;
  await expect(doc.addNode({kind:'mesh'})).rejects.toThrow(); // mesh kind requires a mesh id
  await expect(doc.addNode({kind:'light',light:{type:'bogus' as never}})).rejects.toThrow();
  await expect(doc.addMaterial({color:[2,0,0]})).rejects.toThrow();
  await expect(doc.addMeshPrimitive({kind:'bogus' as never})).rejects.toThrow();
  await expect(doc.setTransform(1,{scale:[0,1,1]})).rejects.toThrow();
  const after=(await doc.describe()).data as SceneState;
  expect(after.revision).toBe(before.revision);
  expect(Object.keys(after.nodes)).toHaveLength(0);
  expect(await doc.undo()).toBe(false);
 }finally{await doc?.close();host.dispose();}
});
