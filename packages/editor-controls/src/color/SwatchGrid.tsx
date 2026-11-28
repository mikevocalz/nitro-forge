import {useRef} from "react";
import {I18nManager,Pressable,Text,TextInput,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {Button} from "@nyc-tron/ui/components/Button";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {keyboardKey,type KeyEventLike} from "@nyc-tron/ui/components/gestures/drag-transport";
import {rgbaToHex} from "../color.ts";
import {filterSwatchGroups,swatchColumns,swatchGridMove,swatchKey,type Swatch,type SwatchGroup,type SwatchGroupKind} from "./swatches.ts";
import { tokens } from "../tokens.ts";

/** Props for {@linkcode SwatchGrid}. */
export interface SwatchGridProps extends Omit<ViewProps,"children"> {
  /** Recent, document, saved and named groups, in display order. The host persists them. */
  readonly groups:readonly SwatchGroup[];
  /** Applies a swatch. One commit per press. */
  readonly onSelect:(swatch:Swatch,group:SwatchGroup)=>void;
  /** `swatchKey` of the color in use, to mark matching swatches. */
  readonly selectedKey?:string;
  /** The search text. Keep it in the host if it should survive a remount. */
  readonly query:string;
  readonly onQueryChange:(query:string)=>void;
  readonly disabled?:boolean;
  /** Layout is right to left, which flips Left/Right arrow keys. Rows follow the platform's own RTL mirroring. @default I18nManager.isRTL */
  readonly rtl?:boolean;
  className?:string;
  unstyled?:boolean;
}

const CELL=44;
const GAP=6;
const EMPTY:Record<SwatchGroupKind,string>={
  recent:"Colors you apply appear here.",
  document:"This document has no colors yet.",
  saved:"No saved colors. Save one from the picker to keep it here.",
  named:"No named colors in this set.",
};

/**
 * Searchable swatch groups (C-13). Search matches names and hex prefixes; a
 * search with no match says so and offers to clear it. Each swatch is a 44pt
 * button named for screen readers by its color name or hex. On web, arrow keys
 * move focus within a group, Home/End jump to its ends.
 */
export function SwatchGrid({
  groups,onSelect,selectedKey,query,onQueryChange,disabled=false,rtl=I18nManager.isRTL,
  className,unstyled=false,testID,style,...rest
}:SwatchGridProps){
  const [layout,store]=useLocalStore(()=>({width:0}));
  const refs=useRef(new Map<string,{focus?:()=>void}|null>());
  const styled=!unstyled;
  const shown=filterSwatchGroups(groups,query);
  const columns=swatchColumns(layout.width,CELL,GAP);
  const trimmed=query.trim();
  return <View {...rest} {...(testID?{testID}:{})} {...{className:joinClasses("gap-3",className)}} style={style}
    onLayout={e=>store.set({width:e.nativeEvent.layout.width})}>
    <TextInput value={query} onChangeText={onQueryChange} editable={!disabled}
      placeholder="Search by name or hex" accessibilityLabel="Search swatches"
      autoCorrect={false} autoCapitalize="none" returnKeyType="search"
      {...{className:joinClasses(styled&&"rounded-control border border-border bg-surface-sunken text-text px-3 focus:border-focus")}}
      style={{minHeight:tokens.spacing.fixedTarget}}/>
    {trimmed&&shown.length===0?<View style={{gap:tokens.spacing.fixedElement,alignItems:"flex-start"}}>
      <Text accessibilityLiveRegion="polite" {...{className:joinClasses(styled&&"text-text-muted text-sm")}}>
        {`No swatches match “${trimmed}”.`}
      </Text>
      <Button title="Clear search" variant="secondary" size="sm" disabled={disabled} onPress={()=>onQueryChange("")}/>
    </View>:null}
    {shown.map(group=><View key={group.id} style={{gap:tokens.spacing.off6}}>
      <Text accessibilityRole="header" {...{className:joinClasses(styled&&"text-text text-sm font-semibold")}}>{group.label}</Text>
      {group.swatches.length===0?<Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}}>{EMPTY[group.kind]}</Text>:
      <View style={{flexDirection:"row",flexWrap:"wrap",gap:GAP}}>
        {group.swatches.map((swatch,index)=>{
          const key=swatchKey(swatch);
          const on=key===selectedKey;
          const name=swatch.name??rgbaToHex(swatch.color,swatch.color.alpha<1);
          const refKey=group.id+"/"+index;
          const onKeyDown=(event:KeyEventLike)=>{
            const next=swatchGridMove(index,keyboardKey(event),columns,group.swatches.length,rtl);
            if(next===undefined||next===index)return;
            (event as {preventDefault?:()=>void}).preventDefault?.();
            refs.current.get(group.id+"/"+next)?.focus?.();
          };
          return <Pressable key={group.id+swatch.id} ref={r=>{refs.current.set(refKey,r as {focus?:()=>void}|null);}}
            accessibilityRole="button" accessibilityLabel={swatch.name?`${swatch.name}, ${rgbaToHex(swatch.color,false)}`:name}
            accessibilityState={{selected:on,disabled}} aria-selected={on}
            disabled={disabled} onPress={()=>onSelect(swatch,group)}
            {...{onKeyDown,className:joinClasses(styled&&"rounded-control border-2 focus-visible:ring-2 focus-visible:ring-focus",
              styled&&(on?"border-focus":"border-border"))}}
            style={{width:CELL,height:CELL,padding:tokens.spacing.off2}}>
            <View pointerEvents="none" {...{className:joinClasses(styled&&"rounded-control")}}
              style={{flex:1,backgroundColor:rgbaToHex(swatch.color)}}/>
          </Pressable>;
        })}
      </View>}
    </View>)}
  </View>;
}
