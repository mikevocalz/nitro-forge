import {Text,View,type ViewProps} from "react-native";
import {SegmentedControl} from "@nyc-tron/ui/components/SegmentedControl";
import {ErrorMessage} from "@nyc-tron/ui/components/feedback/ErrorMessage";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {controlIdentity,useScopedControl,type ScopedControlProps} from "../inputs/useScopedControl.ts";
import {AUTOMATION_MODES,type AutomationMode} from "./automation.ts";
import {exact} from '../exact-optional.ts';
export interface AutomationModePickerProps extends Omit<ViewProps,"children">,ScopedControlProps {
 readonly mode:AutomationMode;readonly onModeCommit:(mode:AutomationMode,signal?:AbortSignal)=>void|Promise<unknown>;
 /** Only the host can enable live write/touch/latch/trim support. */
 readonly capabilities?:readonly {mode:AutomationMode;disabledReason?:string}[];
 readonly label?:string;readonly disabled?:boolean;className?:string;unstyled?:boolean;
}
const NAMES:Record<AutomationMode,string>={off:"Off",read:"Read",write:"Write",touch:"Touch",latch:"Latch",trim:"Trim"};
const LEGACY=[{mode:'off'},{mode:'read'}] as const;
/** Full mode picker with explicit live-transport capabilities and controlled acknowledgements. */
export function AutomationModePicker({scope='automation-mode',revision=0,...props}:AutomationModePickerProps){
 const {mode,onModeCommit:_commit,capabilities=LEGACY,label='Automation',disabled=false,disabledReason,className,unstyled=false,style,...rest}=props;
 if(!AUTOMATION_MODES.includes(mode)||capabilities.length>6||new Set(capabilities.map(c=>c.mode)).size!==capabilities.length||capabilities.some(c=>!AUTOMATION_MODES.includes(c.mode)))throw new RangeError('Invalid automation modes');
 const owner=JSON.stringify([...controlIdentity(scope,revision),disabled,disabledReason,capabilities]),guard=useScopedControl(owner,props,disabled||disabledReason!==undefined);
 const reason=(m:AutomationMode)=>{const capability=capabilities.find(c=>c.mode===m);return capability?('disabledReason' in capability?capability.disabledReason:undefined):'Not supported by the current audio host';};
 return <View {...rest} {...{className:joinClasses('gap-1',className)}} style={style}>
  <Text {...{className:joinClasses(!unstyled&&'text-text-muted text-sm')}}>{label}</Text>
  <SegmentedControl aria-label={label} value={mode} disabled={disabled||disabledReason!==undefined||guard.pending} unstyled={unstyled} options={AUTOMATION_MODES.map(m=>({value:m,label:NAMES[m],disabled:reason(m)!==undefined}))}
   onChange={next=>guard.run('mode',(host,signal)=>{const caps=host.capabilities??LEGACY,entry=caps.find(c=>c.mode===next);return entry&&(!('disabledReason' in entry)||entry.disabledReason===undefined)?host.onModeCommit(next,signal):undefined;})}/>
  {AUTOMATION_MODES.filter(m=>reason(m)!==undefined).map(m=><Text key={m} {...{className:joinClasses(!unstyled&&'text-text-muted text-xs')}}>{NAMES[m]}: {reason(m)}</Text>)}
  <ErrorMessage {...exact({message:guard.error??undefined,unstyled:unstyled})}/>
 </View>;
}
