import {NativeSeekBar} from '../NativeSeekBar.web.tsx';
import {FrameAccurateScrubberBody,type FrameAccurateScrubberProps} from './FrameAccurateScrubber.shared.tsx';
export type {FrameAccurateScrubberProps,FrameSeekRequest,FrameSeekResult} from './FrameAccurateScrubber.shared.tsx';
export function FrameAccurateScrubber(props:FrameAccurateScrubberProps){return <FrameAccurateScrubberBody {...props} SeekBar={NativeSeekBar}/>;}
