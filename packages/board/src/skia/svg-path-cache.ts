import type { SkPath } from "react-native-skia";

/**
 * Parsed Skia paths keyed by mark id. The scene bridge recompiles the whole
 * document on every store change, so without this every frame of a live
 * stroke re-parsed every path on the board. A mark whose SVG string is
 * unchanged reuses its SkPath; ids that leave the scene are dropped.
 */
export interface SvgPathCache {
  /** Returns paths in `marks` order, or null when any SVG fails to parse. */
  resolve(marks: readonly { readonly id: string; readonly path: string }[]): (SkPath)[] | null;
}

export function createSvgPathCache(parse: (svg: string) => SkPath | null): SvgPathCache {
  let entries = new Map<string, { svg: string; path: SkPath }>();
  return {
    resolve(marks) {
      const next = new Map<string, { svg: string; path: SkPath }>();
      const out: SkPath[] = [];
      for (const mark of marks) {
        const previous = entries.get(mark.id);
        let path = previous !== undefined && previous.svg === mark.path ? previous.path : null;
        if (path === null) path = parse(mark.path);
        if (path === null) return null;
        next.set(mark.id, { svg: mark.path, path });
        out.push(path);
      }
      entries = next;
      return out;
    },
  };
}
