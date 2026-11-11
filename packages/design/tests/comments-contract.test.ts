import {expect,it,vi} from 'vitest';
import {DesignDocument,OPS} from '../src/index';
import type {EngineHost} from '../../ignition/src/host';

function mockHost(){
 const apply=vi.fn(async()=>({events:[],data:{ok:true,id:'comment-1'}}));
 const host={open:async()=>42,apply,close:async()=>true} as unknown as EngineHost;
 return {host,apply};
}

it('projects comment thread ops with engine payload shapes',async()=>{
 const {host,apply}=mockHost();
 const doc=await DesignDocument.open(host);apply.mockClear();
 await doc.defineCommentThread({anchor:{x:12.5,y:-3},body:'Please widen this',author:'Ada',time_label:'2 hours ago'});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.defineCommentThread,payload:{anchor:{x:12.5,y:-3},body:'Please widen this',author:'Ada',time_label:'2 hours ago'}});
 await doc.defineCommentThread({id:'c-9',anchor:{x:0,y:0},body:'Pinned'});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.defineCommentThread,payload:{id:'c-9',anchor:{x:0,y:0},body:'Pinned'}});
 await doc.addCommentReply('c-9',{body:'Done',author:'Bo'});
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.addCommentReply,payload:{thread:'c-9',body:'Done',author:'Bo'}});
 await doc.setCommentResolved('c-9',true);
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.setCommentResolved,payload:{id:'c-9',resolved:true}});
 await doc.removeCommentThread('c-9');
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.removeCommentThread,payload:{id:'c-9'}});
 await doc.listComments();
 expect(apply).toHaveBeenLastCalledWith(42,{op:OPS.listComments,payload:{}});
 await doc.close();
});
