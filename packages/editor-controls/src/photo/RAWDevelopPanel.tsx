import {View,Text,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {ExposureAndWhiteBalance} from './ExposureAndWhiteBalance.tsx';
import {ToneAndPresence} from './ToneAndPresence.tsx';
import {EightBandColorMixer} from './EightBandColorMixer.tsx';
import {LensCorrectionPanel,type LensProfile} from './LensCorrectionPanel.tsx';
import {parsePhotoDevelop,serializePhotoDevelop,validatePhotoDevelop,type PhotoDevelopSettings} from './photo-adjustments.ts';
import { tokens } from '../tokens.ts';
export type {PhotoDevelopSettings} from './photo-adjustments.ts';
export interface RAWDevelopPanelProps extends Omit<ViewProps,'children'> {
 readonly photoId:string;
 readonly revision:string|number;
 readonly value:PhotoDevelopSettings;
 /** Camera/engine-specific defaults, not assumed to be a universal RAW white balance. */
 readonly defaults:PhotoDevelopSettings;
 /** Settings at the beginning of the host's edit session. Original pixels never change. */
 readonly baseline:PhotoDevelopSettings;
 readonly profiles:readonly LensProfile[];
 readonly onCommit:(settings:PhotoDevelopSettings)=>void;
 readonly onCopy:(payload:string,signal:AbortSignal)=>void|Promise<void>;
 readonly onPaste:(signal:AbortSignal)=>string|Promise<string>;
 readonly disabled?:boolean;
 readonly unstyled?:boolean;
}
/** Composes non-destructive RAW settings; does not decode RAW or simulate an image transform. */
export function RAWDevelopPanel({photoId,revision,value,defaults,baseline,profiles,onCommit,onCopy,onPaste,disabled=false,unstyled=false,...props}:RAWDevelopPanelProps){
 if(!photoId.trim()||photoId.length>256||!(typeof revision==='string'||Number.isSafeInteger(revision)))throw new TypeError('Develop panel requires a photo identity and revision');
 validatePhotoDevelop(value);validatePhotoDevelop(defaults);validatePhotoDevelop(baseline);
 const action=useOwnedAction(JSON.stringify([photoId,revision]));
 const locked=disabled||action.pending!==null;
 const serialized=serializePhotoDevelop(value);
 const commit=(next:PhotoDevelopSettings)=>{if(locked)return;validatePhotoDevelop(next);if(serializePhotoDevelop(next)!==serialized)onCommit(next);};
 return <View key={photoId} {...props} style={[{gap:tokens.spacing.fixedGroup},props.style]}>
  <Text {...{className:joinClasses(!unstyled&&'text-text')}}>Non-destructive develop settings</Text>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.fixedElement}}>
   <Button title="Reset develop defaults" disabled={locked||serializePhotoDevelop(defaults)===serialized} unstyled={unstyled} onPress={()=>commit(parsePhotoDevelop(serializePhotoDevelop(defaults)))}/>
   <Button title="Revert develop edits" disabled={locked||serializePhotoDevelop(baseline)===serialized} unstyled={unstyled} onPress={()=>commit(parsePhotoDevelop(serializePhotoDevelop(baseline)))}/>
   <Button title="Copy develop settings" disabled={locked} unstyled={unstyled} onPress={()=>{if(!locked)void action.run('copy',signal=>onCopy(serialized,signal));}}/>
   <Button title="Paste develop settings" disabled={locked} unstyled={unstyled} onPress={()=>{if(!locked)void action.run('paste',async signal=>parsePhotoDevelop(await onPaste(signal)),next=>onCommit(next));}}/>
   {action.pending!==null?<Button title="Cancel settings transfer" unstyled={unstyled} onPress={action.cancel}/>:null}
  </View>
  <ErrorMessage {...(action.error?{message:action.error}:{})} unstyled={unstyled}/>
  <ExposureAndWhiteBalance value={value.exposure} onCommit={exposure=>commit({...value,exposure})} disabled={locked} unstyled={unstyled}/>
  <ToneAndPresence value={value.tone} onCommit={tone=>commit({...value,tone})} disabled={locked} unstyled={unstyled}/>
  <LensCorrectionPanel value={value.lens} profiles={profiles} onCommit={lens=>commit({...value,lens})} disabled={locked} unstyled={unstyled}/>
  <EightBandColorMixer value={value.mixer} onCommit={mixer=>commit({...value,mixer})} disabled={locked} unstyled={unstyled}/>
 </View>;
}
