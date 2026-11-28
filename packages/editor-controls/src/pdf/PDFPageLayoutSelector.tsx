import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {View} from 'react-native';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import type {PDFPageLayout} from './pdf-page-model.ts';
export interface PDFPageLayoutSelectorProps extends ScopedControlProps {value:PDFPageLayout;onChange:(layout:PDFPageLayout,signal?:AbortSignal)=>unknown;unstyled?:boolean}
export function PDFPageLayoutSelector({scope='pdf-page-layout',revision=0,...props}:PDFPageLayoutSelectorProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason]),guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <View style={{gap:6}}><SegmentedControl accessibilityLabel="PDF page layout" value={props.value} options={[{value:'single',label:'Single page'},{value:'continuous',label:'Continuous'},{value:'two-up',label:'Two pages'},{value:'facing',label:'Facing pages'}]} disabled={guard.pending||props.disabledReason!==undefined} unstyled={props.unstyled} onChange={layout=>guard.run('layout',(h,s)=>h.onChange(layout as PDFPageLayout,s))}/><ErrorMessage message={guard.error??props.disabledReason} unstyled={props.unstyled}/></View>;
}
