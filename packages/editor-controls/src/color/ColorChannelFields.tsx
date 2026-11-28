import {Pressable,Text,TextInput,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {alphaPercent,assertHsv,hsvToRgb,parseHexColor,rgbaEditToHsv,rgbaToHex,type HsvColor} from "../color.ts";
import {CHANNEL_MODELS,channelFields,parseChannel,parseOpacityPercent,readChannels,writeChannel,type ChannelModel} from "./channel-fields.ts";

/** Props for {@linkcode ColorChannelFields}. */
export interface ColorChannelFieldsProps extends Omit<ViewProps,"children"> {
  /** The committed color, as HSV so hue survives gray. */
  readonly value:HsvColor;
  /** One commit per accepted field entry (Enter, blur or an arrow key). */
  readonly onCommit:(next:HsvColor)=>void;
  /** The channel set shown. Keep it in the host's preferences. */
  readonly model:ChannelModel;
  readonly onModelChange:(model:ChannelModel)=>void;
  /** Shows the opacity field. @default true */
  readonly showAlpha?:boolean;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

type Draft={key:string;text:string;error?:string};
const same=(a:HsvColor,b:HsvColor)=>a.h===b.h&&a.s===b.s&&a.v===b.v&&a.alpha===b.alpha;

/**
 * Typed color entry (C-06): RGB, HSL or HSV channels, hex and opacity. Each
 * field commits once on Enter or blur; Arrow Up/Down step it by one and commit.
 * An invalid entry keeps the draft, marks the field and says what range is
 * accepted. RGB sliders stay in `ColorChannels`; this control is the numeric
 * path and needs no optional peer.
 */
export function ColorChannelFields({
  value,onCommit,model,onModelChange,showAlpha=true,disabled=false,className,unstyled=false,testID,style,...rest
}:ColorChannelFieldsProps){
  assertHsv(value);
  const [draft,store]=useLocalStore(()=>undefined as Draft|undefined);
  const styled=!unstyled;
  const values=readChannels(value,model);
  const fields=channelFields(model);
  const hex=rgbaToHex(hsvToRgb(value),showAlpha);
  const commit=(next:HsvColor)=>{if(!disabled&&!same(next,value))onCommit(next);};
  // Reads the store, not the render's draft: submit and blur can both fire
  // before a re-render, and the second call must see the cleared draft.
  const apply=(key:string,parse:(text:string)=>HsvColor|string)=>{
    const d=store.get();
    if(!d||d.key!==key)return;
    const result=parse(d.text);
    if(typeof result==="string"){store.set({...d,error:result});return;}
    store.set(undefined);
    commit(result);
  };
  const field=(key:string,label:string,shown:string,parse:(text:string)=>HsvColor|string,step?:(d:1|-1)=>void,width?:number,unit?:string)=>{
    const editing=draft?.key===key;
    const error=editing?draft.error:undefined;
    return <View key={key} style={{flex:width?undefined:1,width,minWidth:0,gap:4}}>
      <Text {...{className:joinClasses(styled&&"text-text-muted text-xs")}}>{label}</Text>
      <View {...{className:joinClasses(styled&&"rounded-control border bg-surface-sunken",styled&&(error?"border-danger":"border-border"))}}
        style={{flexDirection:"row",alignItems:"center",minHeight:44,paddingHorizontal:8}}>
      <TextInput value={editing?draft.text:shown} editable={!disabled} selectTextOnFocus
        accessibilityLabel={label} aria-invalid={Boolean(error)}
        autoCapitalize="characters" autoCorrect={false}
        onChangeText={text=>store.set({key,text})}
        onSubmitEditing={()=>apply(key,parse)} onBlur={()=>apply(key,parse)}
        onKeyPress={e=>{
          const k=e.nativeEvent.key;
          if(step&&(k==="ArrowUp"||k==="ArrowDown")){store.set(undefined);step(k==="ArrowUp"?1:-1);}
        }}
        {...{className:joinClasses(styled&&"text-text")}}
        style={{flex:1,minWidth:0,minHeight:40,fontVariant:["tabular-nums"]}}/>
      {unit?<Text {...{className:joinClasses(styled&&"text-text-muted text-sm")}}>{unit}</Text>:null}
      </View>
      {error?<Text accessibilityLiveRegion="polite" {...{className:joinClasses(styled&&"text-danger text-xs")}}>{error}</Text>:null}
    </View>;
  };
  return <View {...rest} testID={testID} {...{className:joinClasses("gap-3",styled&&"rounded-control bg-surface-raised p-3",className)}} style={style}>
    <View accessibilityRole="radiogroup" accessibilityLabel="Color model" style={{flexDirection:"row",gap:6}}>
      {CHANNEL_MODELS.map(m=>{
        const on=m.model===model;
        return <Pressable key={m.model} accessibilityRole="radio" accessibilityState={{checked:on,disabled}}
          aria-checked={on} disabled={disabled} onPress={()=>{store.set(undefined);onModelChange(m.model);}}
          {...{className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
            styled&&(on?"border-focus bg-surface-sunken":"border-border bg-surface-raised"))}}
          style={{flex:1,minHeight:44,alignItems:"center",justifyContent:"center"}}>
          <Text {...{className:joinClasses(styled&&(on?"text-text font-semibold":"text-text-muted"))}}>{m.label}</Text>
        </Pressable>;
      })}
    </View>
    <View style={{flexDirection:"row",gap:8}}>
      {fields.map((f,i)=>{
        const index=i as 0|1|2;
        const range=`Enter ${f.label.toLowerCase()} from 0 to ${f.max}${f.unit==="%"?" percent":f.unit==="°"?" degrees":""}.`;
        return field(model+i,f.label,String(values[i]),
          text=>{const n=parseChannel(text,f.max);return n===undefined?range:writeChannel(value,model,index,n);},
          d=>{const n=Math.max(0,Math.min(f.max,values[i]!+d));commit(writeChannel(value,model,index,n));},undefined,f.unit||undefined);
      })}
    </View>
    <View style={{flexDirection:"row",gap:8}}>
      {field("hex","Hex",hex,text=>{
        try{
          const parsed=parseHexColor(text);
          // #RGB and #RRGGBB carry no alpha; keep the current opacity for them.
          const digits=text.trim().replace(/^#/,"").length;
          return rgbaEditToHsv(digits===4||digits===8?parsed:{...parsed,alpha:value.alpha},value);
        }
        catch{return "Enter #RGB, #RRGGBB or #RRGGBBAA.";}
      })}
      {showAlpha?field("alpha","Opacity",String(alphaPercent(value.alpha)),text=>{
        const n=parseOpacityPercent(text);
        return n===undefined?"Enter a percent from 0 to 100.":{...value,alpha:Math.round(n*100)/10000};
      },d=>commit({...value,alpha:Math.max(0,Math.min(100,alphaPercent(value.alpha)+d))/100}),104,"%"):null}
    </View>
  </View>;
}
