import {MotionCurveEditor,type MotionCurveEditorProps} from './MotionCurveEditor.tsx';
export type {MotionPropertyCurve,MotionKeyframe,MotionCurvePoint} from './motion-curves.ts';
export interface KeyframeValueGraphProps extends Omit<MotionCurveEditorProps,'mode'> {}
/** Native Bezier value/time handles and exact numeric keyframe edits. */
export function KeyframeValueGraph(props:KeyframeValueGraphProps){return <MotionCurveEditor {...props} mode="value"/>;}
