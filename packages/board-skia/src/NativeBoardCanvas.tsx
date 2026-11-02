import { Canvas, DashPathEffect, Fill, Group, Path, Skia } from "react-native-skia";
import type { ReactElement, ReactNode } from "react";
import type { SceneResult } from "./scene";

/**
 * A genuine React Native Skia v3 Graphite canvas. No HTML, WebView, bitmap
 * bridge or second document/editor. Receives a derived QuickDraw scene.
 *
 * Unsupported shapes use the caller's fallback instead of drawing an
 * incomplete document. Input remains owned by the existing QuickDraw router.
 */
export interface NativeBoardCanvasProps {
  readonly scene: SceneResult;
  readonly width: number;
  readonly height: number;
  readonly boardWidth: number;
  readonly boardHeight: number;
  readonly backgroundColor?: string;
  /** Required: old board or loading/error UI; never silently drop records. */
  readonly fallback: ReactNode;
}

export function NativeBoardCanvas({
  scene, width, height, boardWidth, boardHeight,
  backgroundColor = "#FFFFFF", fallback,
}: NativeBoardCanvasProps): ReactElement {
  if (scene.kind !== "ready" ||
      ![width, height, boardWidth, boardHeight].every(
        (n) => Number.isFinite(n) && n > 0
      ) || !Skia.gpu.isAvailable) {
    return <>{fallback}</>;
  }
  const x = width / boardWidth;
  const y = height / boardHeight;
  return (
    <Canvas
      style={{ width, height }}
      android={{ backingView: "SurfaceView", opaque: true }}
    >
      <Fill color={backgroundColor} />
      <Group transform={[{ scaleX: x }, { scaleY: y }]}>
        {scene.marks.map((m) => (
          <Group key={m.id}
            origin={m.rotation ? { x: m.rotation.centerX, y: m.rotation.centerY } : undefined}
            transform={m.rotation ? [{ rotate: m.rotation.radians }] : undefined}
          >
          <Path
            path={m.path}
            color={m.color}
            style={m.mode}
            strokeWidth={m.width}
            strokeJoin="round"
            strokeCap="round"
            opacity={m.alpha}
            blendMode={m.blendMode}
          >
            {m.mode === "stroke" && m.dash !== "solid" ? (
              <DashPathEffect
                intervals={m.dash === "dotted"
                  ? [0.01, Math.max(0.01, m.width * 2.5)]
                  : [m.width * 3.2, m.width * 2.6]}
              />
            ) : null}
          </Path>
          </Group>
        ))}
      </Group>
    </Canvas>
  );
}
