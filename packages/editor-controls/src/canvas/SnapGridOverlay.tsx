import {View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {docToScreen,validateViewport,type CanvasViewport} from "./canvas-viewport.ts";
import {gridLines,validateSnapHit,type GridSettings,type SnapHit} from "./snap-grid-model.ts";

/** Props for {@linkcode SnapGridOverlay}. */
export interface SnapGridOverlayProps extends Omit<ViewProps,"children"> {
  readonly viewport:CanvasViewport;
  readonly grid:GridSettings;
  /**
   * The lines the current drag has snapped onto, straight from `snapPoint` or
   * `snapRect` in `snap-grid-model`. They are drawn in the accent color across
   * the whole view while the drag lasts.
   */
  readonly snapped?:{readonly x?:SnapHit;readonly y?:SnapHit};
  className?:string;
  unstyled?:boolean;
}

/**
 * Grid and snap feedback layer (B-04). Draws the grid's major lines and, when
 * they are far enough apart on screen, its subdivisions; lines that would be
 * closer than 6 units are left out rather than drawn as a smear. Lines a drag
 * has snapped to are drawn over the grid. The layer takes no touches and is
 * hidden from screen readers; announce snaps with `snapSummary`. The snapping
 * math lives in `snap-grid-model` so the host's drag uses the same lines the
 * overlay draws.
 */
export function SnapGridOverlay({viewport,grid,snapped,className,unstyled=false,style,...rest}:SnapGridOverlayProps){
  validateViewport(viewport);
  if(snapped?.x)validateSnapHit(snapped.x,"x");
  if(snapped?.y)validateSnapHit(snapped.y,"y");
  const {vertical,horizontal}=gridLines(grid,viewport);
  const styled=!unstyled;
  const line=joinClasses(styled&&"bg-border");
  const sx=snapped?.x?docToScreen(viewport,"x",snapped.x.line.value):undefined;
  const sy=snapped?.y?docToScreen(viewport,"y",snapped.y.line.value):undefined;
  return <View {...rest} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden
    {...{className:joinClasses(className)}}
    style={[{position:"absolute",left:0,top:0,width:viewport.width,height:viewport.height,overflow:"hidden",direction:"ltr"},style]}>
    {vertical.map((l,i)=><View key={"v"+i} {...{className:line}}
      style={{position:"absolute",top:0,bottom:0,left:l.offset,width:1,opacity:l.major?0.9:0.4}}/>)}
    {horizontal.map((l,i)=><View key={"h"+i} {...{className:line}}
      style={{position:"absolute",left:0,right:0,top:l.offset,height:1,opacity:l.major?0.9:0.4}}/>)}
    {sx!==undefined?<View testID="snap-line-x" {...{className:joinClasses(styled&&"bg-accent")}}
      style={{position:"absolute",top:0,bottom:0,left:sx-0.5,width:1}}/>:null}
    {sy!==undefined?<View testID="snap-line-y" {...{className:joinClasses(styled&&"bg-accent")}}
      style={{position:"absolute",left:0,right:0,top:sy-0.5,height:1}}/>:null}
    {sx!==undefined&&sy!==undefined?<View {...{className:joinClasses(styled&&"border-2 border-accent bg-surface-raised")}}
      style={{position:"absolute",left:sx-5,top:sy-5,width:10,height:10,borderRadius:5}}/>:null}
  </View>;
}
