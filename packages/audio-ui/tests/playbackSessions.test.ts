import { describe, it, expect } from "vitest";
import { createPlaybackSession, type PlaybackSessionNative } from "@nyc-tron/platform-services/playback";
import { registerPlaybackSession, hasPlaybackIntent, whenPlaybackIdle } from "../src/playbackSessions";
import { configureCaptureSession, releaseCaptureSession, releasePreviewSession, type CaptureSessionPort } from "../src/captureSession";

function owner() {
  let deactivations = 0;
  const native: PlaybackSessionNative = {
    activate: () => true, deactivate: () => { deactivations++; },
    addListener: () => ({ remove() {} }),
  };
  const session = createPlaybackSession(native, { onAction() {} });
  const unregister = registerPlaybackSession(session);
  return { session, deactivations: () => deactivations, close() { session.setIntent("paused"); unregister(); session.dispose(); } };
}

describe("NYC-Tron preview ownership", () => {
  it("waits for every real session, including a suspended session, before releasing capture", async () => {
    const a = owner(), b = owner();
    try {
      a.session.setIntent("playing"); b.session.setIntent("playing");
      let idle = 0;
      whenPlaybackIdle(() => idle++);
      a.session.dispatch({ type: "interruption-began" });
      expect(hasPlaybackIntent()).toBe(true);
      b.session.setIntent("paused");
      expect(idle).toBe(0);
      a.session.dispatch({ type: "output-lost", reason: "headphones-unplugged" });
      await Promise.resolve();
      expect(idle).toBe(1);
      expect(hasPlaybackIntent()).toBe(false);
    } finally { a.close(); b.close(); }
  });

  it("runs a native stop action before notifying idle capture waiters", async () => {
    let graphStopped = false;
    const session = createPlaybackSession(null, { onAction: () => { graphStopped = true; } });
    const unregister = registerPlaybackSession(session);
    try {
      session.setIntent("playing");
      let stoppedAtRelease = false;
      whenPlaybackIdle(() => { stoppedAtRelease = graphStopped; });
      session.dispatch({ type: "output-lost", reason: "headphones-unplugged" });
      await Promise.resolve();
      expect(stoppedAtRelease).toBe(true);
    } finally { unregister(); session.dispose(); }
  });

  it("does not deactivate the OS session when a new recording or another preview owns it", async () => {
    const a = owner(), b = owner();
    const port: CaptureSessionPort = { setSystemOptions() {}, observeAudioInterruptions() {}, async setAudioSessionActivity() {} };
    try {
      b.session.setIntent("playing");
      await releasePreviewSession(a.session);
      expect(a.deactivations()).toBe(0);
      b.session.setIntent("paused");
      configureCaptureSession(port);
      try {
        await releasePreviewSession(a.session);
        expect(a.deactivations()).toBe(0);
      } finally { await releaseCaptureSession(port); }
      await releasePreviewSession(a.session);
      expect(a.deactivations()).toBe(1);
    } finally { a.close(); b.close(); }
  });
});
