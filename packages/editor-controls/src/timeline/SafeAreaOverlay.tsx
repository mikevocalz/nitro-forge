import {Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {rgbaToHex} from "../color.ts";
import {guideRect,safeAreas,type OverlayRect,type SafeAreaSpec} from "./safe-area.ts";
import { controlTokens, tokens } from "../tokens.ts";

// A letterbox matte is black by definition, in any theme; it is a picture value, not a UI color.
const MATTE=rgbaToHex({r:0,g:0,b:0,alpha:1},false);

/** Props for {@linkcode SafeAreaOverlay}. */
export interface SafeAreaOverlayProps extends Omit<ViewProps,"children"> {
  /** The picture's aspect ratio (width / height), e.g. 16 / 9. */
  readonly aspect:number;
  /** @default "smpte" (action 93%, title 90%) */
  readonly safeArea?:SafeAreaSpec;
  /** Draws action- and title-safe boxes. @default true */
  readonly showSafeAreas?:boolean;
  /** Framing guides to mask to, as width / height (e.g. FRAME_GUIDES.scope). The area outside is dimmed. */
  readonly guide?:number;
  /** Center cross. @default false */
  readonly showCenter?:boolean;
  /** Rule-of-thirds lines. @default false */
  readonly showThirds?:boolean;
  className?:string;
  unstyled?:boolean;
}

const box=(r:OverlayRect)=>({position:"absolute" as const,left:r.x,top:r.y,width:r.width,height:r.height});

/**
 * Guides over a video monitor (D-25): action- and title-safe boxes, an
 * aspect-ratio framing mask, a center cross and thirds. Lay it over the
 * monitor at the same size; it fits the picture by `aspect` (letterbox or
 * pillarbox) and never takes touches. Purely visual, so it is hidden from
 * screen readers; describe active guides in the monitor's own label.
 */
export function SafeAreaOverlay({
  aspect,safeArea="smpte",showSafeAreas=true,guide,showCenter=false,showThirds=false,className,unstyled=false,testID,style,...rest
}:SafeAreaOverlayProps){
  const initial=safeAreas({width:0,height:0},aspect,safeArea);if(guide!==undefined)guideRect(initial.picture,guide);
  const [size,store]=useLocalStore(()=>({width:0,height:0}));
  const styled=!unstyled;
  const areas=size.width>0?safeAreas(size,aspect,safeArea):undefined;
  const framed=areas&&guide!==undefined?guideRect(areas.picture,guide):undefined;
  const line=joinClasses(styled&&"border-text-muted");
  const label=joinClasses(styled&&"text-text-muted text-xs");
  const pct=(n:number)=>Math.round(n*100)+"%";
  const masks=areas&&framed?[
    {x:areas.picture.x,y:areas.picture.y,width:areas.picture.width,height:framed.y-areas.picture.y},
    {x:areas.picture.x,y:framed.y+framed.height,width:areas.picture.width,height:areas.picture.y+areas.picture.height-framed.y-framed.height},
    {x:areas.picture.x,y:framed.y,width:framed.x-areas.picture.x,height:framed.height},
    {x:framed.x+framed.width,y:framed.y,width:areas.picture.x+areas.picture.width-framed.x-framed.width,height:framed.height},
  ].filter(r=>r.width>0.5&&r.height>0.5):[];
  return <View {...rest} {...(testID?{testID}:{})} pointerEvents="none"
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden
    onLayout={e=>{const {width,height}=e.nativeEvent.layout;if([width,height].every(Number.isFinite)&&width>=0&&height>=0)store.set({width,height});}}
    {...{className:joinClasses(className)}} style={[{position:"absolute",left:0,top:0,right:0,bottom:0,direction:"ltr"},style]}>
    {masks.map((r,i)=><View key={"m"+i} style={{...box(r),backgroundColor:MATTE,opacity:controlTokens.opacity.muted}}/>)}
    {framed?<View {...{className:line}} style={{...box(framed),borderWidth:tokens.borderWidth.hairline}}/>:null}
    {areas&&showSafeAreas?<>
      <View {...{className:line}} style={{...box(areas.action),borderWidth:tokens.borderWidth.hairline,borderStyle:"dashed"}}>
        <Text {...{className:label}} style={{position:"absolute",left:tokens.spacing.fixedStack,top:tokens.spacing.off2}}>{`Action safe ${pct(areas.fractions.action)}`}</Text>
      </View>
      <View {...{className:line}} style={{...box(areas.title),borderWidth:tokens.borderWidth.hairline}}>
        <Text {...{className:label}} style={{position:"absolute",right:tokens.spacing.fixedStack,bottom:tokens.spacing.off2}}>{`Title safe ${pct(areas.fractions.title)}`}</Text>
      </View>
    </>:null}
    {areas&&showThirds?[1,2].flatMap(k=>[
      <View key={"v"+k} {...{className:line}} style={{position:"absolute",left:areas.picture.x+areas.picture.width*k/3,top:areas.picture.y,height:areas.picture.height,borderLeftWidth:tokens.borderWidth.hairline,opacity:controlTokens.opacity.muted}}/>,
      <View key={"h"+k} {...{className:line}} style={{position:"absolute",top:areas.picture.y+areas.picture.height*k/3,left:areas.picture.x,width:areas.picture.width,borderTopWidth:tokens.borderWidth.hairline,opacity:controlTokens.opacity.muted}}/>,
    ]):null}
    {areas&&showCenter?<>
      <View {...{className:line}} style={{position:"absolute",left:areas.picture.x+areas.picture.width/2-tokens.spacing.off10,top:areas.picture.y+areas.picture.height/2,width:tokens.spacing.off20,borderTopWidth:tokens.borderWidth.hairline}}/>
      <View {...{className:line}} style={{position:"absolute",top:areas.picture.y+areas.picture.height/2-tokens.spacing.off10,left:areas.picture.x+areas.picture.width/2,height:tokens.spacing.off20,borderLeftWidth:tokens.borderWidth.hairline}}/>
    </>:null}
  </View>;
}
