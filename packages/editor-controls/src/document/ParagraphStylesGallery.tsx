import type {ReactNode} from 'react';
import {FlatList,Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
export interface ParagraphStyle {id:string;label:string;basedOn:string|null;level:number;overridden:boolean}
export interface ParagraphStylesGalleryProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 styles:readonly ParagraphStyle[];selectedId:string|null;renderPreview:(styleId:string)=>ReactNode;
 onApply:(id:string,signal?:AbortSignal)=>unknown;onClearOverrides:(id:string,signal?:AbortSignal)=>unknown;onUpdateFromSelection:(id:string,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
export function ParagraphStylesGallery({scope='paragraph-styles',revision=0,...props}:ParagraphStylesGalleryProps){
 const {styles,selectedId,renderPreview,onApply:_apply,onClearOverrides:_clear,onUpdateFromSelection:_update,disabledReason,unstyled=false,style,...rest}=props;
 if(styles.length>1024||new Set(styles.map(s=>s.id)).size!==styles.length||styles.some(s=>!s.id.trim()||s.id.length>256||!s.label.trim()||s.label.length>1024||!Number.isInteger(s.level)||s.level<0||s.level>9||s.basedOn!==null&&!styles.some(p=>p.id===s.basedOn)))throw new RangeError('Invalid paragraph style hierarchy');
 for(const item of styles){let current:ParagraphStyle|undefined=item;const seen=new Set<string>();while(current){if(seen.has(current.id))throw new RangeError('Paragraph style inheritance cycle');seen.add(current.id);current=styles.find(s=>s.id===current?.basedOn);}}
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 return <View {...rest} accessibilityLabel="Paragraph styles" style={[{gap:8},style]}><FlatList data={styles} keyExtractor={s=>s.id} style={{height:360}} initialNumToRender={6} windowSize={5} extraData={[selectedId,off]} renderItem={({item})=><View style={{gap:6,paddingVertical:8,paddingStart:item.level*8}}><Button title={item.label+(item.overridden?' · overrides':'')} accessibilityState={{selected:item.id===selectedId}} disabled={off} unstyled={unstyled} onPress={()=>guard.run('apply',(h,s)=>h.styles.some(v=>v.id===item.id)?h.onApply(item.id,s):undefined)}/>{renderPreview(item.id)}<Text {...{className:unstyled?undefined:'text-text-muted'}}>Based on: {styles.find(s=>s.id===item.basedOn)?.label??'No parent style'}</Text><View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}><Button title="Clear style overrides" disabled={off||!item.overridden} unstyled={unstyled} onPress={()=>guard.run('clear',(h,s)=>h.onClearOverrides(item.id,s))}/><Button title="Update style from selection" disabled={off} unstyled={unstyled} onPress={()=>guard.run('update',(h,s)=>h.onUpdateFromSelection(item.id,s))}/></View></View>}/><ErrorMessage message={guard.error??disabledReason} unstyled={unstyled}/></View>;
}
