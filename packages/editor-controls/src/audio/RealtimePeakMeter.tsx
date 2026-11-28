import {useLayoutEffect,useRef} from 'react';
import {Text,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {LevelMeter} from './LevelMeter.tsx';
import {createPeakHold,type PeakHoldOptions} from './meter-ballistics.ts';
import {formatDb} from './level.ts';
import {controlIdentity} from '../inputs/useScopedControl.ts';
import { tokens } from '../tokens.ts';
export interface RealtimePeakMeasurement {timeMs:number;samplePeak:number;truePeak?:number;rms?:number}
export interface RealtimePeakMeterProps extends Omit<ViewProps,'children'>,PeakHoldOptions {
 scope?:string;revision?:string|number;measurement:RealtimePeakMeasurement|null;
 /** Same monotonic clock as measurement.timeMs; host drives visual falloff ticks. */
 clockMs:number;length?:number;mode?:'sample'|'true';orientation?:'horizontal'|'vertical';unstyled?:boolean;
}
export function RealtimePeakMeter({scope='realtime-meter',revision=0,measurement,clockMs,length=160,mode='sample',holdMs=1500,fallDbPerSecond=20,orientation='horizontal',unstyled=false,style,...props}:RealtimePeakMeterProps){
 if(!Number.isFinite(length)||length<44||length>2048||!Number.isFinite(clockMs)||clockMs<0||measurement!==null&&(!Number.isFinite(measurement.timeMs)||measurement.timeMs>clockMs||!Number.isFinite(measurement.samplePeak)||![measurement.samplePeak,measurement.truePeak,measurement.rms].every(n=>n===undefined||Number.isFinite(n)&&n>=0))||!['sample','true'].includes(mode)||!Number.isFinite(holdMs)||holdMs<0||!Number.isFinite(fallDbPerSecond)||fallDbPerSecond<=0)throw new RangeError('Invalid peak meter measurement');
 const owner=JSON.stringify([...controlIdentity(scope,revision),mode,holdMs,fallDbPerSecond]);
 const engine=useRef<{owner:string;meter:ReturnType<typeof createPeakHold>;time:number|null}|null>(null);
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,v=>v);
 const peak=measurement===null?undefined:mode==='true'?measurement.truePeak:measurement.samplePeak;
 useLayoutEffect(()=>{
  if(!engine.current||engine.current.owner!==owner)engine.current={owner,meter:createPeakHold({holdMs,fallDbPerSecond}),time:null};
  const current=engine.current;if(measurement===null||peak===undefined){store.setState({level:0,hold:0});return;}
  const fresh=current.time!==measurement.timeMs;current.time=measurement.timeMs;
  store.setState(current.meter(fresh?peak:0,clockMs));
 },[owner,measurement?.timeMs,peak,clockMs,s.reset]);
 const clipping=measurement!==null&&(measurement.samplePeak>=1||(measurement.truePeak??0)>=1);
 return <View {...props} style={[{gap:tokens.spacing.fixedElement,minWidth:0},style]} accessibilityLabel={mode==='true'?'True peak meter':'Sample peak meter'}>
  {peak===undefined?<Text {...{className:unstyled?undefined:'text-text'}}>{measurement===null?'No meter measurement':'True peak measurement not reported'}</Text>:<View style={orientation==='vertical'?{height:length,width:tokens.spacing.fixedTarget,alignItems:'center'}:{height:tokens.spacing.fixedGroup,width:'100%'}}><LevelMeter level={s.level} peakHold={s.hold} orientation={orientation} unstyled={unstyled} accessibilityLabel={mode==='true'?'Measured true peak':'Measured sample peak'}/></View>}
  <Text {...{className:unstyled?undefined:'text-text'}}>{peak===undefined?'Not reported':formatDb(peak)+'FS'}{clipping?'; clipping':''}; RMS {measurement?.rms===undefined?'not reported':measurement.rms.toFixed(4)}</Text>
  <Button title="Reset visual peak hold" variant="ghost" unstyled={unstyled} onPress={()=>{engine.current=null;store.setState(v=>({reset:v.reset+1}));}}/>
 </View>;
}
function makeStore(){return createStore(()=>({level:0,hold:0,reset:0}));}
