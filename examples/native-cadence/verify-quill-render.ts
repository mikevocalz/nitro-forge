import { createNitroHost } from "@nitro-forge/ignition";
import { QUILL_TEST_FONT_B64 } from "./quill-test-font";

/**
 * Native probe for quill `renderPage` R1-R3 (docs/ENGINE_OPS.md §quill,
 * reports P-quill-renderpage-r1/r2/r3). Runs the real Rust engine through
 * the production Nitro host: registerFont, insertText, renderPage in both
 * legacy page-geometry and `use_sections` modes, plus the documented
 * rejection paths. Read-only raster checks only — no snapshot claims.
 */
export async function verifyQuillRenderPage(): Promise<string> {
  const host = createNitroHost();
  const checks: string[] = [];
  const inked = (b64: string) => {
    // Decode only the R channel stride sample: enough to prove glyph ink.
    const bin = atob(b64);
    const px = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) px[i] = bin.charCodeAt(i);
    for (let i = 0; i < px.length; i += 4) if (px[i]! < 200) return true;
    return false;
  };
  try {
    const handle = await host.open("quill");
    try {
      await host.apply(handle, { op: "new", payload: {} });
      await host.apply(handle, {
        op: "insertText",
        payload: { at: { block: 0, offset: 0 }, text: "Hello World" },
      });
      const reg = await host.apply<{
        family: string; sha256: string; registered: boolean;
      }>(handle, {
        op: "registerFont",
        payload: { family: "NFTestMono", bytes_b64: QUILL_TEST_FONT_B64 },
      });
      if (!reg.data.registered && reg.data.sha256.length !== 64)
        throw new Error("quill registerFont returned an unexpected record");
      checks.push(`registerFont ok sha256=${reg.data.sha256.slice(0, 12)}…`);

      // R1/R2: fixed page geometry render.
      const r1 = await host.apply<{
        page: number; width: number; height: number; format: string;
        size: number; pixels_b64?: string;
      }>(handle, {
        op: "renderPage",
        payload: {
          page_width: 200, font_size: 12, page_height: 100,
          font: "NFTestMono", page: 0,
        },
      });
      const d1 = r1.data;
      if (d1.format !== "raw" || !d1.pixels_b64) throw new Error("renderPage: bad envelope");
      // 200pt x 100pt at 96dpi -> 267x133 px.
      if (d1.width !== 267 || d1.height !== 133)
        throw new Error(`renderPage dims ${d1.width}x${d1.height}, expected 267x133`);
      const expectedBytes = d1.width * d1.height * 4;
      const decoded = atob(d1.pixels_b64).length;
      if (decoded !== expectedBytes) throw new Error("renderPage pixel byte count mismatch");
      if (!inked(d1.pixels_b64)) throw new Error("renderPage produced no glyph ink");
      checks.push(`renderPage fixed-geometry ${d1.width}x${d1.height} inked`);

      // Determinism: same inputs must give identical pixels.
      const r1b = await host.apply<{ pixels_b64?: string }>(handle, {
        op: "renderPage",
        payload: {
          page_width: 200, font_size: 12, page_height: 100,
          font: "NFTestMono", page: 0,
        },
      });
      if (r1b.data.pixels_b64 !== d1.pixels_b64)
        throw new Error("renderPage is not deterministic");
      checks.push("renderPage deterministic");

      // R3: sectioned pagination path on the same single-section document.
      const r3 = await host.apply<{
        page: number; width: number; height: number; format: string;
        pixels_b64?: string; section?: number; number?: number;
      }>(handle, {
        op: "renderPage",
        payload: { use_sections: true, font_size: 12, font: "NFTestMono", page: 0 },
      });
      const d3 = r3.data;
      if (d3.format !== "raw" || !d3.pixels_b64 || d3.section === undefined || d3.number === undefined)
        throw new Error("renderPage use_sections: missing section/number fields");
      if (!inked(d3.pixels_b64)) throw new Error("renderPage use_sections produced no ink");
      checks.push(`renderPage use_sections section=${d3.section} number=${d3.number} ${d3.width}x${d3.height} inked`);

      // Documented rejections.
      let rejected = false;
      try {
        await host.apply(handle, {
          op: "renderPage",
          payload: { page_width: 200, font_size: 12, page_height: 100, font: "", page: 0 },
        });
      } catch { rejected = true; }
      if (!rejected) throw new Error("renderPage accepted an empty font");
      checks.push("renderPage empty-font rejection ok");

      rejected = false;
      try {
        await host.apply(handle, {
          op: "renderPage",
          payload: { page_width: 200, font_size: 12, page_height: 100, font: "NFTestMono", page: 9 },
        });
      } catch { rejected = true; }
      if (!rejected) throw new Error("renderPage accepted an out-of-range page");
      checks.push("renderPage out-of-range-page rejection ok");
    } finally {
      await host.close(handle);
    }
    return `Quill renderPage passed: ${checks.join("; ")}.`;
  } finally {
    await host.dispose();
  }
}
