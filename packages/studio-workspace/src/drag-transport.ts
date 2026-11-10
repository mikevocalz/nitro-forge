import { PanResponderDrag } from '@nyc-tron/ui/components/gestures/PanResponderDrag';
import type { DragTransport } from '@nyc-tron/ui/components/gestures/drag-transport';

/** Pointer recogniser for NYC-Tron drag parts in Forge: the browser responder
 * here, Gesture Handler on native (drag-transport.native.ts), matching
 * StudioGesture so docking and reordering keep their platform recognisers. */
export const forgeDragTransport: DragTransport = PanResponderDrag;
