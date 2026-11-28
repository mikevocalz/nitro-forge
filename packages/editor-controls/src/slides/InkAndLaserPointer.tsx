import {Skia,StrokeCap} from 'react-native-skia';
import {GPUCanvasViewport} from '../canvas/GPUCanvasViewport.tsx';
import {PresenterInkOverlay,type PresenterInkOverlayProps} from './PresenterInkOverlay.tsx';
import {HIGHLIGHTER_OPACITY,strokeWidth,pressureScale,type PresenterInkStroke} from './presenter-ink-model.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
export type InkAndLaserPointerProps=Omit<PresenterInkOverlayProps,'renderInk'>&{laserColor:string;capture:boolean;onCaptureStroke?:(stroke:PresenterInkStroke,signal?:AbortSignal)=>unknown};
/** Native RNGH input with the shared Graphite renderer. Capture receives actual committed ink; laser positions stream separately. */
export function InkAndLaserPointer({laserColor,capture,onCaptureStroke,onStrokeCommit,...props}:InkAndLaserPointerProps){
 if(!laserColor.trim()||laserColor.length>256||capture&&!onCaptureStroke)throw new RangeError('Ink capture needs a capture sink and a document laser color');
 const scope=useEditorBoundary([props.scope,props.revision]);
 return <PresenterInkOverlay {...props} scope={scope} onStrokeCommit={async(stroke,signal)=>{await onStrokeCommit(stroke,signal);if(capture&&!signal?.aborted)await onCaptureStroke?.(stroke,signal);}} renderInk={frame=>frame.width>0&&frame.height>0?<GPUCanvasViewport scope={scope} revision={frame.frame} viewport={{width:frame.width,height:frame.height,zoom:1,panX:0,panY:0}} unstyled={props.unstyled} label="Presenter ink and laser" drawFrame={canvas=>{
  const paint=Skia.Paint(),layer=Skia.Paint();try{paint.setStrokeCap(StrokeCap.Round);for(const stroke of frame.strokes){const highlighter=stroke.tool==='highlighter';if(highlighter){layer.setAlphaf(HIGHLIGHTER_OPACITY);canvas.saveLayer(layer);}try{paint.setColor(Skia.Color(stroke.color));const width=strokeWidth(stroke.size,stroke.tool,frame.width);for(let i=0;i<stroke.points.length;i++){const point=stroke.points[i]!,previous=stroke.points[i-1];paint.setStrokeWidth(width*pressureScale(point.pressure));if(previous)canvas.drawLine(previous.x*frame.width,previous.y*frame.height,point.x*frame.width,point.y*frame.height,paint);else canvas.drawCircle(point.x*frame.width,point.y*frame.height,width*pressureScale(point.pressure)/2,paint);}}finally{if(highlighter)canvas.restore();}}
  if(frame.laser){paint.setColor(Skia.Color(laserColor));canvas.drawCircle(frame.laser.x*frame.width,frame.laser.y*frame.height,5,paint);}
  }finally{paint.dispose();layer.dispose();}
 }}/>:null}/>;
}
