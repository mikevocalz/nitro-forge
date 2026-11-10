/**
 * Guided-capture step plan for the phone-hosted persona flow, mirroring the
 * observed reference lifecycle (front coverage, head turns, prompted
 * expressions with optional skips). Step ids are opaque to the native
 * session; the host decides which are skippable.
 */
export const CAPTURE_SOURCE = 'local_device' as const;

export interface CaptureStepDef {
  id: string;
  label: string;
  /** User-facing instruction shown while this step is current. */
  prompt: string;
  skippable: boolean;
}

export const CAPTURE_STEPS: readonly CaptureStepDef[] = [
  { id: 'front', label: 'Front', prompt: 'Look straight at the camera', skippable: false },
  { id: 'turn_left', label: 'Left turn', prompt: 'Slowly turn your head left', skippable: false },
  { id: 'turn_right', label: 'Right turn', prompt: 'Slowly turn your head right', skippable: false },
  { id: 'smile_closed', label: 'Smile', prompt: 'Smile with your mouth closed', skippable: true },
  { id: 'smile_teeth', label: 'Teeth smile', prompt: 'Smile showing your teeth', skippable: true },
  { id: 'brow_raise', label: 'Raised brows', prompt: 'Raise your eyebrows', skippable: true },
  { id: 'eyes_closed', label: 'Eyes closed', prompt: 'Close your eyes gently', skippable: true },
] as const;

export const CAPTURE_STEP_IDS = CAPTURE_STEPS.map((s) => s.id);
export const CAPTURE_STEP_SKIPPABLE = CAPTURE_STEPS.map((s) => s.skippable);
