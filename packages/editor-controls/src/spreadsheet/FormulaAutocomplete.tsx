import {useRef} from 'react';
import {FlatList,Text,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
export interface FormulaSuggestion {id:string;label:string;kind:'function'|'range'|'name'|'column';insertText:string;signature:string;description:string}
export interface FormulaAutocompleteProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 formula:string;replacement:{start:number;end:number};suggestions:readonly FormulaSuggestion[];open:boolean;
 onAccept:(formula:string,caretUTF16:number,signal?:AbortSignal)=>unknown;onDismiss:()=>void;unstyled?:boolean;
}
/** Uses the host's parser/catalog replacement range; does not guess function semantics or evaluate formulas. */
export function FormulaAutocomplete({scope='formula-autocomplete',revision=0,...props}:FormulaAutocompleteProps){
 const {formula,replacement,suggestions,open,onAccept:_accept,onDismiss,unstyled=false,disabledReason,style,...rest}=props;
 if(formula.length>65536||![replacement.start,replacement.end].every(Number.isSafeInteger)||replacement.start<0||replacement.end<replacement.start||replacement.end>formula.length||suggestions.length>512||new Set(suggestions.map(s=>s.id)).size!==suggestions.length||suggestions.some(s=>!s.id.trim()||s.id.length>256||!s.label.trim()||s.label.length>1024||s.insertText.length>8192||s.signature.length>8192||s.description.length>8192))throw new RangeError('Invalid formula suggestions');
 const owner=JSON.stringify([...controlIdentity(scope,revision),formula,replacement,open,disabledReason]),guard=useScopedControl(owner,props,!open||disabledReason!==undefined),off=guard.pending||!open||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,at=Math.min(useStore(store,s=>s.index),Math.max(0,suggestions.length-1));
 const dismiss=()=>{if(guard.cancel())onDismiss();};
 const accept=(id:string)=>guard.run('accept',(h,s)=>{const choice=h.suggestions.find(v=>v.id===id);if(!choice)return;const next=h.formula.slice(0,h.replacement.start)+choice.insertText+h.formula.slice(h.replacement.end);if(next.length>65536)throw new Error('Formula exceeds the editing limit');return h.onAccept(next,h.replacement.start+choice.insertText.length,s);});
 if(!open)return null;
 return <View {...rest} accessibilityLabel="Formula suggestions" style={[{gap:6},style]} {...{onKeyDown:(e:{nativeEvent:{key:string};preventDefault?:()=>void})=>{const key=e.nativeEvent.key;if(key==='Escape'){dismiss();return;}if(off)return;if(key==='ArrowDown'||key==='ArrowUp'){e.preventDefault?.();store.setState({index:Math.max(0,Math.min(suggestions.length-1,at+(key==='ArrowDown'?1:-1)))});}if(key==='Enter'&&suggestions[at]){e.preventDefault?.();void accept(suggestions[at]!.id);}}}}>
 <FlatList data={suggestions} keyExtractor={s=>s.id} initialNumToRender={6} windowSize={5} style={{maxHeight:320}} extraData={[at,off]} renderItem={({item,index})=><View style={{gap:4,paddingVertical:6}}><Button title={item.label+' · '+item.kind} accessibilityState={{selected:index===at}} disabled={off} unstyled={unstyled} onPress={()=>accept(item.id)}/><Text {...{className:unstyled?undefined:'text-text'}}>{item.signature}</Text><Text {...{className:unstyled?undefined:'text-text-muted'}}>{item.description}</Text></View>}/><Button title="Dismiss formula suggestions" variant="secondary" unstyled={unstyled} onPress={dismiss}/><ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/></View>;
}
function makeStore(){return createStore(()=>({index:0}));}
