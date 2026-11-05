import type { ForgeRecordingController } from "./recording";

export const SESSION_INTERRUPTED_MESSAGE =
  "Recording paused by the system. It continues when the interruption ends, or save what was recorded.";
export const INTERRUPTION_ENDED_MESSAGE =
  "The interruption ended without permission to resume. The partial take is kept; save it or record again.";
export const INPUT_LOST_MESSAGE =
  "Microphone disconnected. Recording paused so nothing is captured from another input; save what was recorded.";
const KEPT = " The partial take is kept; save it or record again.";

/** Audio API's interruption event, as delivered to addSystemEventListener. */
export interface InterruptionEvent {
  readonly type: "began" | "ended";
  readonly shouldResume: boolean;
}

/** Native work the handler needs from the recorder host. */
export interface CaptureInterruptionPort {
  /**
   * Stop new audio reaching the file before it is finalized. On iOS the
   * engine restarts input after an interruption even when the app does not
   * resume, so a take that will not continue is paused first.
   */
  pauseCapture(): Promise<void>;
  /** Close the WAV file; resolves once it is finalized. */
  finalize(): Promise<unknown>;
  /** Ids of the inputs the platform can currently record from. */
  availableInputIds(): Promise<readonly string[]>;
}

/**
 * Applies OS session interruptions, route changes and lifecycle stops to one
 * take. Events run one at a time in arrival order, so an "ended" that lands
 * while "began" is still pausing is applied after the pause, not dropped.
 *
 * - Interruption began: pause with the file open ("session").
 * - Interruption ended with shouldResume: resume into the same file, then
 *   re-check the inputs (a headset unplugged during the interruption pauses
 *   the take as "input-lost").
 * - Interruption ended without it, or any failed pause/resume: finalize the
 *   partial take and leave it saveable ("ended").
 * - OldDeviceUnavailable that removed an input the take could record from:
 *   pause with the file open ("input-lost"). A removed output-only device
 *   (headphones without a mic) does not pause the take.
 */
export class CaptureInterruptions {
  private inputsAtStart: ReadonlySet<string> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly controller: ForgeRecordingController,
    private readonly port: CaptureInterruptionPort,
  ) {}

  /** Record the inputs present when the take started. */
  snapshotInputs(): Promise<void> {
    return this.enqueue(async () => {
      try {
        this.inputsAtStart = new Set(await this.port.availableInputIds());
      } catch {
        // Unknown inputs: any later device removal pauses the take.
        this.inputsAtStart = null;
      }
    });
  }

  onInterruption(event: InterruptionEvent): Promise<void> {
    return this.enqueue(async () => {
      const phase = this.phase();
      if (event.type === "began") {
        if (phase.kind !== "recording") return;
        const paused = await this.controller.pauseForInterruption("session", SESSION_INTERRUPTED_MESSAGE);
        if (paused.kind === "failed") await this.finalizeNow(paused.reason + "." + KEPT, false);
        return;
      }
      if (phase.kind !== "interrupted" || phase.cause !== "session") return;
      if (!event.shouldResume) {
        await this.finalizeNow(INTERRUPTION_ENDED_MESSAGE, true);
        return;
      }
      const resumed = await this.controller.resumeAfterInterruption();
      if (resumed.kind === "failed") {
        await this.finalizeNow(resumed.reason + "." + KEPT, true);
      } else if (resumed.kind === "done") {
        await this.pauseIfInputLost();
      }
    });
  }

  onRouteChange(reason: string): Promise<void> {
    return this.enqueue(async () => {
      if (reason !== "OldDeviceUnavailable") return;
      await this.pauseIfInputLost();
    });
  }

  /**
   * Capture ended for good (system stop, app in the background): move the
   * take to "ended" and close its file. A finalize failure aborts the take.
   */
  finalize(message: string): Promise<void> {
    return this.enqueue(() => this.finalizeNow(message, true));
  }

  private phase() {
    return this.controller.store.getState().phase;
  }

  private enqueue(step: () => Promise<void>): Promise<void> {
    const run = this.queue.then(step);
    // A failed step must not block the events behind it; each caller still
    // sees its own step's rejection.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async pauseIfInputLost(): Promise<void> {
    if (this.phase().kind !== "recording") return;
    if (!(await this.lostAnInput())) return;
    const paused = await this.controller.pauseForInterruption("input-lost", INPUT_LOST_MESSAGE);
    if (paused.kind === "failed") await this.finalizeNow(paused.reason + "." + KEPT, false);
  }

  private async finalizeNow(message: string, pauseFirst: boolean): Promise<void> {
    const phase = this.phase();
    if (phase.kind !== "recording" && phase.kind !== "interrupted") return;
    let note = "";
    if (pauseFirst) {
      try {
        await this.port.pauseCapture();
      } catch (error) {
        note = " A moment of audio after the interruption may be in the file (pausing failed: " +
          (error instanceof Error ? error.message : String(error)) + ").";
      }
    }
    this.controller.reportInterrupted(message + note);
    try {
      await this.port.finalize();
    } catch (error) {
      await this.controller.abort("Finalizing the interrupted recording failed: " +
        (error instanceof Error ? error.message : String(error)));
    }
  }

  private async lostAnInput(): Promise<boolean> {
    const before = this.inputsAtStart;
    if (!before) return true;
    let now: ReadonlySet<string>;
    try {
      now = new Set(await this.port.availableInputIds());
    } catch {
      return true;
    }
    for (const id of before) if (!now.has(id)) return true;
    return false;
  }
}
