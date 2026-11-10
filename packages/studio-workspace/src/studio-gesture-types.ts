import type { ReactElement } from 'react';
export type GesturePoint = { x: number; y: number };
export type StudioGestureProps = {
  children: ReactElement; disabled?: boolean;
  onBegin: (point: GesturePoint) => void;
  onMove: (point: GesturePoint, touches: number) => void;
  onRelease: (point: GesturePoint) => void;
  onCancel: () => void;
};
