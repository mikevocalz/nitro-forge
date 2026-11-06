import { GestureHandlerDrag } from '@nyc-tron/ui/components/gestures/GestureHandlerDrag';
import type { DragTransport } from '@nyc-tron/ui/components/gestures/drag-transport';

/** Native drags run on Gesture Handler, as StudioGesture does. */
export const forgeDragTransport: DragTransport = GestureHandlerDrag;
