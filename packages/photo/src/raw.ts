import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { base64ToBytes, bytesToBase64 } from "@nitro-forge/ignition";
import type { PhotoDocument, PhotoPreviewRequest, PhotoPreviewResult } from "./index";

/**
 * TS adapter for the `raw-decode` host service (`rust/raw-decode`),
 * the JSON-lines binary that exposes `nf_raw::probe` /
 * `nf_raw::decode_preview` (LibRaw 0.22.3, CDDL route) to hosts.
 * This is NOT an engine and NOT part of `PhotoDocument`: it is the
 * admitted host-side decode boundary from
 * docs/completion/reports/P10-raw-product-admission.md — the host asset
 * store owns original bytes (keyed by the catalog's `asset_ref`), this
 * service turns them into bounded RGBA8, and the pixels cross into the
 * engine only through `PhotoDocument.processPreview`, which re-validates
 * `original_id`/`original_sha256`/`expected_develop` so stale decodes
 * cannot publish.
 *
 * Platform honesty: the Rust service is verified on macOS arm64 dev
 * hosts only (same posture as `nf-raw`). iOS/Android/WASM/Windows are
 * NOT-RUN. The binary must be built (`cargo build -p raw-decode`) and
 * needs the LibRaw static lib at build time — see rust/nf-raw/README.md.
 */

/** Camera/container metadata from `nf_raw::probe`. `width`/`height` are raw (uncropped, unrotated) sensor pixels. */
export interface RawInfo {
  make: string;
  model: string;
  /** Coarse container class: `"dng"` or `"raw"`. */
  format: string;
  width: number;
  height: number;
}

/** Owned RGBA8 preview: packed straight-alpha sRGB, `width*height*4` bytes, alpha all 255 — the exact `processPreview` input contract. */
export interface RawPreview {
  width: number;
  height: number;
  format: "rgba8";
  rgba: Uint8Array;
  info: RawInfo;
}

export type RawJobState = "running" | "done" | "failed" | "cancelled";

export interface RawJobStatus {
  job: number;
  state: RawJobState;
  /** Present on terminal states. */
  kind?: "probe" | "decode";
  info?: RawInfo;
  /** Present on `state:"done"` decode jobs. */
  width?: number;
  height?: number;
  format?: "rgba8";
  bytes_b64?: string;
  /** Present on `state:"failed"`. */
  error?: { code: string; message: string; recoverable: boolean };
}

export interface RawDecodeDescribe {
  service: string;
  backend: string;
  version: string;
  platform: string;
  ops: string[];
  bounds: Record<string, number | string>;
}

interface FrameResponse {
  id: number;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; recoverable: boolean };
}

function requireData<T>(res: FrameResponse, op: string): T {
  if (!res.ok) {
    const e = res.error;
    throw new Error(`raw-decode ${op} failed [${e?.code ?? "?"}]: ${e?.message ?? "unknown error"}`);
  }
  if (res.data === undefined || res.data === null) {
    throw new Error(`raw-decode ${op} returned no data`);
  }
  return res.data as T;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Spawns the `raw-decode` binary and speaks its JSON-lines protocol.
 * Node-only transport (same model as `FolioRenderService`/`CliHost`);
 * never bundled for RN. Decode work runs on the service's single LibRaw
 * worker thread, so `jobStatus`/`cancelJob` are never blocked behind a
 * decode — matches the admission's cooperative-cancellation contract.
 */
export class RawDecodeService {
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: FrameResponse) => void; reject: (e: unknown) => void }>();
  private dead: Error | null = null;

  private constructor(proc: ChildProcess) {
    this.proc = proc;
    const decoder = new StringDecoder("utf8");
    let remainder = "";
    proc.stdout!.on("data", (chunk: Buffer) => {
      remainder += decoder.write(chunk);
      let nl: number;
      while ((nl = remainder.indexOf("\n")) >= 0) {
        const line = remainder.slice(0, nl);
        remainder = remainder.slice(nl + 1);
        if (!line.trim()) continue;
        let res: FrameResponse;
        try {
          res = JSON.parse(line) as FrameResponse;
        } catch (e) {
          this.killAll(e);
          return;
        }
        const p = this.pending.get(res.id);
        if (p) {
          this.pending.delete(res.id);
          p.resolve(res);
        }
      }
    });
    const onDead = (e: unknown) => this.killAll(e);
    proc.on("error", onDead);
    proc.stdin!.on("error", onDead);
    proc.on("exit", (code) => {
      this.killAll(new Error(`raw-decode exited with code ${code}`));
    });
  }

  /**
   * Locate and spawn the service binary. Resolution order:
   * `binPath` arg → `RAW_DECODE` env → `target/debug/raw-decode`
   * (release builds should pass the path explicitly or set the env var).
   */
  static connect(binPath?: string): RawDecodeService {
    const path =
      binPath ??
      process.env.RAW_DECODE ??
      fileURLToPath(new URL("../../../target/debug/raw-decode", import.meta.url).href);
    if (!existsSync(path)) {
      throw new Error(
        `raw-decode binary not found at ${path}; run \`cargo build -p raw-decode\` or set RAW_DECODE`,
      );
    }
    const proc = spawn(path, [], { stdio: ["pipe", "pipe", "inherit"] });
    return new RawDecodeService(proc);
  }

  private call(op: string, payload?: unknown): Promise<FrameResponse> {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin!.write(
        JSON.stringify({ id, handle: 0, op, payload: payload ?? {} }) + "\n",
      );
    });
  }

  private killAll(e: unknown) {
    if (this.dead) return;
    this.dead = e instanceof Error ? e : new Error(String(e));
    for (const p of this.pending.values()) p.reject(this.dead);
    this.pending.clear();
  }

  /** Service metadata, ops list and enforced bounds. */
  async describe(): Promise<RawDecodeDescribe> {
    return requireData<RawDecodeDescribe>(await this.call("describe"), "describe");
  }

  /** Enqueue a metadata probe; resolves with `RawInfo` once LibRaw's identify pass finishes. */
  async probe(bytes: Uint8Array): Promise<RawInfo> {
    const status = await this.waitJob(await this.startJob("probe", bytes));
    if (status.state !== "done" || status.info === undefined) {
      throw new Error(
        `raw-decode probe ${status.state}${status.error ? ` [${status.error.code}]: ${status.error.message}` : ""}`,
      );
    }
    return status.info;
  }

  /**
   * Enqueue a bounded RGBA8 decode and wait for it. `maxPixels` defaults
   * to the `processPreview` budget (1,048,576 px, ≤4096/side); output is
   * area-downscaled by nf-raw to fit — a preview, not a develop render.
   */
  async decodePreview(bytes: Uint8Array, maxPixels?: number): Promise<RawPreview> {
    const status = await this.waitJob(
      await this.startJob("decodePreview", bytes, maxPixels),
    );
    if (status.state !== "done" || status.bytes_b64 === undefined) {
      throw new Error(
        `raw-decode decodePreview ${status.state}${status.error ? ` [${status.error.code}]: ${status.error.message}` : ""}`,
      );
    }
    return {
      width: status.width!,
      height: status.height!,
      format: "rgba8",
      rgba: base64ToBytes(status.bytes_b64),
      info: status.info!,
    };
  }

  /** Enqueue a job without waiting; returns the service job id for `jobStatus`/`cancelJob`. */
  async startJob(op: "probe" | "decodePreview", bytes: Uint8Array, maxPixels?: number): Promise<number> {
    const data = requireData<{ job: number }>(
      await this.call(op, {
        bytes_b64: bytesToBase64(bytes),
        ...(maxPixels === undefined ? {} : { max_pixels: maxPixels }),
      }),
      op,
    );
    return data.job;
  }

  /** One-shot poll: `running` jobs stay live; terminal states consume the job server-side. */
  async jobStatus(job: number): Promise<RawJobStatus> {
    return requireData<RawJobStatus>(await this.call("jobStatus", { job }), "jobStatus");
  }

  /** Cooperative cancel via the LibRaw progress callback; the job slot is freed immediately. */
  async cancelJob(job: number): Promise<boolean> {
    const data = requireData<{ cancelled: boolean }>(
      await this.call("cancelJob", { job }),
      "cancelJob",
    );
    return data.cancelled;
  }

  /** Poll `jobStatus` until the job leaves `running`. Default interval 10 ms. */
  async waitJob(job: number, intervalMs = 10): Promise<RawJobStatus> {
    for (;;) {
      const status = await this.jobStatus(job);
      if (status.state !== "running") return status;
      await sleep(intervalMs);
    }
  }

  /** Terminate the service process and reject pending calls. */
  async dispose(): Promise<void> {
    this.killAll(new Error("raw-decode disposed"));
    this.proc.kill();
  }
}

/** Identity fields a caller supplies; width/height/format come from the decoded preview itself. */
export type DecodedPreviewRequest = Omit<PhotoPreviewRequest, "width" | "height" | "format">;

/**
 * The admitted pipeline chain, host-side: original bytes → nf-raw
 * `decode_preview` → `photo-engine` `processPreview`. The engine
 * re-validates `original_id`/`original_sha256`/`expected_develop`, so a
 * decode started before a recipe edit or original swap is rejected as
 * stale rather than publishing wrong pixels. `asset_ref` resolution and
 * byte retention stay with the host asset store — this helper takes the
 * bytes directly.
 */
export async function processDecodedPreview(
  doc: PhotoDocument,
  service: RawDecodeService,
  originalBytes: Uint8Array,
  request: DecodedPreviewRequest,
  opts?: { maxPixels?: number },
): Promise<PhotoPreviewResult> {
  const preview = await service.decodePreview(originalBytes, opts?.maxPixels);
  return doc.processPreview(
    {
      ...request,
      width: preview.width,
      height: preview.height,
      format: "rgba8-straight-srgb",
    },
    preview.rgba,
  );
}
