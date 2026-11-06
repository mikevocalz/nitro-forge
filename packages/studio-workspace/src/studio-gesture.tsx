import { cloneElement, useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';
import type { StudioGestureProps } from './studio-gesture-types';

/** Browser responder transport. Native resolves the Gesture Handler sibling. */
export function StudioGesture(props: StudioGestureProps) {
  const current = useRef(props); current.current = props;
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: event => !current.current.disabled && event.nativeEvent.touches.length === 1,
    onPanResponderGrant: event => current.current.onBegin({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }),
    onPanResponderStart: event => { if (event.nativeEvent.touches.length !== 1) current.current.onCancel(); },
    onPanResponderMove: (event, state) => current.current.onMove({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }, state.numberActiveTouches),
    onPanResponderRelease: event => current.current.onRelease({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }),
    onPanResponderTerminationRequest: () => true,
    onPanResponderTerminate: () => current.current.onCancel(),
  }), []);
  return cloneElement(props.children, responder.panHandlers);
}
