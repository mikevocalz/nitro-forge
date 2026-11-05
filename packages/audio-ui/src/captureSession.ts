import type { SystemOptions } from "react-native-audio-api";
import { whenPlaybackIdle } from "./playbackOwnership";

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

/** Takes between configure and release; a deferred deactivation skips while any is open. */
let openCaptures = 0;

export function configureCaptureSession(port: CaptureSessionPort): void {
  openCaptures++;
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
 * refuses to deactivate a session with running I/O. It is deactivated when
 * that preview ends, unless a new take has configured the session again.
 *
 * The recorder must be stopped first. Audio API stops a recording that is
 * still running when the session is deactivated, and its file info then
 * arrives through consumeLastRecordingResult() instead of stop().
 */
export async function releaseCaptureSession(
  port: CaptureSessionPort,
  ownsPlayback: boolean,
): Promise<void> {
  openCaptures = Math.max(0, openCaptures - 1);
  port.observeAudioInterruptions(false);
  if (!ownsPlayback) {
    await port.setAudioSessionActivity(false);
    return;
  }
  port.setSystemOptions(PLAYBACK_SESSION_OPTIONS);
  // Deactivate once the preview ends, unless a new take has the session.
  // Nothing on screen owns this failure, so it is logged rather than shown.
  whenPlaybackIdle(() => {
    if (openCaptures > 0) return;
    port.setAudioSessionActivity(false).catch((error: unknown) => {
      console.warn("[audio-ui] deactivating the audio session after preview failed", error);
    });
  });
}
