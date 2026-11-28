import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {ToolButton,officeKey,type OfficeKeyEvent} from "../office/office-controls.tsx";
import {ANNOTATION_TOOL_INFO,orderTools,toolForKey,type AnnotationTool} from "./annotation-model.ts";

/** Props for {@linkcode AnnotationToolbar}. */
export interface AnnotationToolbarProps extends Omit<ViewProps,"children">,ScopedControlProps {
  /**
   * Tools the host can save. Pass only subtypes the PDF engine writes; a tool
   * the engine cannot store is left out, never drawn disabled.
   */
  readonly tools:readonly AnnotationTool[];
  readonly activeTool:AnnotationTool;
  readonly onToolChange:(tool:AnnotationTool)=>void;
  /** Undo control; renders only when passed. */
  readonly onUndo?:()=>void;
  readonly canUndo?:boolean;
  /** Redo control; renders only when passed. */
  readonly onRedo?:()=>void;
  readonly canRedo?:boolean;
  /** One-line instruction for the active tool, e.g. "Drag across text to highlight it." */
  readonly hint?:string;
  /** @default "Markup tools" */
  readonly label?:string;
  className?:string;
  unstyled?:boolean;
}

/**
 * PDF markup toolbar (K-06): one 44pt toggle per tool the engine can save,
 * plus undo and redo. Tool names are set in their own effect (underlined,
 * struck through) so the row reads without icons. On web, V/N/H/U/S/D/R/E pick
 * tools and Escape returns to Select.
 */
export function AnnotationToolbar({scope='pdf-annotations',revision=0,...props}:AnnotationToolbarProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.tools,props.disabledReason]),guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <><ErrorMessage message={guard.error??props.disabledReason} unstyled={props.unstyled}/><AnnotationToolbarBody {...props}
 onToolChange={tool=>{const h=guard.current();if(h?.tools.includes(tool))h.onToolChange(tool);}}
 onUndo={props.onUndo?()=>guard.run('undo',h=>h.canUndo!==false?h.onUndo?.():undefined):undefined}
 onRedo={props.onRedo?()=>guard.run('redo',h=>h.canRedo!==false?h.onRedo?.():undefined):undefined}/></>;
}
function AnnotationToolbarBody({
  tools,activeTool,onToolChange,onUndo,canUndo=true,onRedo,canRedo=true,hint,label="Markup tools",
  className,unstyled=false,scope:_scope,revision:_revision,disabledReason,...rest
}:AnnotationToolbarProps){
  const styled=!unstyled;
  const ordered=orderTools(tools);
  const onKeyDown=(e:OfficeKeyEvent)=>{
    const {key,mod,alt}=officeKey(e);
    if(mod||alt)return;
    const tool=toolForKey(key,ordered);
    if(tool&&tool!==activeTool){(e as unknown as {preventDefault?:()=>void}).preventDefault?.();onToolChange(tool);}
  };
  return <View {...rest} {...{onKeyDown}} {...{className:joinClasses("min-w-0",className)}} style={[{gap:6},rest.style as object]}>
    <View accessibilityRole="toolbar" accessibilityLabel={label}
      {...{className:joinClasses(styled&&"rounded-control border border-border bg-surface-raised")}}
      style={{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:4,padding:4}}>
      {ordered.map(tool=>{
        const info=ANNOTATION_TOOL_INFO[tool];
        const on=tool===activeTool;
        return <ToolButton quiet disabled={disabledReason!==undefined} key={tool} label={info.label} checked={on} styled={styled} onPress={()=>onToolChange(tool)}
          accessibilityHint={tool==="select"?undefined:"Shortcut "+info.key.toUpperCase()}>
          <Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text text-sm")}}
            style={{fontWeight:on?"700":"500",textDecorationLine:tool==="underline"?"underline":tool==="strike"?"line-through":"none",
              ...(tool==="highlight"?{paddingHorizontal:3}:null)}}>
            {tool==="highlight"?<Text {...{className:joinClasses(styled&&"bg-accent/10")}}>{info.label}</Text>:info.label}
          </Text>
        </ToolButton>;
      })}
      {onUndo||onRedo?<View {...{className:joinClasses(styled&&"bg-border")}} style={{width:1,alignSelf:"stretch",marginHorizontal:2}}/>:null}
      {onUndo?<ToolButton quiet label="Undo" disabled={!canUndo} styled={styled} onPress={onUndo}/>:null}
      {onRedo?<ToolButton quiet label="Redo" disabled={!canRedo} styled={styled} onPress={onRedo}/>:null}
    </View>
    {hint?<Text accessibilityLiveRegion="polite" {...{className:joinClasses(styled&&"text-text-muted text-sm")}}>{hint}</Text>:null}
  </View>;
}
