/** Quill formats for the file import/export sheet (A-30): .docx via `exportDocx`/`importDocx`. */
import {
  NFD_EXPORT,
  NFD_IMPORT,
  type ExportFormat,
  type ImportFormat,
} from "@nitro-forge/ignition/transfer";
import { base64ToBytes, bytesToBase64 } from "@nitro-forge/ignition";
import { OPS } from "./index";

const DOCX = {
  id: "docx",
  label: "Word document",
  extension: "docx",
  mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  metadataFields: [],
} as const;

export const QUILL_DOCX_EXPORT: ExportFormat = {
  ...DOCX,
  async run(doc) {
    return base64ToBytes((await doc.apply<{ bytes_b64: string }>(OPS.exportDocx)).data.bytes_b64);
  },
};

export const QUILL_DOCX_IMPORT: ImportFormat = {
  ...DOCX,
  async run(doc, bytes) {
    await doc.apply(OPS.importDocx, { bytes_b64: bytesToBase64(bytes) });
  },
};

export const QUILL_EXPORT_FORMATS: readonly ExportFormat[] = [QUILL_DOCX_EXPORT, NFD_EXPORT];
export const QUILL_IMPORT_FORMATS: readonly ImportFormat[] = [QUILL_DOCX_IMPORT, NFD_IMPORT];
