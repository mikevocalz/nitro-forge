/** Original accessible equivalents for simple axis-aligned shape transforms.
 * These are command payloads, never a second geometry/document model. */
export const SHAPE_TRANSFORMS = [
  { id: 'left', title: 'Move left 1 px', dx: -1, dy: 0, scale_x: 1, scale_y: 1 },
  { id: 'right', title: 'Move right 1 px', dx: 1, dy: 0, scale_x: 1, scale_y: 1 },
  { id: 'up', title: 'Move up 1 px', dx: 0, dy: -1, scale_x: 1, scale_y: 1 },
  { id: 'down', title: 'Move down 1 px', dx: 0, dy: 1, scale_x: 1, scale_y: 1 },
  { id: 'left-fast', title: 'Move left 10 px', dx: -10, dy: 0, scale_x: 1, scale_y: 1 },
  { id: 'right-fast', title: 'Move right 10 px', dx: 10, dy: 0, scale_x: 1, scale_y: 1 },
  { id: 'up-fast', title: 'Move up 10 px', dx: 0, dy: -10, scale_x: 1, scale_y: 1 },
  { id: 'down-fast', title: 'Move down 10 px', dx: 0, dy: 10, scale_x: 1, scale_y: 1 },
  { id: 'grow', title: 'Enlarge 10% from top-left', dx: 0, dy: 0, scale_x: 1.1, scale_y: 1.1 },
  { id: 'shrink', title: 'Shrink 10% from top-left', dx: 0, dy: 0, scale_x: .9, scale_y: .9 },
] as const;

export function shapeTransformPayload(id: number, action: string) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const transform = SHAPE_TRANSFORMS.find(item => item.id === action);
  if (!transform) return null;
  const { dx, dy, scale_x, scale_y } = transform;
  return { id, dx, dy, scale_x, scale_y };
}
