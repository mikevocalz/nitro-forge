import type { ForgeRecordingController } from "./recording";

export const SESSION_INTERRUPTED_MESSAGE =
  "Recording paused by the system. It continues when the interruption ends, or save what was recorded.";
export const INTERRUPTION_ENDED_MESSAGE =
  "The interruption ended without permission to resume. The partial take is kept; save it or record again.";
export const INPUT_LOST_MESSAGE =
  "Microphone disconnected. Recording paused so nothing is captured from another input; save what was recorded.";

/** Audio API's interruption event, as delivered to addSystemEventListener. */
export interface InterruptionEvent {
  readonly type: "began" | "ended";
  readonly shouldResume: boolean;
}

/** Native work the handler needs from the recorder host. */
export interface CaptureInterruptionPort {
  /** Close the WAV file; resolves once it is finalized. */
  finalize(): Promise<unknown>;
  /** Ids of the inputs the platform can currently record from. */
  availableInputIds(): Promise<readonly string[]>;
}

/**
 * Applies OS session interruptions and route changes to one take.
 *
 * - Interruption began: pause with the file open ("session").
 * - Interruption ended with shouldResume: resume into the same file.
 * - Interruption ended without it: finalize the partial take and leave it
 *   saveable ("ended").
 * - OldDeviceUnavailable that removed an input the take could record from:
 *   pause with the file open ("input-lost"). A removed output-only device
 *   (headphones without a mic) does not pause the take.
 */
export class CaptureInterruptions {
  private inputsAtStart: ReadonlySet<string> | null = null;

  constructor(
    private readonly controller: ForgeRecordingController,
    private readonly port: CaptureInterruptionPort,
  ) {}

  /** Record the inputs present when the take started. */
  async snapshotInputs(): Promise<void> {
    try {
      this.inputsAtStart = new Set(await this.port.availableInputIds());
    } catch {
      // Unknown inputs: any later device removal pauses the take.
      this.inputsAtStart = null;
    }
  }

  async onInterruption(event: InterruptionEvent): Promise<void> {
    const phase = this.controller.store.getState().phase;
    if (event.type === "began") {
      if (phase.kind === "recording") {
        await this.controller.pauseForInterruption("session", SESSION_INTERRUPTED_MESSAGE);
      }
      return;
    }
    if (phase.kind !== "interrupted" || phase.cause !== "session") return;
    if (event.shouldResume && await this.controller.resumeAfterInterruption()) return;
    // A failed resume already moved the take to "error"; nothing to finalize.
    const after = this.controller.store.getState().phase;
    if (after.kind !== "interrupted" || after.cause !== "session") return;
    await this.finalize(INTERRUPTION_ENDED_MESSAGE);
  }

  async onRouteChange(reason: string): Promise<void> {
    if (reason !== "OldDeviceUnavailable") return;
    if (this.controller.store.getState().phase.kind !== "recording") return;
    if (!(await this.lostAnInput())) return;
    await this.controller.pauseForInterruption("input-lost", INPUT_LOST_MESSAGE);
  }

  /** Move the take to "ended" and close its file; a failure aborts the take. */
  async finalize(message: string): Promise<void> {
    this.controller.reportInterrupted(message);
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
