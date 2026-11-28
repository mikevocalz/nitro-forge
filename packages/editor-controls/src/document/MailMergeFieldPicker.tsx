import {FlatList,Text,View,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {exact} from '../exact-optional.ts';
import { tokens } from '../tokens.ts';
export interface MergeField {id:string;label:string;kind:'text'|'number'|'date'|'boolean';preview:string|null}
export interface MailMergeFieldPickerProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 fields:readonly MergeField[];recipientIndex:number;recipientCount:number;recipientLabel:string;status:'loading'|'ready'|'error';error?:string;
 onRecipientChange:(index:number,signal?:AbortSignal)=>unknown;onInsert:(fieldId:string,signal?:AbortSignal)=>unknown;onRetry:()=>void;unstyled?:boolean;
}
/** Preview values are supplied by the selected recipient's admitted data source. */
export function MailMergeFieldPicker({scope='mail-merge',revision=0,...props}:MailMergeFieldPickerProps){
 const {fields,recipientIndex,recipientCount,recipientLabel,status,error,onRecipientChange:_recipient,onInsert:_insert,onRetry,unstyled=false,disabledReason,style,...rest}=props;
 if(fields.length>512||new Set(fields.map(f=>f.id)).size!==fields.length||fields.some(f=>!f.id.trim()||f.id.length>256||!f.label.trim()||f.label.length>1024||!['text','number','date','boolean'].includes(f.kind)||f.preview!==null&&f.preview.length>8192)||!Number.isSafeInteger(recipientCount)||recipientCount<0||!Number.isSafeInteger(recipientIndex)||recipientIndex<0||recipientCount>0&&recipientIndex>=recipientCount||!['loading','ready','error'].includes(status))throw new RangeError('Invalid mail merge data');
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabledReason,status]),guard=useScopedControl(owner,props,disabledReason!==undefined||status!=='ready'),off=guard.pending||disabledReason!==undefined||status!=='ready';
 const move=(d:number)=>guard.run('recipient',(h,s)=>{const n=h.recipientIndex+d;return n>=0&&n<h.recipientCount?h.onRecipientChange(n,s):undefined;});
 return <View {...rest} style={[{gap:tokens.spacing.fixedElement},style]} accessibilityLabel="Mail merge fields"><Text {...{className:unstyled?undefined:'text-text'}}>Data: {status} · {recipientCount?`Recipient ${recipientIndex+1} of ${recipientCount}: ${recipientLabel}`:'No recipients supplied'}</Text><View style={{flexDirection:'row',gap:tokens.spacing.off6,flexWrap:'wrap'}}><Button title="Previous recipient preview" disabled={off||recipientIndex===0} unstyled={unstyled} onPress={()=>move(-1)}/><Button title="Next recipient preview" disabled={off||recipientIndex+1>=recipientCount} unstyled={unstyled} onPress={()=>move(1)}/></View>
 <FlatList data={fields} keyExtractor={f=>f.id} initialNumToRender={8} windowSize={5} style={{maxHeight:tokens.spacing.off360}} extraData={off} renderItem={({item})=><View style={{gap:tokens.spacing.off6,paddingVertical:tokens.spacing.off6}}><Button title={'Insert '+item.label} disabled={off} unstyled={unstyled} onPress={()=>guard.run('insert',(h,s)=>h.fields.some(f=>f.id===item.id)?h.onInsert(item.id,s):undefined)}/><Text {...{className:unstyled?undefined:'text-text-muted'}}>{item.kind}: {item.preview??'No value for this recipient'}</Text></View>}/>{status==='error'?<Button title="Reload merge source" unstyled={unstyled} onPress={onRetry}/>:null}<ErrorMessage {...exact({message:guard.error??error??disabledReason,unstyled:unstyled})}/></View>;
}
