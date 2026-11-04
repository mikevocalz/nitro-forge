import type {CadenceDocument} from "./index";

/**
 * Bind visual NYC-Tron rotary controls to existing Cadence Rust document ops.
 * Visual previews stay in UI; the engine remains the only committed state.
 */
export type InstrumentCommit=(value:number)=>Promise<unknown>;
export interface CadenceKnobBinding{
 readonly min:number;
 readonly max:number;
 readonly step:number;
 readonly unit:string;
 readonly onCommit:InstrumentCommit;
}
export interface CadenceTrackInstrumentBindings{
 readonly gain:CadenceKnobBinding;
 readonly pan:CadenceKnobBinding;
}
type TrackCommands=Pick<CadenceDocument,"setTrackGain"|"setTrackPan">;
function ensureBounded(value:number,min:number,max:number):number{
 if(!Number.isFinite(value)||value<min||value>max)throw new RangeError("Out of range Cadence instrument value");
 return value;
}
/**
 * Usage:
 * const controls = createCadenceTrackInstrumentBindings(cadence, track.id);
 * <InstrumentKnob label="Gain" value={track.volume} {...controls.gain}/>
 *
 * Never commit an x/y dual property pair using sequential operations until
 * Cadence has an atomic batch/transaction op. One gesture => one engine command.
 */
export function createCadenceTrackInstrumentBindings(
 document:TrackCommands,trackId:number
):CadenceTrackInstrumentBindings{
 if(!Number.isSafeInteger(trackId)||trackId<1)throw new RangeError("Invalid Cadence track id");
 return {
  gain:{min:0,max:1,step:0.01,unit:"",
   onCommit:value=>document.setTrackGain(trackId,ensureBounded(value,0,1))},
  pan:{min:-1,max:1,step:0.01,unit:"",
   onCommit:value=>document.setTrackPan(trackId,ensureBounded(value,-1,1))}
 };
}
