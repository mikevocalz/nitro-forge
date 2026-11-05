import { useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { forgeFeedbackMotion as feedback } from './forge-directions';
import type { TurretPointerProps, TurretRimProps } from './turret-motion-types';

export type { TurretPulse, TurretPointerProps, TurretRimProps } from './turret-motion-types';

/** Native pointer. React hands over one target angle per detent; Reanimated
 * runs the travel and the end-stop nudge on the UI thread. Reduce Motion
 * arrives as durationMs 0, so the pointer steps. */
export function TurretPointer(props: TurretPointerProps) {
  const angle = useSharedValue(props.deg);
  const [x1, y1, x2, y2] = props.bezier;
  useEffect(() => {
    angle.set(props.durationMs > 0 ? withTiming(props.deg, { duration: props.durationMs, easing: Easing.bezier(x1, y1, x2, y2) }) : props.deg);
  }, [angle, props.deg, props.durationMs, x1, y1, x2, y2]);
  useEffect(() => {
    const pulse = props.pulse;
    if (!pulse || pulse.kind !== 'end-stop' || props.reduceMotion) return;
    const beat = { duration: feedback.endStop.beatMs, easing: Easing.out(Easing.quad) };
    angle.set(withSequence(withTiming(props.deg + feedback.endStop.deg * pulse.dir, beat), withTiming(props.deg, beat)));
    // Keyed on the beat only: a new detent restarts travel through the effect above.
  }, [props.pulse?.seq]);
  const rotate = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.get()}deg` }] }));
  return <Animated.View pointerEvents="none" testID="persona-turret-indicator"
    style={[{ position: 'absolute', left: 0, top: 0, width: props.size, height: props.size }, rotate]}>
    {props.children}
  </Animated.View>;
}

/** Rim light for a commit, and the end-stop cue under Reduce Motion. */
export function TurretRim(props: TurretRimProps) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    const pulse = props.pulse;
    if (!pulse || (pulse.kind === 'end-stop' && !props.reduceMotion)) return;
    const ms = pulse.kind === 'commit' ? feedback.commit.ms : feedback.endStop.beatMs * 2;
    opacity.set(withSequence(
      withTiming(feedback.commit.peakOpacity, { duration: Math.round(ms * 0.35), easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: Math.round(ms * 0.65), easing: Easing.out(Easing.quad) }),
    ));
  }, [props.pulse?.seq]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const color = props.pulse?.kind === 'end-stop' ? props.limitColor : props.commitColor;
  return <Animated.View pointerEvents="none" testID="persona-turret-rim"
    style={[{ position: 'absolute', left: 0, top: 0, width: props.size, height: props.size, borderRadius: props.size / 2, borderWidth: 3, borderColor: color }, fade]} />;
}
