import type {ReactNode} from 'react';
import {View,type ViewProps} from 'react-native';
import {FormulaReferenceText} from './FormulaReferenceText.tsx';
import {colorReferences,type ColoredReference} from './reference-colors.ts';
import {Button} from '@nyc-tron/ui/components/Button';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import { tokens } from '../tokens.ts';
export interface ReferenceColorizerProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 formula:string;sheetName?:string;onHighlight:(reference:ColoredReference)=>void;
 renderRangeHighlight:(reference:ColoredReference)=>ReactNode;unstyled?:boolean;
}
/** Shared licensed tokenizer/tone owner; the host places on-sheet range outlines in grid coordinates. */
export function ReferenceColorizer({scope='formula-references',revision=0,...props}:ReferenceColorizerProps){
 const {formula,sheetName,onHighlight:_highlight,renderRangeHighlight,unstyled=false,disabledReason,style,...rest}=props;
 if(formula.length>65536)throw new RangeError('Formula exceeds reference drawing budget');
 const refs=colorReferences(formula,sheetName),owner=JSON.stringify([...controlIdentity(scope,revision),formula,sheetName,disabledReason]),guard=useScopedControl(owner,props,disabledReason!==undefined);
 return <View {...rest} style={[{gap:tokens.spacing.off6},style]} accessibilityLabel="Formula reference colors"><FormulaReferenceText formula={formula} sheetName={sheetName} unstyled={unstyled}/><View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.off6}}>{refs.slice(0,256).map((ref,i)=><Button key={i} title={ref.text+(ref.onSheet?'':' · other sheet')} disabled={disabledReason!==undefined} variant="secondary" unstyled={unstyled} onPress={()=>guard.current()?.onHighlight(ref)}/>)}</View>{refs.filter(r=>r.onSheet).slice(0,256).map((ref,i)=><View key={i} pointerEvents="none">{renderRangeHighlight(ref)}</View>)}</View>;
}
