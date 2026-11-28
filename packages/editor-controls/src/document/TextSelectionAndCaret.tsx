import {useRef,type Ref,type ComponentRef} from 'react';
import {TextInput,View,Text,type TextInputProps,type TextStyle,type StyleProp} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {PropertyInspector} from '../inputs/PropertyInspector.tsx';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
export interface DocumentTextSelection {start:number;end:number}
export interface TextSelectionAndCaretProps extends ScopedControlProps {
 /** Native buffer seed. Change contentRevision to replace external content intentionally. */
 initialText:string;contentRevision:string|number;selection:DocumentTextSelection;
 onTextChange:(text:string)=>void;onSelectionChange:(selection:DocumentTextSelection)=>void;
 onContentSizeChange?:(size:{width:number;height:number})=>void;
 onFocus?:()=>void;onBlur?:()=>void;label:string;readOnly?:boolean;direction?:'auto'|'ltr'|'rtl';
 showSelectionFields?:boolean;editorRef?:Ref<ComponentRef<typeof TextInput>>;inputStyle?:StyleProp<TextStyle>;unstyled?:boolean;
 /** Native IME/selection remain owned by this actual TextInput, not emulated handles. */
 nativeInputProps?:Pick<TextInputProps,'autoCorrect'|'spellCheck'|'autoCapitalize'|'keyboardType'|'returnKeyType'|'textContentType'|'scrollEnabled'>;
}
export function TextSelectionAndCaret({scope='text-selection',revision=0,...props}:TextSelectionAndCaretProps){
 const {initialText,contentRevision,selection,label}=props;
 if(initialText.length>1048576||!label.trim()||label.length>1024||![selection.start,selection.end].every(Number.isSafeInteger)||selection.start<0||selection.end<selection.start||typeof contentRevision==='number'&&!Number.isFinite(contentRevision)||typeof contentRevision==='string'&&contentRevision.length>512)throw new RangeError('Invalid native text selection');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),contentRevision])]);
 return <NativeTextEditor key={owner} {...props} scope={owner}/>;
}
function NativeTextEditor({scope='native-text',revision=0,initialText,selection,onTextChange,onSelectionChange,onContentSizeChange,onFocus,onBlur,label,readOnly=false,direction='auto',showSelectionFields=true,editorRef,inputStyle,unstyled=false,nativeInputProps,disabledReason}:TextSelectionAndCaretProps){
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore(initialText);const store=local.current,length=useStore(store,s=>s.text.length),ref=useRef<ComponentRef<typeof TextInput>|null>(null);
 const props={onTextChange,onSelectionChange,onContentSizeChange,onFocus,onBlur,readOnly},guard=useScopedControl(scope,props,disabledReason!==undefined),off=readOnly||disabledReason!==undefined;
 const start=Math.min(selection.start,length),end=Math.min(Math.max(start,selection.end),length);
 const changeSelection=(next:DocumentTextSelection)=>{if(disabledReason===undefined&&next.start>=0&&next.end>=next.start&&next.end<=store.getState().text.length)guard.current()?.onSelectionChange(next);};
 return <View style={{gap:8,minWidth:0}} accessibilityLabel={label+' editor'}>
  <TextInput {...nativeInputProps} ref={node=>{ref.current=node;if(typeof editorRef==='function')editorRef(node);else if(editorRef)editorRef.current=node;}} accessibilityLabel={label} defaultValue={initialText} multiline editable={!off} selection={{start,end}} textAlignVertical="top"
   onChangeText={text=>{const h=guard.current();if(!h||h.readOnly||text.length>1048576)return;store.setState({text});h.onTextChange(text);}}
   onSelectionChange={e=>changeSelection(e.nativeEvent.selection)} onFocus={()=>guard.current()?.onFocus?.()} onBlur={()=>guard.current()?.onBlur?.()}
   onContentSizeChange={e=>guard.current()?.onContentSizeChange?.(e.nativeEvent.contentSize)}
   style={[{minHeight:44,padding:8,writingDirection:direction==='auto'?undefined:direction},inputStyle]} {...{className:unstyled?undefined:'text-text'}}/>
  {showSelectionFields&&length>0?<PropertyInspector scope={scope} label="Text selection" unstyled={unstyled} disabledReason={disabledReason} fields={[{kind:'number',id:'start',label:'Selection start (UTF-16)',value:start,min:0,max:length,step:1,integer:true},{kind:'number',id:'end',label:'Selection end (UTF-16)',value:end,min:0,max:length,step:1,integer:true}]} onCommit={(id,value)=>{if(typeof value!=='number')return;if(id==='start')changeSelection({start:value,end:Math.max(value,end)});else changeSelection({start:Math.min(start,value),end:value});ref.current?.focus();}}/>:null}
  {disabledReason?<Text {...{className:unstyled?undefined:'text-text-muted'}}>{disabledReason}</Text>:null}
 </View>;
}
function makeStore(text:string){return createStore(()=>({text}));}
