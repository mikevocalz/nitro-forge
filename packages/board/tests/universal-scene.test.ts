import { describe, expect, it } from "vitest";
import {
  compileUniversalCanvasScene, type UniversalCanvasFrame,
} from "../src/universal-scene";

const sample = (): UniversalCanvasFrame => ({
  schemaVersion: 1, width: 1000, height: 600,
  elements: [
    { id: "ink", path: "M 10 10 L 100 10", color: "#4263eb", mode: "stroke",
      strokeWidth: 2, opacity: 0.7 },
    { id: "shape", path: "M 5 5 L 40 5 L 40 30 Z", color: "#ff0000",
      mode: "fill", blend: "multiply" },
  ],
});

describe("universal board scene is independent of QuickDraw", () => {
  it("renders documents from other editors without importing QuickDraw records", () => {
    expect(compileUniversalCanvasScene(sample())).toEqual({
      kind: "ready",
      marks: [
        { id: "ink", path: "M 10 10 L 100 10", color: "#4263eb", mode: "stroke",
          width: 2, alpha: 0.7, dash: "solid", blendMode: "srcOver" },
        { id: "shape", path: "M 5 5 L 40 5 L 40 30 Z", color: "#ff0000",
          mode: "fill", width: 0, alpha: 1, dash: "solid", blendMode: "multiply" },
      ],
    });
  });

  it("preserves original z-order rather than sorting by id", () => {
    const frame = sample();
    const result = compileUniversalCanvasScene({ ...frame,
      elements: [...frame.elements].reverse(),
    });
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") expect(result.marks.map(x => x.id)).toEqual(["shape", "ink"]);
  });

  it("rejects duplicate IDs, unsupported inputs and invalid dimensions", () => {
    const frame = sample();
    expect(compileUniversalCanvasScene({ ...frame,
      elements: [frame.elements[0]!, frame.elements[0]!],
    }).kind).toBe("unsupported");
    expect(compileUniversalCanvasScene({ ...frame, width: Infinity }).kind).toBe("unsupported");
    expect(compileUniversalCanvasScene({ ...frame,
      elements: [{ ...frame.elements[0]!, path: "<svg onload=alert(1)>" }],
    }).kind).toBe("unsupported");
  });

  it("requires a complete supported scene; no silent skipped marks", () => {
    const frame = sample();
    const bad: UniversalCanvasFrame = { ...frame,
      elements: [frame.elements[0]!, { ...frame.elements[1]!, color: "unknown" }],
    };
    const result = compileUniversalCanvasScene(bad);
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") expect(result.reasons).toHaveLength(1);
  });

  it("enforces bounded path buffers and correct paint geometry", () => {
    const frame = sample();
    expect(compileUniversalCanvasScene({ ...frame,
      elements: [{ ...frame.elements[0]!, path: "M " + "1".repeat(200_001) }],
    }).kind).toBe("unsupported");
    expect(compileUniversalCanvasScene({ ...frame,
      elements: [{ ...frame.elements[0]!, opacity: -1 }],
    }).kind).toBe("unsupported");
    expect(compileUniversalCanvasScene({ ...frame,
      elements: [{ ...frame.elements[0]!, rotation: { radians: Infinity, centerX: 0, centerY: 0 } }],
    }).kind).toBe("unsupported");
  });
});
