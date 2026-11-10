/**
 * Companion-phone -> headset capture transfer.
 *
 * When the capture source is `companion_phone`, the phone seals its
 * observations and must not process until the headset acknowledges receipt —
 * the native CaptureSession enforces this via the `handoff` stage and
 * `transferAcknowledged()`. This module is the transport half: it packages
 * the captured sample files plus a manifest and uploads them to a
 * host-supplied endpoint, then interprets the HTTP response as the transfer
 * acknowledgement.
 *
 * It deliberately does NOT implement or imitate any proprietary sync
 * protocol — the endpoint, auth and payload format are ours to define.
 * The headset side (receiver + processing) is a separate host concern.
 */

export interface CaptureSampleRef {
  /** Opaque step id the sample was captured for. */
  stepId: string;
  /** Filesystem path of the captured photo (no file:// prefix). */
  filePath: string;
}

export interface TransferManifest {
  version: 1;
  /** Epoch the sealed bundle belongs to (from CaptureSession.generate()). */
  epoch: number;
  /** Capture source, always 'companion_phone' for this path. */
  source: 'companion_phone';
  /** Step ids covered by the bundle, in capture order. */
  steps: string[];
  /** Per-sample entries parallel to `steps`. */
  samples: { stepId: string; fileName: string }[];
  /** Appearance edits applied at review time, if any. */
  appearance?: {
    warmth: number;
    brightness: number;
    touchUp: boolean;
    backgroundFill: string;
  };
  createdAt: string;
}

export interface TransferResult {
  ok: boolean;
  /** HTTP status when a response was received. */
  status?: number;
  /** Host-provided acknowledgement token, if any. */
  acknowledgement?: string;
  error?: string;
}

/**
 * Build the transfer manifest. Pure — unit-testable.
 * `fileName` is the basename the receiver will store the sample under.
 */
export function buildTransferManifest(
  epoch: number,
  samples: readonly CaptureSampleRef[],
  appearance?: TransferManifest['appearance'],
  now: Date = new Date(),
): TransferManifest {
  return {
    version: 1,
    epoch,
    source: 'companion_phone',
    steps: samples.map((s) => s.stepId),
    samples: samples.map((s) => ({
      stepId: s.stepId,
      fileName: s.filePath.split('/').pop() ?? s.stepId,
    })),
    ...(appearance ? { appearance } : {}),
    createdAt: now.toISOString(),
  };
}

/**
 * Upload the sealed capture bundle to `endpoint` (an https URL owned by the
 * headset/companion host). Returns the acknowledgement token on HTTP 2xx.
 *
 * Uses multipart/form-data: one `manifest` JSON field plus one file part per
 * sample named `sample_<stepId>`. No proprietary protocol is implied.
 */
export async function uploadCaptureBundle(
  endpoint: string,
  manifest: TransferManifest,
  samples: readonly CaptureSampleRef[],
  token?: string,
): Promise<TransferResult> {
  const form = new FormData();
  form.append('manifest', JSON.stringify(manifest));
  for (const sample of samples) {
    // React Native FormData file part: { uri, name, type }.
    form.append(`sample_${sample.stepId}`, {
      uri: sample.filePath,
      name: manifest.samples.find((m) => m.stepId === sample.stepId)?.fileName
        ?? `${sample.stepId}.jpg`,
      type: 'image/jpeg',
    } as unknown as Blob);
  }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    let acknowledgement: string | undefined;
    try {
      const body = (await response.json()) as { acknowledgement?: string };
      acknowledgement = body.acknowledgement;
    } catch {
      acknowledgement = undefined;
    }
    return acknowledgement === undefined
      ? { ok: true, status: response.status }
      : { ok: true, status: response.status, acknowledgement };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
