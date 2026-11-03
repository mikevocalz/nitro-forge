import { useEffect, useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';
import { View } from './ui';
import { ForgeIcon } from '@nitro-forge/icons/native';
import { createDragController, type DragPoint } from './drag-controller';
export type { DragPoint } from './drag-controller';

/** One pointer/native responder shared by workspace docking and layer ordering. */
export function DragGrabHandle(props: {
  label: string; color: string; disabled?: boolean;
  onStart: () => void; onMove: (point: DragPoint) => void;
  onCommit: () => void; onCancel: () => void;
}) {
  const current = useRef(props);
  current.current = props;
  const controllerRef = useRef<ReturnType<typeof createDragController> | null>(null);
  if (!controllerRef.current) controllerRef.current = createDragController({
    disabled: () => !!current.current.disabled,
    start: () => current.current.onStart(), move: point => current.current.onMove(point),
    commit: () => current.current.onCommit(), cancel: () => current.current.onCancel(),
  });
  const controller = controllerRef.current;
  useEffect(() => () => controller.cancel(), [controller]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !current.current.disabled,
    onPanResponderGrant: () => controller.begin(),
    onPanResponderMove: (_event, gesture) => controller.move({ x: gesture.moveX, y: gesture.moveY }),
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: () => controller.release(),
    onPanResponderTerminate: () => controller.cancel(),
  }), []);
  const keyboard = { onKeyDown: (event: { key: string }) => { if (event.key === 'Escape') controller.cancel(); } };
  return <View {...responder.panHandlers} {...keyboard} accessibilityLabel={props.label} accessibilityState={{ disabled: !!props.disabled }}
    style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center', opacity: props.disabled ? .4 : 1 }}>
    <ForgeIcon name="menu" size={16} color={props.color} reducedMotion />
  </View>;
}
