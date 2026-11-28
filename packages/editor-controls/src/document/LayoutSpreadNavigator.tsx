import type {ReactNode} from 'react';
import {FlatList,Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {Select} from '@nyc-tron/ui/components/Select';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { controlTokens, tokens } from '../tokens.ts';
export interface DocumentSpreadPage {id:string;label:string;masterId:string|null;oversetCharacters:number}
export interface LayoutSpreadNavigatorProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 pages:readonly DocumentSpreadPage[];masters:readonly {id:string;label:string}[];selectedId:string|null;facingPages:boolean;firstPageOnRight:boolean;
 renderThumbnail:(id:string)=>ReactNode;onSelect:(id:string)=>void;onFacingChange:(facing:boolean,signal?:AbortSignal)=>unknown;onMasterCommit:(pageId:string,masterId:string|null,signal?:AbortSignal)=>unknown;unstyled?:boolean;
}
export function LayoutSpreadNavigator({scope='spread-navigator',revision=0,...props}:LayoutSpreadNavigatorProps){
 const {pages,masters,selectedId,facingPages,firstPageOnRight,renderThumbnail,onSelect:_select,onFacingChange:_facing,onMasterCommit:_master,unstyled=false,disabledReason,style,...rest}=props;
 if(pages.length>100000||masters.length>256||new Set(pages.map(p=>p.id)).size!==pages.length||new Set(masters.map(m=>m.id)).size!==masters.length||pages.some(p=>!p.id.trim()||p.id.length>256||!p.label.trim()||p.label.length>1024||!Number.isSafeInteger(p.oversetCharacters)||p.oversetCharacters<0))throw new RangeError('Invalid spread page roster');
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined),off=guard.pending||disabledReason!==undefined;
 const spreads:DocumentSpreadPage[][]=[];for(let i=0;i<pages.length;){const count=!facingPages||i===0&&firstPageOnRight?1:2;spreads.push(pages.slice(i,i+count));i+=count;}
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement},style]} accessibilityLabel="Document spreads"><Button title={'Facing pages '+(facingPages?'on':'off')} accessibilityState={{checked:facingPages}} disabled={off} unstyled={unstyled} onPress={()=>guard.run('facing',(h,s)=>h.onFacingChange(!h.facingPages,s))}/>
 <FlatList data={spreads} keyExtractor={s=>s.map(p=>p.id).join(':')} initialNumToRender={4} windowSize={5} style={{height:controlTokens.extent.listTall}} extraData={[off,selectedId]} renderItem={({item})=><View style={{flexDirection:'row',gap:tokens.spacing.fixedElement,flexWrap:'wrap',paddingVertical:tokens.spacing.fixedElement}}>{item.map(p=><View key={p.id} style={{flex:1,minWidth:tokens.spacing.off96,gap:tokens.spacing.off6}}><Button title={p.label} variant="secondary" accessibilityState={{selected:p.id===selectedId}} disabled={off} unstyled={unstyled} onPress={()=>guard.current()?.onSelect(p.id)}/>{renderThumbnail(p.id)}<Text {...{className:unstyled?undefined:'text-text'}}>Overset: {p.oversetCharacters} characters</Text><Select label={'Parent/master for '+p.label} value={p.masterId===null?'none':'master:'+p.masterId} options={[{value:'none',label:'No master'},...masters.map(m=>({value:'master:'+m.id,label:m.label}))]} disabled={off} unstyled={unstyled} onValueChange={id=>guard.run('master',(h,s)=>h.pages.some(v=>v.id===p.id)&&(id==='none'||h.masters.some(m=>m.id===id.slice(7)))?h.onMasterCommit(p.id,id==='none'?null:id.slice(7),s):undefined)}/></View>)}</View>}/><ErrorMessage {...exact({message:guard.error??disabledReason,unstyled:unstyled})}/></View>;
}
