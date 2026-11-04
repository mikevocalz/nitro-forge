/** Minimal Audio API graph port, injectable for lifecycle tests without a microphone. */
export interface PlaybackBuffer { readonly duration: number; readonly length: number; readonly numberOfChannels: number }
export interface PlaybackSource<B extends PlaybackBuffer = PlaybackBuffer> {
  buffer: B | null;
  onended: (() => void) | null | undefined;
  connect(destination: unknown): unknown;
  disconnect(): void;
  start(when?: number, offset?: number): void;
  stop(): void;
}
export interface PlaybackContext<B extends PlaybackBuffer = PlaybackBuffer> {
  readonly currentTime: number;
  readonly destination: unknown;
  decodeAudioData(uri: string): Promise<B>;
  createBufferSource(): PlaybackSource<B>;
  resume(): Promise<unknown>;
  close(): Promise<unknown>;
}
export type PlaybackPhase = "idle" | "loading" | "playing" | "stopped" | "error";
export interface PlaybackSnapshot { phase: PlaybackPhase; message: string; duration: number }

/** One owner, one context, one source; audio scheduling stays on the native graph. */
export class ForgeAudioPlayback<B extends PlaybackBuffer = PlaybackBuffer> {
  private context: PlaybackContext<B> | null = null;
  private source: PlaybackSource<B> | null = null;
  private generation = 0;
  private disposed = false;
  private readonly createContext: () => PlaybackContext<B>;
  private readonly report: (state: PlaybackSnapshot) => void;
  constructor(createContext: () => PlaybackContext<B>, report: (state: PlaybackSnapshot) => void) {
    this.createContext = createContext; this.report = report;
  }
  async play(uri: string, recordedDuration: number): Promise<void> {
    if (this.disposed) throw new Error("Playback has been disposed");
    this.stop();
    const generation = ++this.generation;
    try {
      // This audition slice intentionally bounds decoded memory, not a DAW streaming claim.
      if (!Number.isFinite(recordedDuration) || recordedDuration <= 0 || recordedDuration > 60) {
        throw new Error("Preview supports recordings up to 60 seconds; longer audio needs the streaming transport");
      }
      if (!/^(file:\/\/|blob:)/.test(uri)) throw new Error("Preview requires a saved local recording");
      const context = this.context ?? (this.context = this.createContext());
      this.report({ phase: "loading", message: "Decoding recorded audio", duration: 0 });
      // Invoke resume immediately from the user's press, before waiting for decode.
      const resumed = context.resume();
      const decoded = context.decodeAudioData(uri);
      const [, buffer] = await Promise.all([resumed, decoded]);
      if (this.disposed || generation !== this.generation) return;
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 60 ||
          buffer.length * buffer.numberOfChannels * 4 > 32 * 1024 * 1024) {
        throw new Error("Decoded preview exceeds the 60-second / 32 MiB audition limit");
      }
      const source = context.createBufferSource();
      this.source = source; source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (generation !== this.generation || this.disposed) return;
        this.releaseSource(false);
        this.report({ phase: "stopped", message: "Preview ended", duration: buffer.duration });
      };
      source.start(context.currentTime, 0);
      this.report({ phase: "playing", message: "Playing saved recording", duration: buffer.duration });
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        this.releaseSource(true);
        this.report({ phase: "error", message: error instanceof Error ? error.message : "Playback failed", duration: 0 });
      }
      throw error;
    }
  }
  stop(): void {
    ++this.generation; this.releaseSource(true);
    if (!this.disposed) this.report({ phase: "stopped", message: "Preview stopped", duration: 0 });
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true; this.stop();
    const context = this.context; this.context = null;
    await context?.close();
  }
  private releaseSource(stop: boolean): void {
    const source = this.source; this.source = null;
    if (!source) return;
    // A native teardown failure must not prevent the remaining cleanup or close.
    try { source.onended = null; } catch { /* Continue resource cleanup. */ }
    try { if (stop) source.stop(); } catch { /* Already stopped/invalidated. */ }
    try { source.disconnect(); } catch { /* Context may already be interrupted. */ }
    try { source.buffer = null; } catch { /* Source is already unreachable. */ }
  }
}
