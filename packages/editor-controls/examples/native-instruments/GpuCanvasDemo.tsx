import {useRef} from 'react';
import {Text,View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Skia} from 'react-native-skia';
import {Button} from '@nyc-tron/ui/components/Button';
import {GPUCanvasViewport,type CanvasGpuStatus} from '@nitro-forge/editor-controls/canvas/GPUCanvasViewport';
const makeStore=()=>createStore(()=>({revision:0,document:0,zoom:1,paused:false,fail:false,submissions:0,error:'',gpu:null as CanvasGpuStatus|null}));
/** Acceptance app authors the sample document colors and owns all document state. */
export function GpuCanvasDemo(){
 const ref=useRef<ReturnType<typeof makeStore>|null>(null);ref.current??=makeStore();const store=ref.current,s=useStore(store,v=>v);
 return <View style={{gap:8,padding:8}}><View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>
  <Button title="Zoom GPU canvas" onPress={()=>store.setState(v=>({zoom:v.zoom===1?2:1,revision:v.revision+1}))}/>
  <Button title="Replace GPU document" onPress={()=>store.setState(v=>({document:v.document+1,revision:v.revision+1}))}/>
  <Button title="Pause GPU canvas" onPress={()=>store.setState(v=>({paused:!v.paused}))}/>
  <Button title="Toggle GPU draw failure" onPress={()=>store.setState(v=>({fail:!v.fail,revision:v.revision+1,error:''}))}/>
 </View><GPUCanvasViewport scope={'gpu-document-'+s.document} revision={s.revision} viewport={{width:300,height:240,zoom:s.zoom,panX:20,panY:20}} paused={s.paused} label="GPU document canvas"
  drawFrame={canvas=>{if(s.fail)throw new Error('Sample renderer failed');const paint=Skia.Paint();try{paint.setColor(Skia.Color(s.document%2?'#2850b4':'#b45028'));canvas.drawRect(Skia.XYWHRect(10,10,60,40),paint);}finally{paint.dispose();}}}
  onGpuChange={gpu=>store.setState({gpu})} onFrameSubmitted={()=>store.setState(v=>({submissions:v.submissions+1}))} onRenderError={error=>store.setState({error:error.message})}/>
 <Text testID="gpu-canvas-state" {...{className:'text-text'}}>{JSON.stringify(s)}</Text></View>;
}
