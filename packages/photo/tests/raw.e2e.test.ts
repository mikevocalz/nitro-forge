import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { CliHost } from "../../ignition/src/host-cli";
import { PhotoDocument, IDENTITY_DEVELOP } from "../src/index";
import { RawDecodeService, processDecodedPreview } from "../src/raw";

/**
 * e2e for the raw-decode host service (rust/raw-decode over nf-raw /
 * LibRaw) chained into the real photo engine through `processPreview` —
 * the admitted P10 boundary. Requires `cargo build -p raw-decode`, a
 * LibRaw build (see rust/nf-raw/README.md), and a real RAW/DNG fixture
 * via `NF_RAW_TEST_FIXTURE` (the CC0 Pentax K-7 DNG referenced by
 * tooling/raw-prototype/manifest.json is the reference fixture; it is
 * intentionally not committed). Skips when binary or fixture is absent.
 */

const BIN =
  process.env.RAW_DECODE ??
  fileURLToPath(new URL("../../../target/debug/raw-decode", import.meta.url).href);
const FIXTURE = process.env.NF_RAW_TEST_FIXTURE;
const HAVE_BIN = existsSync(BIN);
const HAVE_FIXTURE = FIXTURE !== undefined && existsSync(FIXTURE);

let host: CliHost;
let svc: RawDecodeService | undefined;
let doc: PhotoDocument | undefined;
let rawBytes: Uint8Array;
let unavailable: string | undefined;

function skip(ctx: { skip: () => void }) {
  if (!HAVE_BIN || !HAVE_FIXTURE || unavailable !== undefined) ctx.skip();
}

beforeAll(async () => {
  if (!HAVE_BIN || !HAVE_FIXTURE) return;
  rawBytes = new Uint8Array(readFileSync(FIXTURE!));
  try {
    svc = RawDecodeService.connect(BIN);
    host = new CliHost();
    doc = await PhotoDocument.open(host);
  } catch (e) {
    unavailable = e instanceof Error ? e.message : String(e);
    svc = undefined;
    doc = undefined;
  }
});

afterAll(async () => {
  await doc?.close().catch(() => {});
  await svc?.dispose().catch(() => {});
  await host?.dispose().catch(() => {});
});

describe.runIf(HAVE_BIN && HAVE_FIXTURE)(
  "raw-decode service e2e (real DNG → nf-raw → photo processPreview, macOS arm64)",
  () => {
    it("describe reports the nf-raw/libraw backend and bounds", async (ctx) => {
      skip(ctx);
      const info = await svc!.describe();
      expect(info.service).toBe("raw-decode");
      expect(info.backend).toContain("nf-raw");
      expect(info.bounds.max_input_bytes).toBe(64 * 1024 * 1024);
      expect(info.bounds.max_preview_pixels).toBe(1_048_576);
    });

    it("probe returns camera metadata for the fixture", async (ctx) => {
      skip(ctx);
      const info = await svc!.probe(rawBytes);
      expect(info.make.length).toBeGreaterThan(0);
      expect(info.width).toBeGreaterThan(0);
      expect(info.height).toBeGreaterThan(0);
    });

    // Debug-build LibRaw demosaic of the 20 MB fixture takes several
    // seconds; the timeout covers cold decoder init plus decode.
    it("decodePreview returns bounded straight-alpha RGBA8 within the processPreview budget", { timeout: 120_000 }, async (ctx) => {
      skip(ctx);
      const preview = await svc!.decodePreview(rawBytes);
      expect(preview.format).toBe("rgba8");
      expect(preview.width).toBeGreaterThan(0);
      expect(preview.height).toBeGreaterThan(0);
      expect(preview.width).toBeLessThanOrEqual(4096);
      expect(preview.height).toBeLessThanOrEqual(4096);
      expect(preview.width * preview.height).toBeLessThanOrEqual(1_048_576);
      expect(preview.rgba.byteLength).toBe(preview.width * preview.height * 4);
      // Straight alpha: every 4th byte is 255.
      for (let i = 3; i < preview.rgba.length; i += 4) {
        expect(preview.rgba[i]).toBe(255);
      }
      // Not a flat fill.
      const samples = new Set<number>();
      for (let i = 0; i < preview.rgba.length; i += 4 * 97) {
        samples.add((preview.rgba[i]! << 16) | (preview.rgba[i + 1]! << 8) | preview.rgba[i + 2]!);
      }
      expect(samples.size).toBeGreaterThan(16);
    });

    it("processDecodedPreview chains real decode into the engine and rejects stale recipes", { timeout: 180_000 }, async (ctx) => {
      skip(ctx);
      const sha256 = createHash("sha256").update(rawBytes).digest("hex");
      const added = (await doc!.addOriginal({
        sha256,
        asset_ref: "test:pentax-k7-dng",
        byte_length: rawBytes.byteLength,
        camera_make: "Pentax",
        camera_model: "K-7",
      })).data;
      // Identity develop: engine output must equal the decoded preview
      // pixels byte-for-byte — proving the decode crossed the boundary
      // intact rather than being re-encoded or approximated.
      const result = await processDecodedPreview(doc!, svc!, rawBytes, {
        version_id: added.version_id,
        original_id: added.original_id,
        original_sha256: sha256,
        expected_develop: IDENTITY_DEVELOP,
      });
      const preview = await svc!.decodePreview(rawBytes);
      expect(result.pixels.byteLength).toBe(preview.rgba.byteLength);
      expect(Buffer.from(result.pixels)).toEqual(Buffer.from(preview.rgba));
      expect(result.data.original_id).toBe(added.original_id);
      expect(result.data.version_id).toBe(added.version_id);
      // Stale identity: a recipe the version does not have must reject.
      await expect(
        doc!.processPreview(
          {
            version_id: added.version_id,
            original_id: added.original_id,
            original_sha256: sha256,
            expected_develop: { schema: 1, exposure_ev: 1, contrast: 1, rgb_gain: [1, 1, 1] },
            width: preview.width,
            height: preview.height,
            format: "rgba8-straight-srgb",
          },
          preview.rgba,
        ),
      ).rejects.toThrow();
    });
  },
);
