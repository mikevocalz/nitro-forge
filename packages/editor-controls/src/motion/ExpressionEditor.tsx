import {useId,useMemo,useRef,useLayoutEffect,type ComponentRef} from 'react';
import {FlatList,Text,TextInput,View,Platform,type ViewProps,type StyleProp,type TextStyle} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {useOwnedAction} from '@nyc-tron/ui/components/shell/useOwnedAction';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {useLocalStore} from '@nyc-tron/ui/components/useLocalStore';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {EXPRESSION_MAX_LENGTH,isExpressionBoundary,replaceExpressionRange,validateExpressionText,validateExpressionRange,validateExpressionReferences,validateExpressionCompletions,validateExpressionDiagnostics,type ExpressionRange,type ExpressionQuery,type ExpressionReference,type ExpressionCompletion,type ExpressionDiagnostic} from './motion-expression.ts';
export type {ExpressionRange,ExpressionQuery,ExpressionReference,ExpressionCompletion,ExpressionDiagnostic} from './motion-expression.ts';
export interface ExpressionEditorProps extends Omit<ViewProps,'children'> {
 readonly scope:string;readonly revision:string|number;readonly value:string;readonly onChange:(text:string)=>void;readonly references:readonly ExpressionReference[];
 readonly onComplete:(query:ExpressionQuery,signal:AbortSignal)=>readonly ExpressionCompletion[]|Promise<readonly ExpressionCompletion[]>;
 readonly onValidate:(text:string,signal:AbortSignal)=>readonly ExpressionDiagnostic[]|Promise<readonly ExpressionDiagnostic[]>;
 readonly onApply:(text:string,signal:AbortSignal)=>void|Promise<void>;
 /** Host-authored text, font, border and density overrides for the native source input. */
 readonly inputClassName?:string;readonly inputStyle?:StyleProp<TextStyle>;
 readonly height?:number;readonly disabled?:boolean;readonly unstyled?:boolean;
}
/** Native code text input with explicit, cancellable host language services. This component never evaluates code. */
export function ExpressionEditor(props:ExpressionEditorProps){validateExpressionText(props.value);useMemo(()=>validateExpressionReferences(props.references),[props.references]);if(!props.scope.trim()||typeof props.revision==='number'&&!Number.isFinite(props.revision)||!Number.isFinite(props.height??320)||(props.height??320)<80||(props.height??320)>4000)throw new RangeError('Invalid expression document or viewport');return <Editor key={props.scope} {...props}/>;}
interface Local {focused:boolean;section:string;selection:ExpressionRange;requested:ExpressionRange|null;completion:{key:string;items:readonly ExpressionCompletion[]}|null;validation:{key:string;items:readonly ExpressionDiagnostic[]}|null}
function Editor({scope,revision,value,onChange,references,onComplete,onValidate,onApply,height=320,disabled=false,unstyled=false,inputClassName,inputStyle,...props}:ExpressionEditorProps){
 const input=useRef<ComponentRef<typeof TextInput>|null>(null),id=useId();
 const [local,store]=useLocalStore<Local>(()=>({focused:false,section:'editor',selection:{start:value.length,end:value.length},requested:null,completion:null,validation:null}));
 const range=validSelection(value,local.selection),identity=JSON.stringify([scope,revision,value]),completionIdentity=JSON.stringify([identity,range]);
 const completion=useOwnedAction(completionIdentity),validation=useOwnedAction(identity),apply=useOwnedAction(identity),locked=disabled||apply.pending!==null;
 const items=local.completion?.key===completionIdentity?local.completion.items:[],diagnostics=local.validation?.key===identity?local.validation.items:[],validated=local.validation?.key===identity,errors=diagnostics.some(d=>d.severity==='error');
 useLayoutEffect(()=>{completion.cancel();store.set(s=>({...s,completion:null}));},[references,completion.cancel,store]);
 useLayoutEffect(()=>{if(disabled){completion.cancel();validation.cancel();apply.cancel();}},[disabled,completion.cancel,validation.cancel,apply.cancel]);
 useLayoutEffect(()=>{if(local.section==='editor'&&local.requested)input.current?.focus();},[local.section,local.requested]);
 const insert=(at:ExpressionRange,text:string)=>{if(locked)return;const result=replaceExpressionRange(value,at,text);store.set(s=>({...s,section:'editor',selection:result.selection,requested:result.selection,completion:null}));onChange(result.text);input.current?.focus();};
 const selectRange=(at:ExpressionRange)=>{validateExpressionRange(value,at);store.set(s=>({...s,section:'editor',selection:at,requested:at}));input.current?.focus();};
 const complete=()=>{if(locked||completion.pending!==null)return;const query:ExpressionQuery={text:value,selection:range,references};void completion.run('complete',async signal=>{const result=await onComplete(query,signal);validateExpressionCompletions(value,result);return result;},result=>store.set(s=>({...s,section:'completions',completion:{key:completionIdentity,items:result}})));};
 const validate=()=>{if(locked||validation.pending!==null)return;store.set(s=>({...s,validation:null}));void validation.run('validate',async signal=>{const result=await onValidate(value,signal);validateExpressionDiagnostics(value,result);return result;},result=>store.set(s=>({...s,validation:{key:identity,items:result}})));};
 return <View {...props} style={[{gap:8},props.style]}>
  <SegmentedControl aria-label="Expression panel section" options={[{value:'editor',label:'Source'},{value:'completions',label:'Completions'},{value:'references',label:'References'},{value:'diagnostics',label:'Diagnostics'}]} value={local.section} onChange={section=>store.set(s=>({...s,section}))} unstyled={unstyled}/>
  {local.section==='editor'?<View style={{gap:6}}><View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8}}><Text nativeID={`${id}-label`} {...{className:joinClasses(!unstyled&&'text-text')}}>Expression source</Text>{Platform.OS!=='web'&&local.focused?<Button title="Done editing" accessibilityLabel="Done editing expression" unstyled={unstyled} onPress={()=>{store.set(s=>({...s,focused:false,requested:null}));input.current?.blur();}}/>:null}</View>
   <TextInput ref={input} value={value} editable={!locked} multiline maxLength={EXPRESSION_MAX_LENGTH} autoCorrect={false} autoCapitalize="none" spellCheck={false} textAlignVertical="top" accessibilityLabel="Expression source" accessibilityLabelledBy={`${id}-label`} {...(local.requested?{selection:validSelection(value,local.requested)}:{})}
    onFocus={()=>store.set(s=>({...s,focused:true}))} onBlur={()=>store.set(s=>({...s,focused:false}))}
    onChangeText={text=>{if(locked)return;validateExpressionText(text);store.set(s=>({...s,requested:null,completion:null}));onChange(text);}}
    onSelectionChange={event=>{const next=validSelection(value,event.nativeEvent.selection);store.set(s=>({...s,selection:next,requested:null}));}}
    style={[{height,minHeight:80,padding:8},inputStyle]} {...{className:joinClasses(!unstyled&&'text-text border border-border rounded-control',inputClassName)}}/>
   <Button title="Complete" accessibilityLabel="Complete expression" disabled={locked||completion.pending!==null} unstyled={unstyled} onPress={complete}/>
  </View>:null}
  {local.section==='completions'?<FlatList data={items} keyExtractor={item=>item.id} style={{height}} initialNumToRender={4} windowSize={3} accessibilityLabel="Expression completions" ListEmptyComponent={<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>No completion results for this caret</Text>} renderItem={({item})=><View style={{gap:2}}><Button title={item.label} accessibilityLabel={`Insert completion ${item.label}`} disabled={locked} unstyled={unstyled} onPress={()=>insert(item.range,item.insertText)}/>{item.detail?<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{item.detail}</Text>:null}</View>}/>:null}
  {local.section==='references'?<FlatList data={references} keyExtractor={item=>item.id} style={{height}} initialNumToRender={8} windowSize={5} accessibilityLabel="Expression references" ListEmptyComponent={<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>No references supplied</Text>} renderItem={({item})=><View style={{gap:2}}><Button title={item.label} accessibilityLabel={`Insert reference ${item.label}`} disabled={locked||value.length-(range.end-range.start)+item.insertText.length>EXPRESSION_MAX_LENGTH} unstyled={unstyled} onPress={()=>{if(value.length-(range.end-range.start)+item.insertText.length<=EXPRESSION_MAX_LENGTH)insert(range,item.insertText);}}/>{item.detail?<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{item.detail}</Text>:null}</View>}/>:null}
  {local.section==='diagnostics'?<FlatList data={diagnostics} keyExtractor={item=>item.id} style={{height}} initialNumToRender={8} windowSize={5} accessibilityLabel="Expression diagnostics" ListEmptyComponent={<Text {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{validated?'No diagnostics reported':'Validate the current expression to see diagnostics'}</Text>} renderItem={({item})=><Button title={`${item.severity}: ${item.message}`} accessibilityLabel={`Select diagnostic ${item.message}`} disabled={locked} unstyled={unstyled} onPress={()=>selectRange(item.range)}/>}/>:null}
  <Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&'text-text-muted')}}>{validated?`${diagnostics.filter(d=>d.severity==='error').length} errors, ${diagnostics.filter(d=>d.severity==='warning').length} warnings`:'Current expression has not been validated'}</Text>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}><Button title="Validate" accessibilityLabel="Validate expression" disabled={locked||validation.pending!==null} unstyled={unstyled} onPress={validate}/><Button title="Apply" accessibilityLabel="Apply expression" disabled={locked||!validated||errors||validation.pending!==null} unstyled={unstyled} onPress={()=>{if(!locked&&validated&&!errors&&validation.pending===null)void apply.run('apply',signal=>onApply(value,signal));}}/></View>
  {completion.pending!==null?<Button title="Cancel expression completion" unstyled={unstyled} onPress={completion.cancel}/>:null}{validation.pending!==null?<Button title="Cancel expression validation" unstyled={unstyled} onPress={validation.cancel}/>:null}{apply.pending!==null?<Button title="Cancel expression apply" unstyled={unstyled} onPress={apply.cancel}/>:null}
  <ErrorMessage {...(completion.error||validation.error||apply.error?{message:completion.error??validation.error??apply.error!}:{})} unstyled={unstyled}/>
 </View>;
}
function validSelection(text:string,range:ExpressionRange):ExpressionRange {let start=Math.max(0,Math.min(text.length,Math.trunc(range.start))),end=Math.max(start,Math.min(text.length,Math.trunc(range.end)));if(!isExpressionBoundary(text,start))start--;if(!isExpressionBoundary(text,end))end++;return {start,end};}
