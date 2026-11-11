import {expect,it,vi} from 'vitest';
import {DesignDocument,OPS} from '../src/index';
import type {EngineHost} from '../../ignition/src/host';

it('projects addText payload with optional parent and font-only style',async()=>{
 const apply=vi.fn(async()=>({events:[],data:{node_id:7}}));
 const host={open:async()=>42,apply,close:async()=>true} as unknown as EngineHost;
 const doc=await DesignDocument.open(host);apply.mockClear();
 await doc.addText(undefined,{content:'Hello',x:1,y:2,style:{font_size:20,font_style:'italic'}});
 expect(apply).toHaveBeenCalledExactlyOnceWith(42,{op:OPS.addText,payload:{x:1,y:2,content:'Hello',style:{font_size:20,font_style:'italic'}}});
 await doc.addText(3,{content:'Rooted',name:'Caption'});
 expect(apply).toHaveBeenLastCalledWith(42,{op:'addText',payload:{name:'Caption',parent:3,content:'Rooted'}});
 await doc.close();
});

it('forwards text patches through updateNode without widening the node patch',async()=>{
 const apply=vi.fn(async()=>({events:[],data:{ok:true}}));
 const host={open:async()=>42,apply,close:async()=>true} as unknown as EngineHost;
 const doc=await DesignDocument.open(host);apply.mockClear();
 await doc.updateNode(7,{text:{content:'Edited',font_weight:700},visible:false});
 expect(apply).toHaveBeenCalledExactlyOnceWith(42,{op:OPS.updateNode,payload:{id:7,visible:false,text:{content:'Edited',font_weight:700}}});
 await doc.close();
});
