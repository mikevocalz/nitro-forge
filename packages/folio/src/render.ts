import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { base64ToBytes, bytesToBase64 } from "@nitro-forge/ignition";

/**
 * TS adapter for the `folio-render` host service
 * (`rust/folio-render`, pdfium backend). This is NOT an engine: it is a
 * separate JSON-lines process fed serialized PDF bytes (e.g. the folio
 * engine's `save` output) that answers read-only render/text queries.
 * See docs/completion/reports/P15-folio-render-admission.md.
 *
 * Platform honesty: the Rust service is verified on macOS arm64 dev
 * hosts only. It additionally needs a pdfium shared library at run time
 * (`FOLIO_PDFIUM_LIBRARY` / `FOLIO_PDFIUM_DIR`, see
 * rust/folio-render/README.md). iOS/Android/WASM/Windows are NOT-RUN.
 */

/** One positioned text run from `textPage`. `bbox` is `[x, y, w, h]` in PDF user space (origin bottom-left, points). `font`/`size` come from the run's first character — pdfium merges same-line same-font runs into one segment. */
export interface FolioRenderTextItem {
  text: string;
  bbox: [number, number, number, number];
  font?: string;
  size?: number;
}

/** One search hit from `search`. `context` is the matched text (may span segments). */
export interface FolioRenderSearchHit {
  page: number;
  bbox: [number, number, number, number];
  context: string;
}

/** One link from `pageInfo`: `rect` is `[x, y, w, h]` PDF user space; exactly one of `uri`/`dest` may be present. */
export interface FolioRenderLink {
  rect: [number, number, number, number];
  uri?: string;
  dest?: { page: number };
}

export interface FolioRenderPageInfo {
  size: { width: number; height: number };
  rotate: number;
  links: FolioRenderLink[];
}

export interface FolioRenderOpenInfo {
  handle: number;
  pages: number;
  page_sizes: { width: number; height: number }[];
  encrypted: boolean;
}

export interface FolioRenderPageRequest {
  /** 0-based page index. */
  page: number;
  /** Linear scale factor (1.0 = 72 dpi). Mutually exclusive with `dpi`. */
  scale?: number;
  /** Render resolution in dpi (overridden by `scale` if both given — service prefers `scale`). */
  dpi?: number;
  /** Output encoding. Default `"png"`. */
  format?: "png" | "raw";
  /** Clamp each rendered side to at most this many px (service hard cap 4096). */
  max_dim?: number;
}

export interface FolioRenderPng {
  format: "png";
  width: number;
  height: number;
  /** PNG-encoded image bytes. */
  bytes: Uint8Array;
}

export interface FolioRenderRaw {
  format: "raw";
  width: number;
  height: number;
  /** Bytes per row. */
  stride: number;
  /** Unencoded RGBA8 pixels, row-major, `stride * height` bytes. */
  bytes: Uint8Array;
}

export type FolioRenderImage = FolioRenderPng | FolioRenderRaw;

interface FrameResponse {
  id: number;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; recoverable: boolean };
}

function requireData<T>(res: FrameResponse, op: string): T {
  if (!res.ok) {
    const e = res.error;
    throw new Error(`folio-render ${op} failed [${e?.code ?? "?"}]: ${e?.message ?? "unknown error"}`);
  }
  if (res.data === undefined || res.data === null) {
    throw new Error(`folio-render ${op} returned no data`);
  }
  return res.data as T;
}

/**
 * Spawns the `folio-render` binary and speaks its JSON-lines protocol.
 * Node-only transport (same model as `CliHost`); never bundled for RN.
 * The binary must be built (`cargo build -p folio-render`) and a pdfium
 * library must be resolvable — see rust/folio-render/README.md.
 */
export class FolioRenderService {
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
      this.killAll(
        new Error(`folio-render exited with code ${code}`),
      );
    });
  }

  /**
   * Locate and spawn the service binary. Resolution order:
   * `binPath` arg → `FOLIO_RENDER` env → `target/debug/folio-render`
   * (release builds set `NF_PROFILE=release` consumers should pass the
   * path explicitly or set the env var).
   */
  static connect(binPath?: string): FolioRenderService {
    const path =
      binPath ??
      process.env.FOLIO_RENDER ??
      fileURLToPath(new URL("../../../target/debug/folio-render", import.meta.url).href);
    if (!existsSync(path)) {
      throw new Error(
        `folio-render binary not found at ${path}; run \`cargo build -p folio-render\` or set FOLIO_RENDER`,
      );
    }
    const proc = spawn(path, [], { stdio: ["pipe", "pipe", "inherit"] });
    return new FolioRenderService(proc);
  }

  private call(op: string, payload?: unknown, handle = 0): Promise<FrameResponse> {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin!.write(
        JSON.stringify({ id, handle, op, payload: payload ?? {} }) + "\n",
      );
    });
  }

  private killAll(e: unknown) {
    if (this.dead) return;
    this.dead = e instanceof Error ? e : new Error(String(e));
    for (const p of this.pending.values()) p.reject(this.dead);
    this.pending.clear();
  }

  /** Open PDF bytes (e.g. `FolioDocument.savePdf().bytes`) for read queries. */
  async open(pdfBytes: Uint8Array, password?: string): Promise<FolioRenderOpenInfo> {
    const data = requireData<{
      handle: number;
      pages: number;
      page_sizes: { width: number; height: number }[];
      encrypted: boolean;
    }>(
      await this.call("open", {
        bytes_b64: bytesToBase64(pdfBytes),
        ...(password === undefined ? {} : { password }),
      }),
      "open",
    );
    return data;
  }

  /**
   * Render one page. `format:"png"` (default) returns PNG bytes;
   * `format:"raw"` returns unencoded RGBA8. The service clamps scale so
   * each side stays ≤4096 px and the decoded payload ≤32 MiB.
   */
  async renderPage(handle: number, req: FolioRenderPageRequest): Promise<FolioRenderImage> {
    const data = requireData<{
      format: "png" | "raw";
      width: number;
      height: number;
      stride?: number;
      bytes_b64: string;
    }>(
      await this.call(
        "renderPage",
        {
          page: req.page,
          ...(req.scale === undefined ? {} : { scale: req.scale }),
          ...(req.dpi === undefined ? {} : { dpi: req.dpi }),
          ...(req.format === undefined ? {} : { format: req.format }),
          ...(req.max_dim === undefined ? {} : { max_dim: req.max_dim }),
        },
        handle,
      ),
      "renderPage",
    );
    const bytes = base64ToBytes(data.bytes_b64);
    if (data.format === "raw") {
      if (data.stride === undefined) throw new Error("folio-render raw render missing stride");
      return { format: "raw", width: data.width, height: data.height, stride: data.stride, bytes };
    }
    return { format: "png", width: data.width, height: data.height, bytes };
  }

  /** Positioned text runs for one page (`textPage`). */
  async textPage(handle: number, page: number): Promise<FolioRenderTextItem[]> {
    const data = requireData<{ items: FolioRenderTextItem[] }>(
      await this.call("textPage", { page }, handle),
      "textPage",
    );
    return data.items;
  }

  /** Case-insensitive substring search; `pages` restricts the scan (default: all pages, in order). */
  async search(
    handle: number,
    query: string,
    pages?: readonly number[],
  ): Promise<{ hits: FolioRenderSearchHit[]; truncated: boolean }> {
    const data = requireData<{ hits: FolioRenderSearchHit[]; truncated: boolean }>(
      await this.call(
        "search",
        { query, ...(pages === undefined ? {} : { pages: [...pages] }) },
        handle,
      ),
      "search",
    );
    return data;
  }

  /** Page geometry, rotation and link annotations. */
  async pageInfo(handle: number, page: number): Promise<FolioRenderPageInfo> {
    return requireData<FolioRenderPageInfo>(
      await this.call("pageInfo", { page }, handle),
      "pageInfo",
    );
  }

  /** Close one document session. */
  async close(handle: number): Promise<boolean> {
    const data = requireData<{ closed: boolean }>(
      await this.call("close", {}, handle),
      "close",
    );
    return data.closed;
  }

  /** Terminate the service process and reject pending calls. */
  async dispose(): Promise<void> {
    this.killAll(new Error("folio-render disposed"));
    this.proc.kill();
  }
}
