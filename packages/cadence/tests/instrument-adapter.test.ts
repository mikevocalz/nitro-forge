import {describe,it,expect,vi} from "vitest";
import {createCadenceTrackInstrumentBindings} from "../src/instrument-adapter";

describe("NYC-Tron instrument to Cadence engine adapter",()=>{
 it("maps each knob commit to exactly one real engine op",async()=>{
  const setTrackGain=vi.fn(async()=>({data:{ok:true},events:[]}));
  const setTrackPan=vi.fn(async()=>({data:{ok:true},events:[]}));
  const binding=createCadenceTrackInstrumentBindings({setTrackGain,setTrackPan},23);
  expect(binding.gain).toMatchObject({min:0,max:1,step:.01});
  expect(binding.pan).toMatchObject({min:-1,max:1,step:.01});
  await binding.gain.onCommit(.75);
  expect(setTrackGain).toHaveBeenCalledExactlyOnceWith(23,.75);
  expect(setTrackPan).not.toHaveBeenCalled();
  await binding.pan.onCommit(-.25);
  expect(setTrackPan).toHaveBeenCalledExactlyOnceWith(23,-.25);
 });
 it("rejects invalid and out-of-range parameters before touching Rust",async()=>{
  const setTrackGain=vi.fn(async()=>({data:{ok:true},events:[]}));
  const setTrackPan=vi.fn(async()=>({data:{ok:true},events:[]}));
  expect(()=>createCadenceTrackInstrumentBindings({setTrackGain,setTrackPan},-1)).toThrow(/track id/);
  const binding=createCadenceTrackInstrumentBindings({setTrackGain,setTrackPan},1);
  await expect(binding.gain.onCommit(Number.NaN)).rejects.toThrow(/range/);
  await expect(binding.gain.onCommit(2)).rejects.toThrow(/range/);
  await expect(binding.pan.onCommit(-2)).rejects.toThrow(/range/);
  expect(setTrackGain).not.toHaveBeenCalled();
  expect(setTrackPan).not.toHaveBeenCalled();
 });
});
