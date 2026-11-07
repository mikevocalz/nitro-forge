import { base64ToBytes, type DocumentHandle } from '@nitro-forge/ignition';
import { encodeRgbaPng, validatePreviewSize } from '@nitro-forge/studio-workspace/rgba-png';

/** Lossless 8-bit RGBA export within the existing portable encoder budget.
 * This does not embed an ICC profile or perform a color-space conversion. */
export async function exportPrismPng(document: DocumentHandle): Promise<Uint8Array> {
  const description = await document.apply<{ width: number; height: number }>('describe', {});
  validatePreviewSize(description.data.width, description.data.height);
  const result = await document.apply<{ width: number; height: number; pixels_b64: string }>('flatten', {});
  // Revalidate the actual result before allocation even if the host changed.
  validatePreviewSize(result.data.width, result.data.height);
  if (result.data.width !== description.data.width || result.data.height !== description.data.height)
    throw new Error('The canvas size changed during export. Retry the export.');
  if (typeof result.data.pixels_b64 !== 'string' || result.data.pixels_b64.length > Math.ceil(result.data.width * result.data.height * 4 / 3) * 4)
    throw new Error('The engine returned an invalid RGBA export.');
  return encodeRgbaPng(result.data.width, result.data.height, base64ToBytes(result.data.pixels_b64));
}
