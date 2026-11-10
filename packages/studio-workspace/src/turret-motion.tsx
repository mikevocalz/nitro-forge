import { useEffect, useRef } from 'react';
import type { ViewStyle } from 'react-native';
import { View, type StudioViewRef } from './ui';
import { forgeFeedbackMotion as feedback } from './forge-directions';
import type { TurretPointerProps, TurretRimProps } from './turret-motion-types';

export type { TurretPulse, TurretPointerProps, TurretRimProps } from './turret-motion-types';

type Animatable = { animate?: (frames: Record<string, string | number>[], options: Record<string, string | number>) => unknown };
const dom = (ref: StudioViewRef | null) => ref as unknown as Animatable | null;

/** Browser pointer: the detent travel is a CSS transition the compositor runs;
 * the end-stop nudge is one Web Animation. Native uses Reanimated (sibling file). */
export function TurretPointer(props: TurretPointerProps) {
  const ref = useRef<StudioViewRef | null>(null);
  const latest = useRef(props); latest.current = props;
  useEffect(() => {
    const { pulse, reduceMotion, deg } = latest.current;
    if (!pulse || pulse.kind !== 'end-stop' || reduceMotion) return;
    const past = deg + feedback.endStop.deg * pulse.dir;
    dom(ref.current)?.animate?.(
      [{ transform: `rotate(${deg}deg)` }, { transform: `rotate(${past}deg)` }, { transform: `rotate(${deg}deg)` }],
      { duration: feedback.endStop.beatMs * 2, easing: 'ease-out' },
    );
  }, [props.pulse?.seq]);
  const motion = (props.durationMs > 0
    ? { transitionProperty: 'transform', transitionDuration: `${props.durationMs}ms`, transitionTimingFunction: props.easing }
    : {}) as ViewStyle;
  return <View ref={ref} pointerEvents="none" testID="persona-turret-indicator"
    style={{ position: 'absolute', left: 0, top: 0, width: props.size, height: props.size, transform: [{ rotate: `${props.deg}deg` }], ...motion }}>
    {props.children}
  </View>;
}

/** The rim light that confirms a commit, and stands in for the end-stop nudge
 * under Reduce Motion. Opacity only, so it is safe in both modes. */
export function TurretRim(props: TurretRimProps) {
  const ref = useRef<StudioViewRef | null>(null);
  const latest = useRef(props); latest.current = props;
  useEffect(() => {
    const { pulse, reduceMotion } = latest.current;
    if (!pulse || (pulse.kind === 'end-stop' && !reduceMotion)) return;
    const ms = pulse.kind === 'commit' ? feedback.commit.ms : feedback.endStop.beatMs * 2;
    dom(ref.current)?.animate?.([{ opacity: 0 }, { opacity: feedback.commit.peakOpacity, offset: 0.35 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
  }, [props.pulse?.seq]);
  const color = props.pulse?.kind === 'end-stop' ? props.limitColor : props.commitColor;
  return <View ref={ref} pointerEvents="none" testID="persona-turret-rim"
    style={{ position: 'absolute', left: 0, top: 0, width: props.size, height: props.size, borderRadius: props.size / 2, borderWidth: 3, borderColor: color, opacity: 0 }} />;
}
