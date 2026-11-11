/**
 * File import/export for engine documents (roster A-30
 * FileImportExportSheet). A format is a pure description the sheet renders
 * plus an `export`/`import` function that talks to the engine. Formats only
 * appear when an engine op produces real bytes for them; the native
 * `.nfd` document (the NFD1 snapshot) is available for every engine.
 *
 * This module returns bytes, a MIME type and a file name. Writing the bytes
 * to Files, a share sheet or a browser download is the platform layer's job
 * (NYC-Tron platform-services documents, N-12).
 */
import type { DocumentHandle } from "./document";

/** A quality control the sheet shows for a format. */
export interface TransferQuality {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  readonly defaultValue: number;
}

export interface TransferFormat {
  readonly id: string;
  readonly label: string;
  /** Without the dot. */
  readonly extension: string;
  readonly mime: string;
  readonly quality?: TransferQuality;
  /**
   * Metadata fields this format writes. Empty for every format today: no
   * engine has a metadata op yet (see `TRANSFER_DEFERRED`).
   */
  readonly metadataFields: readonly string[];
}

export interface ExportRequest {
  readonly formatId: string;
  readonly filename: string;
  readonly quality?: number;
}

export interface ExportResult {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly filename: string;
}

export interface ExportFormat extends TransferFormat {
  run(doc: DocumentHandle, quality: number | undefined, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface ImportFormat extends TransferFormat {
  /** Replaces the document's content. Engine errors reject unchanged documents. */
  run(doc: DocumentHandle, bytes: Uint8Array): Promise<void>;
}

/** Things an export sheet could offer that no engine op produces yet. */
export const TRANSFER_DEFERRED = {
  // prism:png cleared 2026-11: the engine `encodePng` op returns real PNG
  // bytes (8-bit RGBA, bounded); registering a png ExportFormat in the
  // sheets remains host-side follow-up, not an engine gap.
  "splice:video": "video encoder backend choice",
  "pitch:pptx": "pitch has no export op",
  "metadata": "no engine has a title/author/metadata op",
} as const;

export class TransferError extends Error {
  constructor(
    readonly code: "unknown-format" | "invalid-filename" | "invalid-quality" | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "TransferError";
  }
}

/** The native document format: the engine's NFD1 snapshot, lossless. */
export const NFD_EXPORT: ExportFormat = {
  id: "nfd",
  label: "Forge document",
  extension: "nfd",
  mime: "application/vnd.nitro-forge.document",
  metadataFields: [],
  run: (doc) => doc.snapshot(),
};

export const NFD_IMPORT: ImportFormat = {
  id: "nfd",
  label: "Forge document",
  extension: "nfd",
  mime: "application/vnd.nitro-forge.document",
  metadataFields: [],
  run: (doc, bytes) => doc.restore(bytes),
};

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/;

/**
 * Validates a user-typed file name and makes sure it ends with the format's
 * extension. Returns the final name.
 */
export function normalizeFilename(name: string, format: TransferFormat): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new TransferError("invalid-filename", "file name is empty");
  if (FORBIDDEN.test(trimmed)) throw new TransferError("invalid-filename", "file name contains / \\ : * ? \" < > | or control characters");
  if (trimmed === "." || trimmed === "..") throw new TransferError("invalid-filename", "file name is reserved");
  const ext = `.${format.extension}`;
  const withExt = trimmed.toLowerCase().endsWith(ext) ? trimmed : `${trimmed}${ext}`;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(withExt)||/[. ]$/.test(withExt)||withExt.startsWith(".")||/[\u007f]/.test(withExt))throw new TransferError("invalid-filename","file name is reserved or invalid");
  if (withExt.length > 255) throw new TransferError("invalid-filename", "file name is longer than 255 characters");
  return withExt;
}

/** Runs one export. Validation happens before any engine call. */
export async function runExport(
  doc: DocumentHandle,
  formats: readonly ExportFormat[],
  request: ExportRequest,
  signal?: AbortSignal,
): Promise<ExportResult> {
  const format = formats.find((f) => f.id === request.formatId);
  if (!format) throw new TransferError("unknown-format", `unknown export format '${request.formatId}'`);
  const filename = normalizeFilename(request.filename, format);
  let quality: number | undefined;
  if (format.quality) {
    const q = request.quality ?? format.quality.defaultValue;
    const { min, max, step } = format.quality;
    const onStep = Math.abs((q - min) / step - Math.round((q - min) / step)) < 1e-9;
    if (!Number.isFinite(q) || q < min || q > max || !onStep) {
      throw new TransferError("invalid-quality", `${format.quality.label} must be ${min}..${max} in steps of ${step}`);
    }
    quality = q;
  } else if (request.quality !== undefined) {
    throw new TransferError("invalid-quality", `${format.label} has no quality setting`);
  }
  if (signal?.aborted) throw new TransferError("aborted", "export cancelled");
  const bytes = await format.run(doc, quality, signal);
  if (signal?.aborted) throw new TransferError("aborted", "export cancelled");
  return { bytes, mime: format.mime, filename };
}

/** Runs one import, matching the format by id. */
export async function runImport(
  doc: DocumentHandle,
  formats: readonly ImportFormat[],
  formatId: string,
  bytes: Uint8Array,
): Promise<void> {
  const format = formats.find((f) => f.id === formatId);
  if (!format) throw new TransferError("unknown-format", `unknown import format '${formatId}'`);
  await format.run(doc, bytes);
}

/** Picks an import format from a file name's extension. */
export function importFormatFor(name: string, formats: readonly ImportFormat[]): ImportFormat | undefined {
  const lower = name.toLowerCase();
  return formats.find((f) => lower.endsWith(`.${f.extension}`));
}

/** Strips the engine-specific `run` so the description can be passed to UI props. */
export function describeFormat(f: TransferFormat): TransferFormat {
  return {
    id: f.id,
    label: f.label,
    extension: f.extension,
    mime: f.mime,
    ...(f.quality ? { quality: f.quality } : {}),
    metadataFields: f.metadataFields,
  };
}
