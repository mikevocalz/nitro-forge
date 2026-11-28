import type {ReactNode} from "react";
import {Pressable,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {Button} from "@nyc-tron/ui/components/Button";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {FloatingPaletteUndockHandle} from "./FloatingPaletteUndockHandle.tsx";
import {
  FLOATING_PALETTE_WIDTH,PALETTE_MODES,placeFloatingPalette,
  type PaletteMode,type PalettePosition,type PaletteRect,
} from "./floating-palette.ts";

/** Props for {@linkcode FloatingColorPalette}. */
export interface FloatingColorPaletteProps extends Omit<ViewProps,"children"> {
  readonly docked:boolean;
  /** Floating top-left in the parent's coordinates. Ignored while docked. */
  readonly position:PalettePosition;
  /** The parent's area the floating palette stays inside, in its own coordinates (usually 0,0,width,height). */
  readonly bounds:PaletteRect;
  /** Hinges, folds and cutouts in the same coordinates; the palette is never drawn across one. */
  readonly obstacles?:readonly PaletteRect[];
  readonly mode:PaletteMode;
  readonly onModeChange:(mode:PaletteMode)=>void;
  readonly onUndock:(position:PalettePosition)=>void;
  readonly onMove:(position:PalettePosition)=>void;
  readonly onDock:()=>void;
  /** Shows Close on the floating palette. */
  readonly onClose?:()=>void;
  /** The picker for each mode. The host renders it against its one color store. */
  readonly children:(mode:PaletteMode)=>ReactNode;
  /** @default "Colors" */
  readonly title?:string;
  /** Floating width. @default 260 */
  readonly floatingWidth?:number;
  className?:string;
  unstyled?:boolean;
}

/**
 * Dockable color palette (C-26). Docked, it sits in the host's layout; dragged
 * by its grip (B-28) past the undock distance, it floats over the parent at
 * `position` and moves until docked again. Compact, Classic and Palettes tabs
 * switch what `children(mode)` renders. The palette holds no color: every
 * picker inside edits the host's active document color, so docking or
 * switching modes never changes or forgets a color.
 *
 * The floating position is passed through `placeFloatingPalette` on every
 * render, so after a rotation or a fold the palette is drawn on screen and off
 * the hinge even before the host stores a new position.
 */
export function FloatingColorPalette({
  docked,position,bounds,obstacles,mode,onModeChange,onUndock,onMove,onDock,onClose,children,
  title="Colors",floatingWidth=FLOATING_PALETTE_WIDTH,className,unstyled=false,testID,style,...rest
}:FloatingColorPaletteProps){
  const [state,store]=useLocalStore(()=>({x:0,y:0,width:0,height:0,preview:undefined as PalettePosition|undefined}));
  const styled=!unstyled;
  const size={width:docked?state.width||floatingWidth:floatingWidth,height:state.height||320};
  const placed=placeFloatingPalette(state.preview??position,{width:floatingWidth,height:size.height},bounds,obstacles);
  const origin=docked?{x:state.x,y:state.y}:placed.position;
  const id=(s:string)=>testID?{testID:testID+"-"+s}:{};
  const floatingStyle=docked?null:{position:"absolute" as const,left:placed.position.x,top:placed.position.y,width:floatingWidth,zIndex:10};
  return <View {...rest} {...(testID?{testID}:{})}
    role={docked?"region":"dialog"} accessibilityLabel={docked?title:`${title}, floating`}
    onLayout={e=>{const l=e.nativeEvent.layout;store.set(s=>({...s,x:docked?l.x:s.x,y:docked?l.y:s.y,width:l.width,height:l.height}));}}
    {...{className:joinClasses(styled&&"rounded-card border border-border bg-surface-raised",styled&&!docked&&"shadow-lg",className)}}
    style={[{paddingBottom:12,gap:8},floatingStyle,style]}>
    <View style={{paddingTop:2}}>
      <FloatingPaletteUndockHandle docked={docked} origin={origin} size={{width:floatingWidth,height:size.height}}
        bounds={bounds} obstacles={obstacles} unstyled={unstyled} label={title+" palette"}
        onPreview={p=>store.set(s=>({...s,preview:p}))} onUndock={onUndock} onMove={onMove} onDock={onDock} {...id("handle")}/>
    </View>
    <View style={{flexDirection:"row",alignItems:"center",paddingHorizontal:12,gap:8}}>
      <Text accessibilityRole="header" {...{className:joinClasses(styled&&"text-text text-lg font-semibold")}} style={{flex:1}}>{title}</Text>
      {docked?null:<Button title="Dock" variant="secondary" size="sm" onPress={onDock} {...id("dock")}/>}
      {!docked&&onClose?<Button title="Close" variant="ghost" size="sm" onPress={onClose} {...id("close")}/>:null}
    </View>
    {placed.overlapsObstacle&&!docked?<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}} style={{paddingHorizontal:12}}>
      This screen is too small to keep the palette clear of the fold.
    </Text>:null}
    <View accessibilityRole="tablist" style={{flexDirection:"row",paddingHorizontal:12,gap:6}}>
      {PALETTE_MODES.map(m=>{
        const on=m.mode===mode;
        return <Pressable key={m.mode} accessibilityRole="tab" aria-selected={on} accessibilityState={{selected:on}}
          onPress={()=>onModeChange(m.mode)} {...id("mode-"+m.mode)}
          {...{className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
            styled&&(on?"border-focus bg-surface-sunken":"border-transparent"))}}
          style={{flex:1,minHeight:44,alignItems:"center",justifyContent:"center"}}>
          <Text {...{className:joinClasses(styled&&"text-sm",styled&&(on?"text-text font-semibold":"text-text-muted"))}}>{m.label}</Text>
        </Pressable>;
      })}
    </View>
    <View style={{paddingHorizontal:12}}>{children(mode)}</View>
  </View>;
}
