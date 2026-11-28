import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {View,Text,Pressable,type ViewProps} from 'react-native';
import {Button} from '@nyc-tron/ui/components/Button';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {webToggleProps} from '@nyc-tron/ui/components/forms/toggle-a11y';
import {PRESENTER_INK_TOOLS,PRESENTER_INK_TOOL_LABELS,PRESENTER_INK_SHORTCUTS,type PresenterInkMode} from './presenter-ink-model.ts';
/** Presenter tools; colors/size remain the consuming app's existing ink controls. */
export interface PresenterInkStripProps extends Omit<ViewProps,'children'>,ScopedControlProps {
 readonly mode:PresenterInkMode;readonly onModeChange:(mode:PresenterInkMode)=>void;
 readonly capture?:{enabled:boolean;unavailableReason?:string;onChange:(enabled:boolean,signal?:AbortSignal)=>unknown};
 readonly strokeCount:number;readonly onClear:()=>void;readonly disabled?:boolean;className?:string;unstyled?:boolean;
}
/** Wraps on narrow panes; clear stays disabled until there are committed strokes. */
export function PresenterInkStrip({scope='presenter-ink-tools',revision=0,...props}:PresenterInkStripProps){
 if(!Number.isSafeInteger(props.strokeCount)||props.strokeCount<0)throw new RangeError('Invalid presenter stroke count');
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <PresenterInkStripBody {...props} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending} actionError={guard.error} onModeChange={mode=>guard.current()?.onModeChange(mode)} onClear={()=>guard.run('clear',h=>h.onClear())} capture={props.capture?{...props.capture,onChange:enabled=>guard.run('capture',(h,s)=>h.capture?.unavailableReason===undefined?h.capture?.onChange(enabled,s):undefined)}:undefined}/>;
}
function PresenterInkStripBody({capture,actionError,disabledReason,mode,onModeChange,strokeCount,onClear,disabled=false,className,unstyled=false,...rest}:PresenterInkStripProps&{actionError?:string|null}){return <View {...rest} role="toolbar" accessibilityLabel="Presenter ink" style={{flexDirection:'row',gap:4,flexWrap:'wrap'}} {...{className}}>
 {PRESENTER_INK_TOOLS.map(tool=><Pressable key={tool} accessibilityRole="button" accessibilityLabel={PRESENTER_INK_TOOL_LABELS[tool]} accessibilityHint={PRESENTER_INK_SHORTCUTS[tool]} {...webToggleProps(mode===tool)} accessibilityState={{selected:mode===tool,disabled}} disabled={disabled} onPress={()=>onModeChange(tool)} style={{minWidth:44,minHeight:44,justifyContent:'center',paddingHorizontal:12}} {...{className:!unstyled?joinClasses('rounded-control focus-visible:ring-2 focus-visible:ring-focus',mode===tool?'bg-primary':'bg-surface-sunken'):undefined}}><Text {...{className:!unstyled?(mode===tool?'text-on-primary':'text-text'):undefined}}>{PRESENTER_INK_TOOL_LABELS[tool]}</Text></Pressable>)}
 {capture?<Button title={'Ink capture '+(capture.enabled?'on':'off')} accessibilityState={{checked:capture.enabled}} accessibilityHint={capture.unavailableReason} disabled={disabled||capture.unavailableReason!==undefined} unstyled={unstyled} onPress={()=>capture.onChange(!capture.enabled)}/>:null}
 <Button title="Clear ink" variant="secondary" disabled={disabled||strokeCount===0} unstyled={unstyled} onPress={onClear}/><Button title="Exit ink" variant="secondary" disabled={disabled||mode==='off'} unstyled={unstyled} onPress={()=>onModeChange('off')}/><ErrorMessage message={actionError??disabledReason??capture?.unavailableReason} unstyled={unstyled}/>
 </View>;}
