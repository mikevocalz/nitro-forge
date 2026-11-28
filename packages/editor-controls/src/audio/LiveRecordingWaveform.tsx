import {useRef} from 'react';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Text,View,type ViewProps} from 'react-native';
import {LevelMeter} from './LevelMeter.tsx';
import {normalizePeak,peaksToBars,type WaveformPeak} from '../waveform.ts';
export interface RecordingPeakWindow extends WaveformPeak {timeMs:number}
export interface LiveRecordingWaveformProps extends Omit<ViewProps,'children'> {
 capturing:boolean;elapsedSamples:number;sampleRate:number;windows:readonly RecordingPeakWindow[];
 windowStartMs:number;windowEndMs:number;level?:number;rms?:number;droppedWindows?:number;height?:number;unstyled?:boolean;
}
/** A rolling view of measured capture windows. Missing input is never drawn as fake silence. */
export function LiveRecordingWaveform({capturing,elapsedSamples,sampleRate,windows,windowStartMs,windowEndMs,level,rms,droppedWindows=0,height=72,unstyled=false,style,...props}:LiveRecordingWaveformProps){
 if(!Number.isSafeInteger(elapsedSamples)||elapsedSamples<0||!Number.isInteger(sampleRate)||sampleRate<1||sampleRate>768000||windows.length>8192||![windowStartMs,windowEndMs].every(Number.isFinite)||windowEndMs<=windowStartMs||windows.some((w,i)=>!Number.isFinite(w.timeMs)||i>0&&w.timeMs<windows[i-1]!.timeMs)||[level,rms].some(n=>n!==undefined&&(!Number.isFinite(n)||n<0))||!Number.isSafeInteger(droppedWindows)||droppedWindows<0||!Number.isFinite(height)||height<44||height>8192)throw new RangeError('Invalid live recording measurement');
 for(const window of windows)normalizePeak(window);
 const local=useRef<ReturnType<typeof makeWidthStore>|null>(null);local.current??=makeWidthStore();const store=local.current,width=useStore(store,s=>s.width);
 const visible=windows.filter(w=>w.timeMs>=windowStartMs&&w.timeMs<=windowEndMs);
 const count=Math.max(1,Math.min(1024,Math.floor(width))),buckets=new Map<number,WaveformPeak>();
 for(const sample of visible){const index=Math.min(count-1,Math.floor((sample.timeMs-windowStartMs)/(windowEndMs-windowStartMs)*count)),old=buckets.get(index);buckets.set(index,{min:Math.min(old?.min??1,sample.min),max:Math.max(old?.max??-1,sample.max)});}
 return <View {...props} onLayout={event=>{const width=event.nativeEvent.layout.width;if(Number.isFinite(width)&&width>=0)store.setState({width});props.onLayout?.(event);}} style={[{gap:8,minWidth:0},style]} accessibilityLabel="Live recording waveform">
  <Text {...{className:unstyled?undefined:'text-text'}}>{capturing?'Capturing input':'Capture stopped'}; {(elapsedSamples/sampleRate).toFixed(3)} s; {elapsedSamples} samples</Text>
  {visible.length?<View accessible accessibilityRole="image" accessibilityLabel={`Measured capture waveform, ${visible.length} windows, ${droppedWindows} dropped`} style={{height,position:'relative',overflow:'hidden'}}>{[...buckets].map(([index,peak])=>{const bar=peaksToBars([peak],height)[0]!;return <View key={index} pointerEvents="none" {...{className:unstyled?undefined:'bg-accent'}} style={{position:'absolute',left:index/count*width,width:Math.max(1,width/count),top:bar.top,height:bar.height}}/>;})}</View>:<Text {...{className:unstyled?undefined:'text-text'}}>No measured capture windows in this range</Text>}
  {level===undefined?<Text {...{className:unstyled?undefined:'text-text'}}>Input peak not reported</Text>:<LevelMeter level={level} accessibilityLabel="Measured recording input peak" unstyled={unstyled}/>}
  <Text {...{className:unstyled?undefined:'text-text'}}>Measured RMS: {rms===undefined?'Not reported':rms.toFixed(4)}; dropped windows: {droppedWindows}</Text>
 </View>;
}

function makeWidthStore(){return createStore(()=>({width:0}));}
