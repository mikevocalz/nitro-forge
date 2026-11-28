import {MediaMonitor,type MediaMonitorProps} from './MediaMonitor.tsx';
export type ProgramMonitorProps=Omit<MediaMonitorProps,'kind'|'range'|'onRangeChange'|'onOpenSource'>;
/** Actual presented-frame telemetry, timeline compositor surface and framing overlays. */
export function ProgramMonitor(props:ProgramMonitorProps){return <MediaMonitor {...props} kind="program"/>;}
