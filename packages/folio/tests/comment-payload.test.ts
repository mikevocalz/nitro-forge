import {expect,it,vi} from 'vitest';
import {FolioDocument} from '../src/index';
import type {EngineHost} from '../../ignition/src/host';

it('projects comment metadata without allowing profile extras to retarget public API writes',async()=>{
 const apply=vi.fn(async()=>({data:{ok:true},events:[]}));
 const host={open:vi.fn(async()=>9),apply,close:vi.fn(async()=>true)} as unknown as EngineHost;
 const doc=await FolioDocument.create(host);
 const metadata={author:'A',modified:'D:20261107120000Z',id:999,page:8,resolved:false,contents:'retargeted',rect:[9,9,9,9],subtype:'Widget'};
 await doc.addAnnotationReply(0,7,'Intended',metadata);
 expect(apply).toHaveBeenLastCalledWith(9,{op:'addAnnotationReply',payload:{page:0,id:7,contents:'Intended',author:'A',modified:'D:20261107120000Z'}});
 await doc.setAnnotationReview(0,7,true,metadata);
 expect(apply).toHaveBeenLastCalledWith(9,{op:'setAnnotationReview',payload:{page:0,id:7,resolved:true,author:'A',modified:'D:20261107120000Z'}});
 await doc.addAnnotation(0,[1,2,3,4],'Root','Text',metadata);
 expect(apply).toHaveBeenLastCalledWith(9,{op:'addAnnotation',payload:{page:0,rect:[1,2,3,4],contents:'Root',subtype:'Text',author:'A',modified:'D:20261107120000Z'}});
 await doc.close();
});
