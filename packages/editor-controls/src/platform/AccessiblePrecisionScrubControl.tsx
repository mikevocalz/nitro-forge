import {PrecisionScrubber,type PrecisionScrubberProps} from '@nyc-tron/ui/components/shell/PrecisionScrubber';
import {GestureHandlerDrag} from '@nyc-tron/ui/components/gestures/GestureHandlerDrag';
export type AccessiblePrecisionScrubControlProps=Omit<PrecisionScrubberProps,'transport'>;
/** One precision model for native RNGH pointer, keyboard, switch, adjustable actions and explicit numeric entry. */
export function AccessiblePrecisionScrubControl(props:AccessiblePrecisionScrubControlProps){return <PrecisionScrubber {...props} transport={GestureHandlerDrag}/>;}
