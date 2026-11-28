import {Text,TextInput,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {alphaPercent,assertRgba,rgbaToHex,type RgbaColor} from "../color.ts";
import {ChannelTrack} from "./ChannelTrack.tsx";
import {parseOpacityPercent} from "./channel-fields.ts";
import { tokens } from "../tokens.ts";

/** Props for {@linkcode AlphaSlider}. */
export interface AlphaSliderProps extends Omit<ViewProps,"children"> {
  /** The committed color. Only its alpha changes. */
  readonly value:RgbaColor;
  /** Every drag move. Show it on the canvas; never write it to the document. */
  readonly onPreview?:(next:RgbaColor)=>void;
  /** Once per drag release, key press or typed entry that changes the alpha. */
  readonly onCommit:(next:RgbaColor)=>void;
  /** @default "Opacity" */
  readonly label?:string;
  readonly disabled?:boolean;
  /** Track runs right to left. @default I18nManager.isRTL */
  readonly rtl?:boolean;
  className?:string;
  unstyled?:boolean;
}

/**
 * Controlled opacity slider (C-05): a checkerboard under a transparent-to-opaque
 * gradient of the current color, a 44pt drag track and a percent field for
 * direct entry. Dragging previews through `onPreview`; release, arrow keys and
 * a typed value each commit once through `onCommit`.
 */
export function AlphaSlider({
  value,onPreview,onCommit,label="Opacity",disabled=false,rtl,className,unstyled=false,testID,style,...rest
}:AlphaSliderProps){
  assertRgba(value);
  const [draft,store]=useLocalStore(()=>({text:undefined as string|undefined,error:false}));
  const styled=!unstyled;
  const opaque={...value,alpha:1};
  const shown=draft.text??String(alphaPercent(value.alpha));
  // Reads the store, not the render's draft: submit and blur can both fire
  // before a re-render, and the second call must see the cleared draft.
  const apply=()=>{
    if(disabled)return;
    const d=store.get();
    if(d.text===undefined)return;
    const n=parseOpacityPercent(d.text);
    if(n===undefined){store.set({text:d.text,error:true});return;}
    store.set({text:undefined,error:false});
    const alpha=Math.round(n*100)/10000;
    if(alpha!==value.alpha)onCommit({...value,alpha});
  };
  return <View {...rest} testID={testID} {...{className:joinClasses("gap-1",className)}} style={style}>
    <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:tokens.spacing.fixedElement,minHeight:tokens.spacing.fixedTarget}}>
      <Text {...{className:joinClasses(styled&&"text-text text-sm font-semibold")}}>{label}</Text>
      <View {...{className:joinClasses(styled&&"rounded-control border bg-surface-sunken",styled&&(draft.error?"border-danger":"border-border"))}}
        style={{flexDirection:"row",alignItems:"center",minHeight:tokens.spacing.fixedTarget,paddingHorizontal:tokens.spacing.off10}}>
        <TextInput value={shown} editable={!disabled} keyboardType="decimal-pad" returnKeyType="done" selectTextOnFocus
          accessibilityLabel={label+" percent"}
          onChangeText={text=>store.set({text,error:false})}
          onSubmitEditing={apply} onBlur={apply}
          {...{className:joinClasses(styled&&"text-text font-semibold")}}
          style={{width:tokens.spacing.fixedTarget,textAlign:"right",fontVariant:["tabular-nums"],paddingVertical:tokens.spacing.off6}}/>
        <Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}} style={{paddingLeft:tokens.spacing.off2}}>%</Text>
      </View>
    </View>
    <ChannelTrack label={label} value={value.alpha} checker step={0.01} rtl={rtl} disabled={disabled} unstyled={unstyled}
      stops={[{...value,alpha:0},opaque]}
      valueText={a=>alphaPercent(a)+" percent"}
      thumbColor={a=>rgbaToHex({...value,alpha:a})}
      onPreview={onPreview?a=>onPreview({...value,alpha:a}):undefined}
      onCommit={a=>onCommit({...value,alpha:a})}
      {...(testID?{testID:testID+"-track"}:{})}/>
    {draft.error?<Text accessibilityLiveRegion="polite" {...{className:joinClasses(styled&&"text-danger text-xs")}}>
      Enter a percent from 0 to 100.
    </Text>:null}
  </View>;
}
