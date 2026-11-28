import {useRef} from 'react';
import {FlatList,Text,TextInput,View,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {PropertyInspector} from '../inputs/PropertyInspector.tsx';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
export interface CitationSource {id:string;title:string;author:string;year:string;formattedCitation:string}
export interface FootnoteCitationEditorProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 sources:readonly CitationSource[];notes:readonly {id:string;numberLabel:string;text:string;kind:'footnote'|'endnote'}[];
 styleId:string;styles:readonly {id:string;label:string}[];onStyleCommit:(id:string,signal?:AbortSignal)=>unknown;
 onInsertCitation:(sourceId:string,signal?:AbortSignal)=>unknown;onInsertNote:(kind:'footnote'|'endnote',signal?:AbortSignal)=>unknown;
 onNoteCommit:(id:string,text:string,signal?:AbortSignal)=>unknown;onJumpToNote:(id:string)=>void;onUpdateBibliography:(signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
export function FootnoteCitationEditor({scope='citations',revision=0,...props}:FootnoteCitationEditorProps){
 const {sources,notes,styleId,styles,onStyleCommit:_style,onInsertCitation:_cite,onInsertNote:_note,onNoteCommit:_commit,onJumpToNote:_jump,onUpdateBibliography:_bibliography,unstyled=false,disabledReason,style,...rest}=props;
 if(sources.length>50000||notes.length>50000||styles.length>256||new Set(sources.map(s=>s.id)).size!==sources.length||new Set(notes.map(n=>n.id)).size!==notes.length||sources.some(s=>!s.id.trim()||s.id.length>256||s.title.length>8192||s.author.length>1024||s.year.length>64||s.formattedCitation.length>8192)||notes.some(n=>!n.id.trim()||n.id.length>256||n.text.length>65536))throw new RangeError('Invalid reference library');
 const owner=useEditorBoundary([JSON.stringify([...controlIdentity(scope,revision),disabledReason])]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,query=useStore(store,s=>s.query),q=query.trim().toLocaleLowerCase(),shown=sources.filter(s=>(s.title+' '+s.author+' '+s.year).toLocaleLowerCase().includes(q));
 return <View {...rest} accessibilityLabel="Footnotes and citations" style={[{gap:8},style]}>
 <PropertyInspector scope={owner} label="Citation style" unstyled={unstyled} disabledReason={off?'Reference edit unavailable':undefined} fields={[{kind:'choice',id:'style',label:'Bibliography style',value:styleId,choices:styles}]} onCommit={(_id,v)=>guard.run('style',(h,s)=>typeof v==='string'&&h.styles.some(style=>style.id===v)?h.onStyleCommit(v,s):undefined)}/>
 <TextInput accessibilityLabel="Search reference sources" value={query} maxLength={256} onChangeText={query=>store.setState({query})} style={{minHeight:44,padding:8}} {...{className:unstyled?undefined:'text-text border border-border rounded-control'}}/>
 <FlatList data={shown} keyExtractor={s=>s.id} style={{height:240}} initialNumToRender={5} windowSize={5} extraData={off} renderItem={({item})=><View style={{gap:6,paddingVertical:6}}><Text {...{className:unstyled?undefined:'text-text'}}>{item.title} · {item.author} · {item.year}</Text><Text {...{className:unstyled?undefined:'text-text-muted'}}>{item.formattedCitation}</Text><Button title="Insert citation" disabled={off} unstyled={unstyled} onPress={()=>guard.run('cite',(h,s)=>h.sources.some(v=>v.id===item.id)?h.onInsertCitation(item.id,s):undefined)}/></View>}/>
 <View style={{flexDirection:'row',gap:6,flexWrap:'wrap'}}>{(['footnote','endnote'] as const).map(kind=><Button key={kind} title={'Insert '+kind} disabled={off} unstyled={unstyled} onPress={()=>guard.run('note',(h,s)=>h.onInsertNote(kind,s))}/>)}</View>
 <FlatList data={notes} keyExtractor={n=>n.id} style={{height:320}} initialNumToRender={4} windowSize={5} extraData={off} renderItem={({item})=><View style={{gap:6,paddingVertical:8}}><Button title={'Jump to '+item.kind+' '+item.numberLabel} variant="secondary" disabled={off} unstyled={unstyled} onPress={()=>guard.current()?.onJumpToNote(item.id)}/><PropertyInspector scope={owner+':'+item.id} label={item.kind+' '+item.numberLabel} unstyled={unstyled} disabledReason={off?'Note editing unavailable':undefined} fields={[{kind:'text',id:'text',label:'Note text',value:item.text,maxLength:65536,multiline:true}]} onCommit={(_id,v)=>guard.run('note-edit',(h,s)=>typeof v==='string'&&h.notes.some(n=>n.id===item.id)?h.onNoteCommit(item.id,v,s):undefined)}/></View>}/>
 <Button title="Update bibliography fields" disabled={off} unstyled={unstyled} onPress={()=>guard.run('bibliography',(h,s)=>h.onUpdateBibliography(s))}/><ErrorMessage message={guard.error??disabledReason} unstyled={unstyled}/></View>;
}
function makeStore(){return createStore(()=>({query:''}));}
