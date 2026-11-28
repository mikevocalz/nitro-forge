import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {Pressable,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {OFFICE_TOUCH_TARGET,ToolButton,officeKey,type OfficeKeyEvent} from "../office/office-controls.tsx";
import {LIST_FORMATS,canIndent,defaultLevelFormats,canOutdent,formatLabel,listMarker,listPreviewMarkers,type ListFormat,type ListKind} from "./list-model.ts";
import {exact} from '../exact-optional.ts';

export {BULLETS_NUMBERING_CAPABILITIES} from "./list-model.ts";

/** A paragraph the editor shows in its preview. */
export interface ListPreviewItem {
  readonly id:string;
  readonly text:string;
  /** 0-based nesting level. */
  readonly level:number;
  /** Host-authoritative marker; empty suppresses a marker. Omit for legacy start-at-one preview. */
  readonly marker?:string;
}

/** Props for {@linkcode BulletsNumberingEditor}. Each control renders only when its callback is passed. */
export interface BulletsNumberingEditorProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /** The list as it stands; the selected paragraphs are `[selectionStart, selectionEnd]`. */
  readonly items:readonly ListPreviewItem[];
  readonly selectionStart:number;
  readonly selectionEnd:number;
  /** What the selection is now. */
  readonly kind:ListKind|"mixed";
  /** List kinds the host can store, in order. `none` is "Not a list". */
  readonly kinds:readonly ListKind[];
  readonly onKindChange:(kind:ListKind)=>void;
  /** Per-level formats, index = level. Defaults to bullets everywhere. */
  readonly levelFormats?:readonly ListFormat[];
  /** Changes one level's format; renders the level picker. */
  readonly onLevelFormatChange?:((level:number,format:ListFormat)=>void)|undefined;
  /** Moves the selection one level deeper (+1) or shallower (-1); renders the indent pair. */
  readonly onShiftLevel?:((direction:1|-1)=>void)|undefined;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

const KIND_LABEL:Record<ListKind,string>={none:"Not a list",bullet:"Bulleted",numbered:"Numbered",multilevel:"Multilevel"};

/**
 * Bullets and numbering (H-07): pick the list kind, indent or outdent under
 * the nesting policy in `list-model` (one level deeper than the item above
 * at most, nine levels), pick a format per level, and preview the markers
 * the result produces. On web, Tab and Shift+Tab indent and outdent.
 */
export function BulletsNumberingEditor({scope='BulletsNumberingEditor',revision=0,...props}:BulletsNumberingEditorProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabled,props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <BulletsNumberingEditorBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onKindChange={(...args:Parameters<BulletsNumberingEditorProps['onKindChange']>)=>guard.run('onKindChange',h=>h.onKindChange(...args))}
  onLevelFormatChange={props.onLevelFormatChange?(...args:Parameters<NonNullable<BulletsNumberingEditorProps['onLevelFormatChange']>>)=>guard.run('onLevelFormatChange',h=>h.onLevelFormatChange?.(...args)):undefined}
  onShiftLevel={props.onShiftLevel?(...args:Parameters<NonNullable<BulletsNumberingEditorProps['onShiftLevel']>>)=>guard.run('onShiftLevel',h=>h.onShiftLevel?.(...args)):undefined}
 />;
}
function BulletsNumberingEditorBody({actionError,disabledReason,disabled=false,
  items,selectionStart,selectionEnd,kind,kinds,onKindChange,levelFormats,onLevelFormatChange,onShiftLevel,
  className,unstyled=false,...rest
}:BulletsNumberingEditorProps&{actionError?:string|null}){
  const styled=!unstyled;
  const formats=levelFormats??defaultLevelFormats("bullet");
  const markers=listPreviewMarkers(items,formats,kind);
  const indentOk=onShiftLevel!==undefined&&canIndent(items,selectionStart,selectionEnd);
  const outdentOk=onShiftLevel!==undefined&&canOutdent(items,selectionStart,selectionEnd);
  const deepest=items.reduce((m,it)=>Math.max(m,it.level),0);
  const onKeyDown=(e:OfficeKeyEvent)=>{
    const {key,shift}=officeKey(e);
    if(!onShiftLevel||key!=="Tab")return;
    const dir=shift?-1:1;
    // Tab leaves the editor as usual when the policy refuses the move, so focus is never trapped.
    if(dir>0?indentOk:outdentOk){(e as unknown as {preventDefault?:()=>void}).preventDefault?.();onShiftLevel(dir);}
  };
  const muted=joinClasses(styled&&"text-text-muted text-sm");
  return <View {...rest} accessibilityLabel="Bullets and numbering" {...{role:"group",onKeyDown}}
    {...{className:joinClasses("min-w-0",className)}} style={[{gap:12},rest.style as object]}>
    <View accessibilityRole="radiogroup" accessibilityLabel="List kind" style={{flexDirection:"row",flexWrap:"wrap",gap:4}}>
      {kinds.map(k=><Pressable key={k} accessibilityRole="radio" accessibilityState={{checked:kind===k,disabled}} disabled={disabled} onPress={()=>onKindChange(k)}
        {...{className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
          styled&&(kind===k?"border-accent bg-accent/10":"border-border"))}}
        style={{minHeight:OFFICE_TOUCH_TARGET,paddingHorizontal:12,justifyContent:"center"}}>
        <Text {...{className:joinClasses(styled&&"text-text text-sm")}}>{KIND_LABEL[k]}</Text>
      </Pressable>)}
    </View>
    {onShiftLevel?<View style={{flexDirection:"row",gap:4,flexWrap:"wrap"}}>
      <ToolButton label="Decrease indent" disabled={disabled||!outdentOk} styled={styled} onPress={()=>onShiftLevel(-1)}/>
      <ToolButton label="Increase indent" disabled={disabled||!indentOk} styled={styled} onPress={()=>onShiftLevel(1)}/>
    </View>:null}
    {onLevelFormatChange&&kind!=="none"?<View style={{gap:6}}>
      {Array.from({length:deepest+1},(_,level)=><View key={level} accessibilityLabel={"Level "+(level+1)+" format"}
        {...{role:"radiogroup"}} style={{flexDirection:"row",alignItems:"center",flexWrap:"wrap",gap:4}}>
        <Text {...{className:muted}} style={{width:64}}>{"Level "+(level+1)}</Text>
        {LIST_FORMATS.map(f=>{
          const on=formats[level]===f;
          return <Pressable key={f} accessibilityRole="radio" accessibilityLabel={formatLabel(f)} accessibilityState={{checked:on}}
            disabled={disabled} onPress={()=>onLevelFormatChange(level,f)}
            {...{className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
              styled&&(on?"border-accent bg-accent/10":"border-border"))}}
            style={{minWidth:OFFICE_TOUCH_TARGET,minHeight:OFFICE_TOUCH_TARGET,alignItems:"center",justifyContent:"center",paddingHorizontal:6}}>
            <Text {...{className:joinClasses(styled&&"text-text")}}>{listMarker(f,f==="bullet"?1:2,level)}</Text>
          </Pressable>;
        })}
      </View>)}
    </View>:null}
    <View accessibilityLabel="Preview" {...{role:"list",className:joinClasses(styled&&"rounded-control border border-border bg-surface-sunken")}}
      style={{padding:10,gap:4}}>
      {items.length===0?<Text {...{className:muted}}>Select paragraphs to make a list.</Text>:items.map((it,i)=>{
        const selected=i>=selectionStart&&i<=selectionEnd;
        return <View key={it.id} {...{role:"listitem"}} style={{flexDirection:"row",gap:8,paddingStart:it.level*20}}>
          <Text {...{className:joinClasses(styled&&"text-text-muted")}} style={{minWidth:28,textAlign:"right",fontVariant:["tabular-nums"]}}>{markers[i]}</Text>
          <Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text")}} style={{flex:1,fontWeight:selected?"600":"400"}}>{it.text||" "}</Text>
        </View>;
      })}
    </View>
  <ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/></View>;
}
