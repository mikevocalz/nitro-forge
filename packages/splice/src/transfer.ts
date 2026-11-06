/**
 * Splice formats for the file export sheet (A-30). The engine produces an
 * ordered render plan, not encoded video, so the export is that plan as
 * JSON (an edit decision list an encoder consumes). Video export waits for
 * an encoder backend (`TRANSFER_DEFERRED["splice:video"]`).
 */
import { NFD_EXPORT, NFD_IMPORT, type ExportFormat, type ImportFormat } from "@nitro-forge/ignition/transfer";
import { OPS } from "./index";

export const SPLICE_PLAN_EXPORT: ExportFormat = {
  id: "render-plan",
  label: "Render plan (JSON edit list)",
  extension: "json",
  mime: "application/json",
  metadataFields: [],
  async run(doc) {
    const d = await doc.apply<{ fps: number }>(OPS.describe);
    const plan = await doc.apply<unknown>(OPS.renderPlan);
    const body = { format: "nitro-forge.render-plan", version: 1, fps: d.data.fps, plan: plan.data };
    return new TextEncoder().encode(JSON.stringify(body, null, 2) + "\n");
  },
};

export const SPLICE_EXPORT_FORMATS: readonly ExportFormat[] = [SPLICE_PLAN_EXPORT, NFD_EXPORT];
export const SPLICE_IMPORT_FORMATS: readonly ImportFormat[] = [NFD_IMPORT];
