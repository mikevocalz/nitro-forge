/**
 * Logitech Muse input from the existing Viro visionOS native bridge.
 *
 * Native GameController + ARKit tracking stays with the platform adapter,
 * not with a second Bluetooth implementation in Nitro-Forge.
 * No direct Muse compatibility is claimed on Android, Quest or PICO.
 */
/**
 * `hover-exit` ends the pen's presence over the surface: the host removes its
 * hover cursor. It follows `cancel` when tracking is lost mid-stroke and is
 * emitted once per presence, never with a position.
 */
export type SpatialPenPhase = "hover" | "down" | "move" | "up" | "cancel" | "hover-exit";
export type Vec3 = readonly [number, number, number];

/** Unit quaternion [x,y,z,w] in the same world space as the tip. */
export type Quaternion = readonly [number, number, number, number];

export interface MuseNativeSample {
  readonly tracked: boolean;
  /** World-space tip point in metres, relative to the Viro immersive session. */
  readonly position: Vec3 | null;
  readonly headPosition: Vec3 | null;
  /** Actual native aim orientation. Missing on older providers; never synthesized. */
  readonly orientation?: Quaternion | null;
  /** Native pose-read time in monotonic milliseconds, not sensor-to-photon latency. */
  readonly poseTimestampMs?: number;
  /** Actual tip force, separate from side buttons. Null means unavailable. */
  readonly tipPressure?: number | null;
  readonly tipPressed: boolean;
  readonly primaryPressed: boolean;
  readonly secondaryPressed: boolean;
  /** Raw normalized pressure, which may be invalid if the provider loses data. */
  readonly pressure: number;
}

export interface SpatialPenEvent extends MuseNativeSample {
  readonly device: "logitech-muse";
  readonly phase: SpatialPenPhase;
  /** Monotonic receive timestamp; must use the same clock as board pointer events. */
  readonly timestampMs: number;
  /** Valid actual input pressure, or undefined. We never synthesize it. */
  readonly normalizedPressure?: number;
}

export type SpatialStylusSubscribe = (
  callback: (sample: MuseNativeSample) => void,
) => (() => void);

export interface MuseSubscriptionOptions {
  /** Supply Viro's subscribeSpatialStylus from the visionOS-native build. */
  readonly subscribe: SpatialStylusSubscribe;
  readonly onEvent: (event: SpatialPenEvent) => void;
  readonly now?: () => number;
  /** Explicit XR-only option for side-button ray strokes. Defaults to false. */
  readonly sideButtonsDraw?: boolean;
}

const validPoint = (p: Vec3 | null): p is Vec3 =>
  Array.isArray(p) && p.length === 3 &&
  p.every((n) => typeof n === "number" && Number.isFinite(n));

function normalizedPressure(sample: MuseNativeSample): number | undefined {
  const pressure = "tipPressure" in sample ? sample.tipPressure : sample.pressure;
  return typeof pressure === "number" && Number.isFinite(pressure) &&
    pressure >= 0 && pressure <= 1 ? pressure : undefined;
}

/**
 * The single subscription owner for one pen input consumer. Consumers project
 * world points to the board using their existing surface input router.
 *
 * The adapter cancels an active stroke if tracking is lost, the tip disappears
 * or the subscriber is disposed, then emits `hover-exit` so a host hover
 * cursor never stays pinned to the last tracked point. Events emitted for an
 * invalid pose carry `position: null`. A pen that remains pressed after tracking
 * loss cannot silently resume the old stroke: it must be released before a new
 * down event. Side buttons remain available separately for tools/gestures.
 */
export function subscribeMuseSpatialInk(options: MuseSubscriptionOptions): () => void {
  const now = options.now ?? (() => performance.now());
  let drawing = false;
  /** True from the first valid pose until `hover-exit`. */
  let present = false;
  let blockedUntilRelease = false;
  let lastSample: MuseNativeSample | undefined;
  let disposed = false;
  let lastTimestamp = -Infinity;

  const emit = (phase: SpatialPenPhase, sample: MuseNativeSample): void => {
    const measured = now();
    const timestampMs = Number.isFinite(measured)
      ? Math.max(lastTimestamp, measured)
      : lastTimestamp === -Infinity ? 0 : lastTimestamp;
    lastTimestamp = timestampMs;
    const pressure = normalizedPressure(sample);
    options.onEvent({
      ...sample,
      ...(sample.orientation === undefined ? {} : {orientation: validOrientation(sample.orientation) ? sample.orientation : null}),
      device: "logitech-muse",
      phase,
      timestampMs,
      ...(pressure === undefined ? {} : { normalizedPressure: pressure }),
    });
  };

  const unsubscribe = options.subscribe((sample) => {
    if (disposed) return;
    lastSample = sample;
    const pressed = sample.tipPressed || (
      options.sideButtonsDraw === true &&
      (sample.primaryPressed || sample.secondaryPressed)
    );
    const valid = sample.tracked && validPoint(sample.position);

    if (!valid) {
      const lost: MuseNativeSample = { ...sample, tracked: false, position: null, orientation: null };
      const wasDrawing = drawing;
      const wasPresent = present;
      drawing = false;
      present = false;
      blockedUntilRelease = pressed;
      if (wasDrawing) emit("cancel", lost);
      if (wasPresent) emit("hover-exit", lost);
      return;
    }

    present = true;
    if (!pressed) {
      blockedUntilRelease = false;
      if (drawing) {
        drawing = false;
        emit("up", sample);
      } else {
        emit("hover", sample);
      }
      return;
    }
    if (blockedUntilRelease) {
      emit("hover", sample);
      return;
    }
    if (drawing) emit("move", sample);
    else {
      drawing = true;
      emit("down", sample);
    }
  });

  return () => {
    if (disposed) return;
    disposed = true;
    const wasDrawing = drawing;
    const wasPresent = present;
    drawing = false;
    present = false;
    try {
      if (lastSample !== undefined) {
        if (wasDrawing) emit("cancel", lastSample);
        if (wasPresent) emit("hover-exit", { ...lastSample, tracked: false, position: null, orientation: null });
      }
    } finally {
      drawing = false;
      present = false;
      unsubscribe();
    }
  };
}

/**
 * The existing Vision Pro Viro stream -> existing QuickDraw BoardInputRouter
 * compatibility boundary. Viro owns native GameController/ARKit; the board owns
 * projection, tool selection and the SINGLE editable document.
 *
 * Replace the old MusePenInput converter when adopting this adapter: do not
 * mount two subscriptions to one pen/board at the same time.
 */
export interface MuseBoardPointerSample extends MuseNativeSample {
  readonly phase: SpatialPenPhase;
  /** Actual normalized pressure, or NaN if native measurement is missing. */
  readonly pressure: number;
  readonly timestampMs: number;
  /** Deprecated legacy field required by existing Viro router consumers. */
  readonly timestamp: number;
}
export interface MuseBoardRouterTarget {
  handlePenSample(sample: MuseBoardPointerSample): void;
}
export interface MuseBoardBridgeOptions
  extends Pick<MuseSubscriptionOptions, "subscribe" | "now" | "sideButtonsDraw"> {
  readonly router: MuseBoardRouterTarget;
  readonly wallClock?: () => number;
}

/** Returns the ONE native stream unsubscribe, with deterministic cancellation. */
export function connectMuseToBoardRouter(options: MuseBoardBridgeOptions): () => void {
  const wallClock = options.wallClock ?? (() => Date.now());
  return subscribeMuseSpatialInk({
    subscribe: options.subscribe,
    ...(options.now ? { now: options.now } : {}),
    sideButtonsDraw: options.sideButtonsDraw ?? false,
    onEvent: (event) => {
      options.router.handlePenSample({
        tracked: event.tracked,
        position: event.position,
        headPosition: event.headPosition,
        ...(event.orientation === undefined ? {} : {orientation: event.orientation}),
        ...(event.poseTimestampMs === undefined ? {} : {poseTimestampMs: event.poseTimestampMs}),
        ...(event.tipPressure === undefined ? {} : {tipPressure: event.tipPressure}),
        tipPressed: event.tipPressed,
        primaryPressed: event.primaryPressed,
        secondaryPressed: event.secondaryPressed,
        phase: event.phase,
        pressure: event.normalizedPressure ?? Number.NaN,
        timestamp: wallClock(),
        timestampMs: event.timestampMs,
      });
    },
  });
}

/** Tracking and force diagnostics derived only from the received native sample. */
export interface MuseDiagnostics {
  readonly pose: 'untracked' | 'position-only' | 'six-dof';
  readonly position: Vec3 | null;
  readonly orientation: Quaternion | null;
  readonly pressure: number | null;
  readonly poseTimestampMs: number | null;
}

function validOrientation(value: Quaternion | null): value is Quaternion {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
    && Math.abs(Math.hypot(...value) - 1) <= 0.001;
}

/** Inspect provider capability without inventing orientation, pressure or native timing. */
export function getMuseDiagnostics(sample: MuseNativeSample): MuseDiagnostics {
  const tracked = sample.tracked && validPoint(sample.position);
  const orientation = tracked && sample.orientation && validOrientation(sample.orientation) ? sample.orientation : null;
  return {
    pose: !tracked ? 'untracked' : orientation ? 'six-dof' : 'position-only',
    position: tracked ? sample.position : null,
    orientation,
    pressure: normalizedPressure(sample) ?? null,
    poseTimestampMs: Number.isFinite(sample.poseTimestampMs) && sample.poseTimestampMs! >= 0 ? sample.poseTimestampMs! : null,
  };
}
