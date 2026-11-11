import {describe,expect,it,vi} from "vitest";
import {createFrameSession,createVideoMonitorStore} from "../src/video/frameSession";

const frame = (actualTimeUs:number) => ({uri:"file:///frame.jpg",actualTimeUs,timing:"presentation" as const,width:64,height:64});
const transport = () => ({pause:async()=>{},seekTo:async(_seconds:number)=>{}});

describe("versioned exact frame capability admission",()=>{
  it("prefers the advertised exact method and binds its actual result to the indexed frame",async()=>{
    const ordinary=vi.fn(async()=>frame(0));
    const exact=vi.fn(async(_uri:string,options:{timeUs:number})=>frame(options.timeUs));
    const store=createVideoMonitorStore();
    const session=createFrameSession({uri:"file:///movie.mp4",timesUs:[0,33333,66667],decoder:{decodeFrame:ordinary,indexedFrameVersion:1,decodeIndexedFrame:exact},transport:transport(),store});
    await session.commit(1);
    expect(exact).toHaveBeenCalledWith("file:///movie.mp4",expect.objectContaining({timeUs:33333,signal:expect.any(AbortSignal)}));
    expect(ordinary).not.toHaveBeenCalled();
    expect(store.getState().decoded?.frame.actualTimeUs).toBe(33333);
    session.close();
  });
  it("keeps old-binary actual-time rejection instead of treating the previous frame as exact",async()=>{
    const session=createFrameSession({uri:"file:///movie.mp4",timesUs:[0,33333],decoder:{decodeFrame:async()=>frame(0)},transport:transport(),store:createVideoMonitorStore()});
    await expect(session.commit(1)).rejects.toThrow("requires 33333us");
    session.close();
  });
  it("does not fall back after an advertised exact method fails",async()=>{
    const failure=new Error("index exceeds native budget");
    const ordinary=vi.fn(async()=>frame(33333));
    const store=createVideoMonitorStore();
    const session=createFrameSession({uri:"file:///movie.mp4",timesUs:[0,33333],decoder:{decodeFrame:ordinary,indexedFrameVersion:1,decodeIndexedFrame:async()=>{throw failure;}},transport:transport(),store});
    await expect(session.commit(1)).rejects.toBe(failure);
    expect(ordinary).not.toHaveBeenCalled();
    expect(store.getState().decoded).toBeNull();
    session.close();
  });
});
