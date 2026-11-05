import {describe,it,expect} from "vitest";
import {connectMuseToBoardRouter,type MuseNativeSample,type MuseBoardPointerSample} from "../src/index";

function createSource(){
 let fn:((sample:MuseNativeSample)=>void)|undefined;
 let subscriptions=0,unsubscriptions=0;
 return{
  subscribe(callback:(sample:MuseNativeSample)=>void){
   subscriptions++;fn=callback;
   return()=>{unsubscriptions++;fn=undefined;};
  },
  send(sample:MuseNativeSample){fn?.(sample);},
  get subscriptions(){return subscriptions;},
  get unsubscriptions(){return unsubscriptions;},
 };
}
const sample=():MuseNativeSample=>({
 tracked:true,position:[0,1,0],headPosition:[0,1.5,0],
 tipPressed:false,primaryPressed:false,secondaryPressed:false,
 pressure:0.5,
});
describe("existing Viro Muse -> canonical BoardInputRouter integration",()=>{
 it("subscribes just once and forwards hover, down, move, up, measured pressure",()=>{
   const native=createSource();
   const events:MuseBoardPointerSample[]=[];
   let tick=10;
   const cleanup=connectMuseToBoardRouter({
     subscribe:native.subscribe,now:()=>tick++,wallClock:()=>1700,
     router:{handlePenSample:e=>events.push(e)}
   });
   native.send(sample());
   native.send({...sample(),tipPressed:true,pressure:0});
   native.send({...sample(),tipPressed:true,pressure:0.7});
   native.send({...sample(),tipPressed:false});
   expect(native.subscriptions).toBe(1);
   expect(events.map(x=>x.phase)).toEqual(["hover","down","move","up"]);
   expect(events.map(x=>x.timestampMs)).toEqual([10,11,12,13]);
   expect(events[1]?.pressure).toBe(0);
   expect(events[2]?.pressure).toBe(0.7);
   expect(events[0]?.timestamp).toBe(1700);
   cleanup();cleanup();
   expect(native.unsubscriptions).toBe(1);
 });
 it("does not fabricate pressure or resume held strokes after tracking loss",()=>{
   const native=createSource();
   const events:MuseBoardPointerSample[]=[];
   const cleanup=connectMuseToBoardRouter({
     subscribe:native.subscribe,now:()=>33,
     router:{handlePenSample:e=>events.push(e)}
   });
   native.send({...sample(),tipPressed:true});
   native.send({...sample(),tipPressed:true,pressure:NaN});
   native.send({...sample(),tracked:false,position:null,tipPressed:true});
   native.send({...sample(),tipPressed:true});
   native.send(sample());
   native.send({...sample(),tipPressed:true});
   expect(events.map(x=>x.phase)).toEqual([
     "down","move","cancel","hover-exit","hover","hover","down"
   ]);
   expect(Number.isNaN(events[1]?.pressure)).toBe(true);
   cleanup();
   expect(events.slice(-2).map(x=>x.phase)).toEqual(["cancel","hover-exit"]);
 });
 it("forwards hover exit so the board can drop its hover cursor on tracking loss",()=>{
   const native=createSource();
   const events:MuseBoardPointerSample[]=[];
   const cleanup=connectMuseToBoardRouter({
     subscribe:native.subscribe,now:()=>5,
     router:{handlePenSample:e=>events.push(e)}
   });
   native.send(sample());
   native.send({...sample(),tracked:false,position:null});
   expect(events.map(x=>x.phase)).toEqual(["hover","hover-exit"]);
   expect(events[1]?.position).toBeNull();
   cleanup();
   expect(events).toHaveLength(2);
 });
 it("side buttons never start a stroke unless host explicitly opts in",()=>{
   const native=createSource();
   const events:MuseBoardPointerSample[]=[];
   const close=connectMuseToBoardRouter({
     subscribe:native.subscribe,router:{handlePenSample:e=>events.push(e)}
   });
   native.send({...sample(),primaryPressed:true});
   expect(events[0]?.phase).toBe("hover");
   close();
   const eventsOpted:MuseBoardPointerSample[]=[];
   const close2=connectMuseToBoardRouter({
     subscribe:native.subscribe,sideButtonsDraw:true,
     router:{handlePenSample:e=>eventsOpted.push(e)}
   });
   native.send({...sample(),primaryPressed:true});
   expect(eventsOpted[0]?.phase).toBe("down");
   close2();
 });
});
