/** Folio formats for the file import/export sheet (A-30): real PDF bytes via `save`/`open`. */
import {
  NFD_EXPORT,
  NFD_IMPORT,
  type ExportFormat,
  type ImportFormat,
} from "@nitro-forge/ignition/transfer";
import { base64ToBytes, bytesToBase64 } from "@nitro-forge/ignition";
import { OPS } from "./index";

const PDF = { id: "pdf", label: "PDF", extension: "pdf", mime: "application/pdf", metadataFields: [] } as const;

export const FOLIO_PDF_EXPORT: ExportFormat = {
  ...PDF,
  async run(doc) {
    return base64ToBytes((await doc.apply<{ bytes_b64: string }>(OPS.save)).data.bytes_b64);
  },
};

/** `open` replaces the document; a corrupt PDF rejects and leaves it unchanged. */
export const FOLIO_PDF_IMPORT: ImportFormat = {
  ...PDF,
  async run(doc, bytes) {
    await doc.apply(OPS.open, { bytes_b64: bytesToBase64(bytes) });
  },
};

export const FOLIO_EXPORT_FORMATS: readonly ExportFormat[] = [FOLIO_PDF_EXPORT, NFD_EXPORT];
export const FOLIO_IMPORT_FORMATS: readonly ImportFormat[] = [FOLIO_PDF_IMPORT, NFD_IMPORT];
