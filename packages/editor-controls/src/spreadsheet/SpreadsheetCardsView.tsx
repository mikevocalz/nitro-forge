// Portions ported from GridCraft for Android,
// apps/gridcraft-android/android/app/src/main/java/io/github/artcraftandroid/gridcraft/ui/editor/Cards.kt
// at https://github.com/artcraft-android/gridcraft-android/commit/72d5bfc0729d0966e9bd966c2eabaa0312eea3ff
// Copyright (c) 2026 ArtCraft Team and the GridCraft contributors.
// Licensed under the MIT License or the Apache License, Version 2.0, at your option;
// see licenses/GridCraft-MIT.txt and licenses/GridCraft-Apache-2.0.txt.
// Modified by NYC-Tron UI contributors, 2026-11-05: Jetpack Compose replaced with React
// Native views styled by app theme tokens; the AlertDialog field editor replaced with
// in-place editing; card state is controlled by the app; RTL, keyboard and screen-reader
// labels added; commits go through the app's onCommitField.
import {useLayoutEffect,useRef} from 'react';
import {Text,TextInput,View,VirtualizedList,ScrollView,type ViewProps} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import type {SheetRange} from '../sheet-window.ts';
import {sheetCardAt,CARD_PREVIEW_FIELDS,type CardCellValues} from './cards-model.ts';
import {exact} from '../exact-optional.ts';
export interface SpreadsheetCardsViewProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 name:string;table:SheetRange;cells:CardCellValues;openCard:number|undefined;onOpenCardChange:(index:number|undefined)=>void;
 onCommitField?:(address:string,raw:string)=>unknown;onClose?:()=>void;hasMore?:boolean;onLoadMore?:(signal?:AbortSignal)=>unknown;
 pageSize?:number;className?:string;unstyled?:boolean;disabled?:boolean;
}
/** Explicit record mode. Virtualizes actual host-loaded rows and resolves only visible card fields. */
export function SpreadsheetCardsView({scope='sheet-cards',revision=0,...props}:SpreadsheetCardsViewProps){
 const {name,table,cells,openCard,onOpenCardChange:_open,onCommitField:_commit,onClose,hasMore=false,onLoadMore,pageSize=12,className,unstyled=false,disabled=false,disabledReason,style,...rest}=props;
 if(!name.trim()||name.length>1024||![table.startRow,table.endRow,table.startColumn,table.endColumn].every(Number.isSafeInteger)||table.startRow<0||table.startColumn<0||table.endRow<table.startRow||table.endColumn<table.startColumn||table.endColumn-table.startColumn>=256||table.endRow-table.startRow>1048576||!Number.isInteger(pageSize)||pageSize<1||pageSize>1000)throw new RangeError('Invalid card table window');
 const owner=JSON.stringify([...controlIdentity(scope,revision),table.startRow,table.startColumn,table.endColumn,disabled,disabledReason]),guard=useScopedControl(owner,props,disabled||disabledReason!==undefined),off=guard.pending||disabled||disabledReason!==undefined;
 const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,s=useStore(store,v=>v),count=table.endRow-table.startRow,open=openCard!==undefined&&openCard>=0&&openCard<count?sheetCardAt(table,cells,openCard):undefined;
 useLayoutEffect(()=>{store.setState({editing:null,draft:''});},[owner]);
 const save=async()=>{const current=store.getState();if(!current.editing)return true;const field=open?.fields.find(f=>f.address===current.editing);if(field?.raw===current.draft){store.setState({editing:null});return true;}const ok=await guard.run('field',h=>{if(!h.onCommitField)throw new Error('This table is read only');return h.onCommitField(current.editing!,current.draft);});if(ok===true&&store.getState().editing===current.editing)store.setState({editing:null});return ok===true;};
 const go=async(index:number|undefined)=>{if(off)return;if(!await save())return;guard.current()?.onOpenCardChange(index);};
 return <View {...rest} {...{className:className??(unstyled?undefined:'bg-surface-raised')}} style={[{minWidth:0,minHeight:0,flex:1,gap:8},style]} accessibilityLabel={'Record cards: '+name}>
 <View style={{flexDirection:'row',alignItems:'center',gap:6,flexWrap:'wrap'}}>{open?<Button title="All records" disabled={off} unstyled={unstyled} onPress={()=>go(undefined)}/>:onClose?<Button title="Return to sheet grid" disabled={off} unstyled={unstyled} onPress={async()=>{if(await save())guard.current()?.onClose?.();}}/>:null}<Text accessibilityRole="header" style={{flex:1}} {...{className:unstyled?undefined:'text-text'}}>{open?.title??name}</Text><Text {...{className:unstyled?undefined:'text-text-muted'}}>{count}{hasMore?'+':''} records</Text>{open?<><Button title="Previous record" disabled={off||openCard===0} unstyled={unstyled} onPress={()=>go(openCard!-1)}/><Button title="Next record" disabled={off||openCard===count-1} unstyled={unstyled} onPress={()=>go(openCard!+1)}/></>:null}</View>
 {open?<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:8}}>{open.fields.map(field=><View key={field.address} style={{gap:6,paddingVertical:8}}><Text {...{className:unstyled?undefined:'text-text-muted'}}>{field.name}</Text>{s.editing===field.address?<><TextInput accessibilityLabel={'Edit '+field.name} value={s.draft} editable={!off} maxLength={65536} onChangeText={draft=>store.setState({draft})} onSubmitEditing={()=>save()} style={{minHeight:44,padding:8}} {...{className:unstyled?undefined:'text-text border border-border rounded-control'}}/><View style={{flexDirection:'row',gap:6}}><Button title="Save record field" disabled={off} unstyled={unstyled} onPress={save}/><Button title="Cancel record field edit" disabled={off} variant="secondary" unstyled={unstyled} onPress={()=>store.setState({editing:null,draft:''})}/></View></>:<Button title={field.display||'Empty value'} accessibilityLabel={field.name+': '+(field.display||'empty')} variant="secondary" disabled={off||!props.onCommitField} unstyled={unstyled} onPress={async()=>{if(await save())store.setState({editing:field.address,draft:field.raw});}}/>}</View>)}</ScrollView>:<VirtualizedList data={{count}} getItemCount={d=>d.count} getItem={(_d,index)=>index} keyExtractor={index=>String(table.startRow+index+1)} initialNumToRender={Math.min(12,pageSize)} windowSize={5} style={{minHeight:100,flex:1}} extraData={[cells,off]} renderItem={({item})=>{const card=sheetCardAt(table,cells,item);return <View style={{gap:6,padding:12}}><Button title={card.title} disabled={off} unstyled={unstyled} onPress={()=>go(item)}/>{card.fields.slice(1,1+CARD_PREVIEW_FIELDS).map(f=><Text key={f.address} {...{className:unstyled?undefined:'text-text'}}>{f.name}: {f.display||'empty'}</Text>)}</View>;}} ListEmptyComponent={<Text {...{className:unstyled?undefined:'text-text'}}>This table has no data rows</Text>}/>}
 {hasMore&&onLoadMore?<Button title="Load more table records" disabled={off} unstyled={unstyled} onPress={()=>guard.run('load',(h,signal)=>h.onLoadMore?.(signal))}/>:hasMore?<Text {...{className:unstyled?undefined:'text-text-muted'}}>More rows have not been loaded</Text>:null}<ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/></View>;
}
function makeStore(){return createStore(()=>({editing:null as string|null,draft:''}));}
