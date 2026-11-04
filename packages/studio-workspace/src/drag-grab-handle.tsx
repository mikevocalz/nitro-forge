import { keyboardKey, type StudioKeyboardEvent } from './keyboard-event';
import { useEffect, useRef } from 'react';
import { StudioGesture } from './studio-gesture';
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
  const keyboard = { onKeyDown: (event: StudioKeyboardEvent) => { if (keyboardKey(event) === 'Escape') controller.cancel(); } };
  return <StudioGesture disabled={!!props.disabled} onBegin={controller.begin}
    onMove={(point, touches) => { if (touches === 1) controller.move(point); else controller.cancel(); }}
    onRelease={controller.release} onCancel={controller.cancel}><View collapsable={false} {...keyboard} accessibilityLabel={props.label} accessibilityState={{ disabled: !!props.disabled }}
    style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center', opacity: props.disabled ? .4 : 1 }}>
    <ForgeIcon name="menu" size={16} color={props.color} reducedMotion />
  </View></StudioGesture>;
}
