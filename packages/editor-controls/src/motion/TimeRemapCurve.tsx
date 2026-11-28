import {MotionCurveEditor,type MotionCurveEditorProps} from './MotionCurveEditor.tsx';
export interface TimeRemapCurveProps extends Omit<MotionCurveEditorProps,'mode'|'valueLabel'> {readonly sourceDuration:number}
/** Source seconds against composition seconds; reverse/freeze segments are retained. */
export function TimeRemapCurve({sourceDuration,...props}:TimeRemapCurveProps){if(!Number.isFinite(sourceDuration)||sourceDuration<=0||props.value.minimum<0||props.value.maximum>sourceDuration)throw new RangeError('Time remap values must stay within the source duration');return <MotionCurveEditor {...props} mode="value" valueLabel="Source time seconds"/>;}
