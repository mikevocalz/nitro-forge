import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {CliHost} from '@nitro-forge/ignition/cli';
import {PrismDocument} from '../src/index';
import {PrismCanvasAdapter,canvasClippingRows,canvasPathNodes} from '../src/canvas-cluster';
let host:CliHost;
beforeAll(()=>{host=new CliHost();});afterAll(()=>host.dispose());
const RED=[255,0,0,255] as const;
const BLUE=[0,0,255,255] as const;
async function setup(){const doc=await PrismDocument.open(host,16,12);return {doc,a:new PrismCanvasAdapter(doc)};}

describe('canvas control bindings against real Rust',()=>{
  it('aligns by UI ids and compensates pivot changes, with one undo step',async()=>{
    const {doc,a}=await setup();
    try {
      const x=(await doc.addShape({kind:'rect',x:1,y:1,w:2,h:2,fill:[...RED]})).data.layer_id;
      const y=(await doc.addShape({kind:'rect',x:8,y:5,w:2,h:2,fill:[...BLUE]})).data.layer_id;
      const align=a.alignment().onAlign;
      await align({ids:[String(x),String(y)],align:'top',to:'selection'});
      const bounds=(await doc.layerBounds([x,y])).data;
      expect(bounds.bounds).toMatchObject([{y:1},{y:1}]);
      const before=await a.read();
      const pivot=a.origin(String(x)).onSetOrigin;
      await pivot(1,1);
      expect((await doc.layerBounds([x,y])).data).toEqual(bounds);
      await doc.undo();expect(await a.read()).toEqual(before);
    } finally {await doc.close();}
  });

  it('selects immutable regions, resolves fill colours and loads real mask pixels',async()=>{
    const {doc,a}=await setup();
    try {
      const layer=(await doc.addRasterLayer('Ink')).data.layer_id;
      const onSelectRegion=a.selection().onSelectRegion;
      await onSelectRegion({shape:{kind:'polygon',points:[[0,0],[4,0],[4,4],[0,4]]} as const,mode:'replace'});
      const onFill=a.colorDrop(layer,c=>{expect(c).toBe('red');return RED;}).onFill;
      await onFill({x:1,y:1,color:'red',tolerance:0,contiguous:true});
      const preview=await a.layers().loadThumbnail(String(layer),8);
      expect(preview.pixels.length).toBe(preview.width*preview.height*4);
      const r=await a.renderRegion({x:0,y:0,w:4,h:4,max:4});
      expect([...r.pixels.slice(0,4)]).toEqual(RED);
      const masks=a.masks();await masks.onAddMask({id:String(layer),fill:'hide'});
      expect([...(await masks.loadMaskThumbnail(String(layer),8)).pixels].every(n=>n===0||n===255)).toBe(true);
      await masks.onInvertMask({id:String(layer)});
      expect((await a.read()).layers[0]!.mask!.inverted).toBe(true);
    } finally {await doc.close();}
  });

  it('keeps vector arrays immutable and applies curve-preserving insertions as one undo',async()=>{
    const {doc,a}=await setup();
    try {
      const layer=(await doc.addPath([{closed:false,nodes:[{x:1,y:1},{x:8,y:1},{x:8,y:8}]}])).data.layer_id;
      const callbacks=a.vector(layer);
      const before=await a.read();
      const paths=[{closed:false,nodes:[{x:1,y:1,kind:'corner'},{x:4,y:1,kind:'smooth'},{x:8,y:1,kind:'corner'},{x:8,y:8,kind:'corner'}]}] as const;
      await callbacks.onInsertNode({subpath:0,index:1,node:paths[0].nodes[1],subpaths:paths,neighborsChanged:true});
      const path=(await a.read()).layers[0]!.content;
      expect(path.type==='path'&&canvasPathNodes(path.path.subpaths)[0]!.nodes).toHaveLength(4);
      await doc.undo();expect(await a.read()).toEqual(before);
      await callbacks.onSetFill({type:'linear',x0:0,y0:0,x1:8,y1:8,stops:[{offset:0,color:RED},{offset:1,color:BLUE}]} as const);
      expect(paths[0].nodes[1].x).toBe(4);
    } finally {await doc.close();}
  });

  it('artboard callbacks return committed data and decode bounded previews',async()=>{
    const {doc,a}=await setup();
    try {
      const c=a.artboards();
      const state=await c.onAddArtboard({name:'Sheet',x:0,y:0,w:8,h:8});
      const id=String(state.artboards[0]!.id);
      expect((await c.onUpdateArtboard({id,name:'Cover'})).artboards[0]!.name).toBe('Cover');
      const image=await c.loadThumbnail(id,4);
      expect(image.width).toBeLessThanOrEqual(4);expect(image.pixels).toHaveLength(image.width*image.height*4);
      expect((await c.onRemoveArtboard({id})).artboards).toHaveLength(0);
    } finally {await doc.close();}
  });

  it('locked-layer failures preserve state and clipping ids retain order',async()=>{
    const {doc,a}=await setup();
    try {
      const lower=(await doc.addRasterLayer('Base')).data.layer_id;
      const upper=(await doc.addRasterLayer('Paint')).data.layer_id;
      await a.layers().onSetClipped({id:String(upper),clipped:true});
      const state=await a.layers().setLocked(upper,true);
      expect(canvasClippingRows(state).map(l=>l.id)).toEqual([String(upper),String(lower)]);
      await expect(a.colorDrop(upper,()=>RED).onFill({x:0,y:0,color:'red',tolerance:0,contiguous:true})).rejects.toThrow(/locked/);
      expect(await a.read()).toEqual(state);
      expect(()=>a.vector('not-an-id')).toThrow(/Prism id/);
    } finally {await doc.close();}
  });
});
