import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {Select} from '@nyc-tron/ui/components/Select';
import {CellSelectionOverlay,type CellSelectionOverlayProps} from './CellSelectionOverlay.tsx';
import {exact} from '../exact-optional.ts';
import type {FillPlan} from './fill-handle.ts';
export type AutoFillMode='copy'|'series'|'formulas';
export type FillHandleAndAutoFillProps=Omit<CellSelectionOverlayProps,'interaction'|'onFillCommit'|'onRangeCommit'>&{
 mode:AutoFillMode;availableModes:readonly AutoFillMode[];
 onFill:(plan:FillPlan,mode:AutoFillMode,signal?:AbortSignal)=>unknown;
};
/** Shares the range recognizer and fill planner. Put AutoFillModePicker in the app's usable toolbar. */
export function FillHandleAndAutoFill({mode,availableModes,onFill,...props}:FillHandleAndAutoFillProps){
 validateModes(availableModes);const owner=useEditorBoundary([props.scope,props.revision,mode,availableModes.join('|')]);
 return <CellSelectionOverlay {...props} scope={owner} interaction="fill" disabledReason={props.disabledReason??(!availableModes.includes(mode)?'Fill mode unavailable':undefined)} onFillCommit={(plan,signal)=>onFill(plan,mode,signal)}/>;
}
export interface AutoFillModePickerProps extends ScopedControlProps {mode:AutoFillMode;availableModes:readonly AutoFillMode[];onModeChange:(mode:AutoFillMode)=>void;unstyled?:boolean}
export function AutoFillModePicker({scope='fill-mode',revision=0,...props}:AutoFillModePickerProps){
 validateModes(props.availableModes);const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason]),guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <Select label="Auto-fill mode" value={props.mode} options={props.availableModes.map(value=>({value,label:value}))} disabled={props.disabledReason!==undefined} {...exact({unstyled:props.unstyled})} onValueChange={value=>{const h=guard.current();if(h?.availableModes.includes(value as AutoFillMode))h.onModeChange(value as AutoFillMode);}}/>;
}
function validateModes(modes:readonly AutoFillMode[]){if(new Set(modes).size!==modes.length||modes.some(m=>!['copy','series','formulas'].includes(m)))throw new RangeError('Invalid auto-fill capabilities');}
