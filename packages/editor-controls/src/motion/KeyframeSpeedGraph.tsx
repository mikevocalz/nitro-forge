import {MotionCurveEditor,type MotionCurveEditorProps} from './MotionCurveEditor.tsx';
export interface KeyframeSpeedGraphProps extends Omit<MotionCurveEditorProps,'mode'> {}
/** Analytic velocity samples plus editable temporal influence and in/out slopes. */
export function KeyframeSpeedGraph(props:KeyframeSpeedGraphProps){return <MotionCurveEditor {...props} mode="speed"/>;}
