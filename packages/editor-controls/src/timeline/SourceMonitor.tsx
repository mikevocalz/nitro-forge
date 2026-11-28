import {MediaMonitor,type MediaMonitorProps} from './MediaMonitor.tsx';
export type SourceMonitorProps=Omit<MediaMonitorProps,'kind'>;
/** Source asset preview and in/out marks over the host's actual media surface. */
export function SourceMonitor(props:SourceMonitorProps){return <MediaMonitor {...props} kind="source"/>;}
