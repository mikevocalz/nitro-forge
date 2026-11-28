import {useLayoutEffect,useRef} from "react";
import {Text,View,type ViewProps} from "react-native";
import {SettingSwitch as Switch} from "@nyc-tron/ui/components/forms/SettingSwitch";
import {PrecisionScrubber} from "@nyc-tron/ui/components/shell/PrecisionScrubber";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {
  GRID_MAX_SPACING,GRID_MAX_SUBDIVISIONS,GRID_MIN_SPACING,SNAP_MAX_THRESHOLD,SNAP_MIN_THRESHOLD,
  validateGrid,validateSnap,type GridSettings,type SnapSettings,
} from "./snap-grid-model.ts";

/** Props for {@linkcode SnapGridSettings}. */
export interface SnapGridSettingsProps extends Omit<ViewProps,"children"> {
  readonly scope?:string;
  readonly revision?:string|number;
  readonly grid:GridSettings;
  readonly snap:SnapSettings;
  /** Once per toggle, scrubber release, nudge or typed value, with the whole new grid. */
  readonly onGridChange:(grid:GridSettings)=>void;
  /** Once per toggle, scrubber release, nudge or typed value, with the whole new snap settings. */
  readonly onSnapChange:(snap:SnapSettings)=>void;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

/**
 * Small settings control for the grid and snapping (B-04): show grid, grid
 * spacing and subdivisions, the snapping switch, what to snap to, snap
 * distance in screen units and magnetism strength. Numbers use
 * `PrecisionScrubber`, so they can be dragged, stepped, typed or adjusted by
 * a screen reader, and each change commits once. With snapping off, turning
 * on a target also turns snapping on, so no switch in the panel is inert.
 */
export function SnapGridSettings({scope="canvas-grid",revision=0,grid,snap,onGridChange:commitGrid,onSnapChange:commitSnap,disabled=false,className,unstyled=false,...rest}:SnapGridSettingsProps){
  validateGrid(grid);
  validateSnap(snap);
  if(!scope.trim()||scope.length>512||typeof revision==='number'&&!Number.isFinite(revision)||typeof revision==='string'&&revision.length>512)throw new RangeError('Invalid grid settings identity');
  const boundary=JSON.stringify([scope,revision,disabled,grid,snap]);
  const mounted=useRef(false),committed=useRef(boundary);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useLayoutEffect(()=>{committed.current=boundary;});
  const valid=()=>mounted.current&&committed.current===boundary&&!disabled;
  const onGridChange=(value:GridSettings)=>{if(valid())commitGrid(value);};
  const onSnapChange=(value:SnapSettings)=>{if(valid())commitSnap(value);};
  const styled=!unstyled;
  const target=(key:"toGrid"|"toGuides"|"toArtboards")=>(on:boolean)=>
    onSnapChange(snap.enabled?{...snap,[key]:on}:{...snap,enabled:true,[key]:true});
  const heading=(text:string)=><Text role="heading" aria-level={3}
    {...{className:joinClasses(styled&&"text-text text-sm font-semibold")}}>{text}</Text>;
  return <View {...rest} accessibilityLabel="Grid and snapping" {...{role:"group",className:joinClasses(styled&&"gap-3",className)}}>
    <View style={{gap:4}}>
      {heading("Grid")}
      <Switch label="Show grid" on={grid.visible} disabled={disabled} styled={styled} onChange={visible=>onGridChange({...grid,visible})}/>
      <PrecisionScrubber scope={scope} revision={revision} label="Spacing" unit="px" value={grid.spacing} min={GRID_MIN_SPACING} max={GRID_MAX_SPACING} step={1}
        detents={[8,16,32,64,128]} disabled={disabled} unstyled={unstyled} onCommit={spacing=>onGridChange({...grid,spacing})}/>
      <PrecisionScrubber scope={scope} revision={revision} label="Subdivisions" value={grid.subdivisions} min={1} max={GRID_MAX_SUBDIVISIONS} step={1}
        disabled={disabled} unstyled={unstyled} onCommit={n=>onGridChange({...grid,subdivisions:Math.round(n)})}/>
    </View>
    <View style={{gap:4}}>
      {heading("Snapping")}
      <Switch label="Snap while dragging" on={snap.enabled} disabled={disabled} styled={styled} onChange={enabled=>onSnapChange({...snap,enabled})}/>
      <View accessibilityLabel="Snap to" {...{role:"group"}}>
        <Switch label="Grid" on={snap.enabled&&snap.toGrid} disabled={disabled} styled={styled} onChange={target("toGrid")}
          hint={snap.enabled?undefined:"Turns snapping on"}/>
        <Switch label="Guides" on={snap.enabled&&snap.toGuides} disabled={disabled} styled={styled} onChange={target("toGuides")}
          hint={snap.enabled?undefined:"Turns snapping on"}/>
        <Switch label="Artboard edges" on={snap.enabled&&snap.toArtboards} disabled={disabled} styled={styled} onChange={target("toArtboards")}
          hint={snap.enabled?undefined:"Turns snapping on"}/>
      </View>
      {snap.enabled?null:<Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>
        Snapping is off. Turning on a target turns it back on.</Text>}
      <PrecisionScrubber scope={scope} revision={revision} label="Snap distance" unit="pt" value={snap.thresholdPx} min={SNAP_MIN_THRESHOLD} max={SNAP_MAX_THRESHOLD} step={1}
        disabled={disabled} unstyled={unstyled} onCommit={thresholdPx=>onSnapChange({...snap,thresholdPx})}/>
      <PrecisionScrubber scope={scope} revision={revision} label="Magnetism" unit="%" value={Math.round(snap.strength*100)} min={0} max={100} step={5}
        disabled={disabled} unstyled={unstyled} onCommit={pct=>onSnapChange({...snap,strength:Math.round(pct)/100})}/>
    </View>
  </View>;
}

