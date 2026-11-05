import type { SystemOptions } from "react-native-audio-api";

/** The slice of Audio API's AudioManager that the capture session drives. */
export interface CaptureSessionPort {
  setSystemOptions(options: SystemOptions): void;
  setAudioSessionActivity(enabled: boolean): Promise<void>;
  observeAudioInterruptions(enabled: boolean): void;
}

/**
 * Session options while capturing. notifyOthersOnDeactivation is set here,
 * not at release: setSystemOptions fills every omitted iOS key with its
 * default, so setting it alone later would also reset the category.
 */
export const CAPTURE_SESSION_OPTIONS: SystemOptions = {
  ios: {
    category: "playAndRecord", mode: "default", options: ["defaultToSpeaker"],
    notifyOthersOnDeactivation: true,
  },
};

/** The category Forge previews play in. Restored only while a preview plays. */
export const PLAYBACK_SESSION_OPTIONS: SystemOptions = {
  ios: { category: "playback", mode: "default", options: [], notifyOthersOnDeactivation: true },
};

export function configureCaptureSession(port: CaptureSessionPort): void {
  port.setSystemOptions(CAPTURE_SESSION_OPTIONS);
  port.observeAudioInterruptions(true);
}

/**
 * Undo configureCaptureSession() after the recorder has stopped.
 *
 * With no app playback, the session is deactivated so other apps' audio
 * (music, a podcast) resumes; notifyOthersOnDeactivation tells them to.
 * While a Forge preview plays, the session stays active and goes back to the
 * playback category: deactivating it would cut the preview off, and iOS
 * refuses to deactivate a session with running I/O.
 *
 * The recorder must be stopped first. Audio API stops a recording that is
 * still running when the session is deactivated, and its file info then
 * arrives through consumeLastRecordingResult() instead of stop().
 */
export async function releaseCaptureSession(
  port: CaptureSessionPort,
  ownsPlayback: boolean,
): Promise<void> {
  port.observeAudioInterruptions(false);
  if (ownsPlayback) {
    port.setSystemOptions(PLAYBACK_SESSION_OPTIONS);
    return;
  }
  await port.setAudioSessionActivity(false);
}
