import { Canvas, DashPathEffect, Fill, Group, Path, Skia } from "react-native-skia";
import { useRef, type ReactElement, type ReactNode } from "react";
import type { SceneResult } from "./scene";
import { boardTransform } from "../ink/geometry";
import { createSvgPathCache, type SvgPathCache } from "./svg-path-cache";

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
  const cache = useRef<SvgPathCache | null>(null);
  if (cache.current === null) cache.current = createSvgPathCache((svg) => Skia.Path.MakeFromSVGString(svg));
  if (scene.kind !== "ready" ||
      ![width, height, boardWidth, boardHeight].every(
        (n) => Number.isFinite(n) && n > 0
      ) || !Skia.gpu.isAvailable) {
    return <>{fallback}</>;
  }
  // Keep drawing coordinates isotropic on resize, iPad split-screen and
  // foldable panes. Nonuniform scaling changes brush shape and input mapping.
  const transform = boardTransform(boardWidth, boardHeight, width, height);
  if (transform === null) return <>{fallback}</>;
  const paths = cache.current.resolve(scene.marks);
  // A path Skia cannot parse would draw an incomplete document: fall back.
  if (paths === null) return <>{fallback}</>;
  return (
    <Canvas
      style={{ width, height }}
      android={{ backingView: "SurfaceView", opaque: true }}
    >
      <Fill color={backgroundColor} />
      <Group transform={[
          { translateX: transform.offsetX }, { translateY: transform.offsetY },
          { scaleX: transform.scale }, { scaleY: transform.scale },
        ]}>
        {scene.marks.map((m, index) => (
          <Group key={m.id}
            {...(m.rotation === undefined ? {} : {
              origin: { x: m.rotation.centerX, y: m.rotation.centerY },
              transform: [{ rotate: m.rotation.radians }],
            })}
          >
          <Path
            path={paths[index]!}
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
