import { useMemo, useRef } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { StudioGestureProps, GesturePoint } from './studio-gesture-types';

/** Native recognition; document commands and async measurement stay on JS. */
export function StudioGesture(props: StudioGestureProps) {
  const current = useRef(props); current.current = props;
  const gesture = useMemo(() => {
    let start: GesturePoint = { x: 0, y: 0 };
    let panClaimed = false;
    let tapRejected = false;
    const pan = Gesture.Pan()
      .enabled(!props.disabled).minDistance(0).maxPointers(1).runOnJS(true)
      // Pan may remain BEGAN for DOWN→UP without a MOVE, even at distance zero.
      .onBegin(event => { start = { x: event.absoluteX, y: event.absoluteY }; panClaimed = false; })
      .onStart(() => { panClaimed = true; current.current.onBegin(start); })
      .onTouchesDown(event => { if (event.numberOfTouches !== 1) current.current.onCancel(); })
      .onUpdate(event => current.current.onMove({ x: event.absoluteX, y: event.absoluteY }, event.numberOfPointers))
      .onEnd((event, success) => {
        if (success) current.current.onRelease({ x: event.absoluteX, y: event.absoluteY });
        else if (panClaimed) current.current.onCancel();
      })
      // The losing Pan must not cancel the winning Tap's async release.
      .onFinalize((_event, success) => { if (!success && panClaimed) current.current.onCancel(); });
    const tap = Gesture.Tap().enabled(!props.disabled).maxDistance(4).runOnJS(true)
      .onBegin(event => { tapRejected = event.numberOfPointers !== 1; })
      .onTouchesDown(event => { if (event.numberOfTouches !== 1) tapRejected = true; })
      .onEnd((event, success) => {
        if (!success || tapRejected) return;
        const point = { x: event.absoluteX, y: event.absoluteY };
        current.current.onBegin(point);
        current.current.onRelease(point);
      });
    return Gesture.Race(pan, tap);
  }, [props.disabled]);
  return <GestureDetector gesture={gesture}>{props.children}</GestureDetector>;
}
