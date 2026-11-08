/**
 * Tally formats for the file export sheet (A-30). CSV holds the active
 * sheet's computed values (RFC 4180 quoting), read through `getRange` in
 * row bands that stay under the engine's 16,384-cell cap — the engine's
 * bounded `exportCsv` op covers the same ground for in-cap ranges, but
 * the banded path still serves sheets larger than one op's cap.
 */
import { NFD_EXPORT, NFD_IMPORT, type ExportFormat, type ImportFormat } from "@nitro-forge/ignition/transfer";
import { base64ToBytes, bytesToBase64, type DocumentHandle } from "@nitro-forge/ignition";
import { OPS } from "./index";

const MAX_CELLS = 16_384;

interface WorkbookShape {
  sheets: { name: string; cells: Record<string, { raw: string }> }[];
  active: number;
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function colName(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Used rectangle of a cell map as 1-based {cols, rows}; zero when empty. */
export function usedBounds(cells: Record<string, unknown>): { cols: number; rows: number } {
  let cols = 0;
  let rows = 0;
  for (const addr of Object.keys(cells)) {
    const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(addr);
    if (!m?.[1] || !m[2]) continue;
    cols = Math.max(cols, colIndex(m[1]));
    rows = Math.max(rows, Number(m[2]));
  }
  return { cols, rows };
}

export function csvField(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function activeSheetCsv(doc: DocumentHandle): Promise<string> {
  const wb = (await doc.apply<WorkbookShape>(OPS.describe)).data;
  const sheet = wb.sheets[wb.active];
  const { cols, rows } = usedBounds(sheet?.cells ?? {});
  if (cols === 0) return "";
  const band = Math.max(1, Math.floor(MAX_CELLS / cols));
  const lines: string[] = [];
  for (let top = 1; top <= rows; top += band) {
    const bottom = Math.min(rows, top + band - 1);
    const r = await doc.apply<{ cells: { computed: unknown }[][] }>(OPS.getRange, {
      from: `A${top}`,
      to: `${colName(cols)}${bottom}`,
    });
    for (const row of r.data.cells) lines.push(row.map((c) => csvField(c.computed)).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export const TALLY_CSV_EXPORT: ExportFormat = {
  id: "csv",
  label: "CSV (active sheet, values)",
  extension: "csv",
  mime: "text/csv",
  metadataFields: [],
  async run(doc) {
    return new TextEncoder().encode(await activeSheetCsv(doc));
  },
};

/**
 * CSV/TSV import through the engine's `importCsv`/`importTsv` ops (slice
 * 10): the file text goes into the op payload — engines are I/O-free —
 * and lands on the active sheet at A1. The op is UTF-8 text, so the bytes
 * are decoded strictly; non-UTF-8 sources are a host-side decode concern
 * (the import wizard's encoding setting).
 */
function delimitedImport(id: string, label: string, extension: string, mime: string, op: "importCsv" | "importTsv"): ImportFormat {
  return {
    id,
    label,
    extension,
    mime,
    metadataFields: [],
    async run(doc, bytes) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      await doc.apply(op, { text });
    },
  };
}

export const TALLY_CSV_IMPORT = delimitedImport("csv", "CSV (active sheet at A1)", "csv", "text/csv", "importCsv");
export const TALLY_TSV_IMPORT = delimitedImport("tsv", "TSV (active sheet at A1)", "tsv", "text/tab-separated-values", "importTsv");

/**
 * `.xlsx` workbook transfer (slice 10): `exportXlsx` returns the whole
 * workbook's archive bytes; `importXlsx` replaces the whole workbook —
 * see docs/ENGINE_OPS.md § tally for the admitted subset (values,
 * formulas, merges, bold/italic/fill/border formats on export; styles,
 * defined names and other parts ignored on import).
 */
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const TALLY_XLSX_EXPORT: ExportFormat = {
  id: "xlsx",
  label: "Excel workbook",
  extension: "xlsx",
  mime: XLSX_MIME,
  metadataFields: [],
  async run(doc) {
    return base64ToBytes((await doc.apply<{ bytes_b64: string }>(OPS.exportXlsx, {})).data.bytes_b64);
  },
};

export const TALLY_XLSX_IMPORT: ImportFormat = {
  id: "xlsx",
  label: "Excel workbook (replaces workbook)",
  extension: "xlsx",
  mime: XLSX_MIME,
  metadataFields: [],
  async run(doc, bytes) {
    await doc.apply(OPS.importXlsx, { bytes_b64: bytesToBase64(bytes) });
  },
};

export const TALLY_EXPORT_FORMATS: readonly ExportFormat[] = [TALLY_CSV_EXPORT, TALLY_XLSX_EXPORT, NFD_EXPORT];
export const TALLY_IMPORT_FORMATS: readonly ImportFormat[] = [TALLY_CSV_IMPORT, TALLY_TSV_IMPORT, TALLY_XLSX_IMPORT, NFD_IMPORT];
