/**
 * Skia v3 (Graphite) native presentation.
 * No WebView or HTML editor; no second document/history. Consumers provide a
 * frame derived from their existing canonical board and persist through the
 * onPointer callback into that board's command/input pipeline.
 *
 * Device verification (Metal / Vulkan / Expo 58 / visionOS) remains pending.
 */
import { useMemo, useRef, type ReactElement } from "react";
import { View, type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";
import { Canvas, Circle, Fill, Oval, Path, Rect, Skia } from "react-native-skia";
import { boardTransform, projectPointer, strokeToSegments } from "./geometry";
import type {
  BoardDrawable,
  NativeBoardFrame,
  NativeBoardPointer,
} from "./index";

export interface NativeBoardCanvasProps {
  readonly frame: NativeBoardFrame;
  /** Measured view size in RN logical points; not framebuffer pixels. */
  readonly width: number;
  readonly height: number;
  /** A draw event; caller sends it to the canonical editor/session. */
  readonly onPointer?: (event: NativeBoardPointer) => void;
  readonly style?: StyleProp<ViewStyle>;
  readonly backgroundColor?: string;
}

type DrawItem =
  | { kind: "segment"; key: string; x: number; y: number; radius: number;
      path?: ReturnType<ReturnType<typeof Skia.PathBuilder.Make>["build"]>;
      width: number; color: string; opacity: number }
  | { kind: "rect" | "ellipse"; key: string;
      x: number; y: number; width: number; height: number;
      color: string; opacity: number };

const alpha = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) ? 1 : Math.min(1, Math.max(0, value));

function renderItems(
  drawables: readonly BoardDrawable[],
  transform: NonNullable<ReturnType<typeof boardTransform>>,
): DrawItem[] {
  const { scale, offsetX, offsetY } = transform;
  const result: DrawItem[] = [];
  for (const record of drawables) {
    if (record.kind === "stroke") {
      const segments = strokeToSegments(record);
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i]!;
        const path = s.dot ? undefined : Skia.PathBuilder.Make()
          .moveTo(offsetX + s.x1 * scale, offsetY + s.y1 * scale)
          .lineTo(offsetX + s.x2 * scale, offsetY + s.y2 * scale)
          .build();
        result.push({
          kind: "segment", key: record.id + ":" + i,
          x: offsetX + s.x1 * scale, y: offsetY + s.y1 * scale,
          radius: Math.max(0.005, s.width * scale / 2),
          path, width: Math.max(0.01, s.width * scale),
          color: s.color, opacity: s.opacity,
        });
      }
    } else {
      if (![record.x, record.y, record.width, record.height].every(Number.isFinite) ||
          record.width <= 0 || record.height <= 0) continue;
      result.push({
        kind: record.kind, key: record.id,
        x: offsetX + record.x * scale, y: offsetY + record.y * scale,
        width: record.width * scale, height: record.height * scale,
        color: record.color, opacity: alpha(record.opacity),
      });
    }
  }
  return result;
}

export function NativeBoardCanvas({
  frame, width, height, onPointer, style, backgroundColor = "#FFFFFF",
}: NativeBoardCanvasProps): ReactElement {
  const activePointer = useRef<number | null>(null);
  const transform = useMemo(
    () => boardTransform(frame.width, frame.height, width, height),
    [frame.width, frame.height, width, height],
  );
  const items = useMemo(
    () => transform ? renderItems(frame.drawables, transform) : [],
    [frame.drawables, transform],
  );

  const dispatch = (phase: NativeBoardPointer["phase"], event: GestureResponderEvent): void => {
    if (!onPointer || transform === null) return;
    const touch = event.nativeEvent;
    const id = touch.identifier ?? 0;
    if (phase === "down") {
      if (activePointer.current !== null) return; // first pointer owns gesture
    } else if (activePointer.current !== id) return;

    const coords = projectPointer(
      touch.locationX, touch.locationY, frame.width, frame.height,
      transform, phase !== "down",
    );
    if (!coords) return;
    if (phase === "down") activePointer.current = id;

    const force = touch.force;
    onPointer({
      phase, pointerId: id, source: "touch",
      x: coords[0], y: coords[1],
      ...(typeof force === "number" && Number.isFinite(force) && force >= 0 && force <= 1
        ? { pressure: force } : {}),
    });
    if (phase === "up" || phase === "cancel") activePointer.current = null;
  };

  return (
    <View
      collapsable={false}
      style={[{ width, height }, style]}
      onStartShouldSetResponder={() => Boolean(onPointer)}
      onMoveShouldSetResponder={() => Boolean(onPointer)}
      onResponderGrant={(e) => dispatch("down", e)}
      onResponderMove={(e) => dispatch("move", e)}
      onResponderRelease={(e) => dispatch("up", e)}
      onResponderTerminate={(e) => dispatch("cancel", e)}
    >
      <Canvas style={{ width, height }}>
        <Fill color={backgroundColor} />
        {items.map((item) => {
          if (item.kind === "segment") {
            return item.path === undefined
              ? <Circle key={item.key} cx={item.x} cy={item.y} r={item.radius}
                  color={item.color} opacity={item.opacity} />
              : <Path key={item.key} path={item.path} color={item.color}
                  opacity={item.opacity} style="stroke" strokeWidth={item.width}
                  strokeCap="round" strokeJoin="round" />;
          }
          if (item.kind === "rect") {
            return <Rect key={item.key} x={item.x} y={item.y}
              width={item.width} height={item.height}
              color={item.color} opacity={item.opacity} />;
          }
          return <Oval key={item.key} x={item.x} y={item.y}
            width={item.width} height={item.height}
            color={item.color} opacity={item.opacity} />;
        })}
      </Canvas>
    </View>
  );
}
