import {View} from 'react-native';
import type {DocPoint} from '../canvas/canvas-viewport.ts';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import { tokens } from '../tokens.ts';
/** Shared selection outline owner. Clip line geometry before creating native views. */
export function SelectionOutline({points,width,height,unstyled=false}:{points:readonly DocPoint[];width:number;height:number;unstyled?:boolean}){
 return <>{points.map((point,index)=>{const end=points[(index+1)%points.length]!,line=clip(point,end,width,height);if(!line)return null;const [a,b]=line,length=Math.hypot(b.x-a.x,b.y-a.y),angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;return <View key={index} pointerEvents="none" {...{className:joinClasses(!unstyled&&'bg-primary')}} style={{position:'absolute',left:(a.x+b.x-length)/2,top:(a.y+b.y)/2-(tokens.borderWidth.hairline / 2),width:length,height:tokens.borderWidth.hairline,transform:[{rotate:angle+'deg'}]}}/>;})}</>;
}
function clip(a:DocPoint,b:DocPoint,width:number,height:number):readonly[DocPoint,DocPoint]|null{
 const dx=b.x-a.x,dy=b.y-a.y;let from=0,to=1;
 for(const [p,q] of [[-dx,a.x],[dx,width-a.x],[-dy,a.y],[dy,height-a.y]] as const){if(p===0){if(q<0)return null;continue;}const ratio=q/p;if(p<0)from=Math.max(from,ratio);else to=Math.min(to,ratio);if(from>to)return null;}
 return [{x:a.x+from*dx,y:a.y+from*dy},{x:a.x+to*dx,y:a.y+to*dy}];
}
