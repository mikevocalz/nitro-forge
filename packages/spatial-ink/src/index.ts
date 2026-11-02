/**
 * Logitech Muse input from the existing Viro visionOS native bridge.
 *
 * Native GameController + ARKit tracking stays with the platform adapter,
 * not with a second Bluetooth implementation in Nitro-Forge.
 * No direct Muse compatibility is claimed on Android, Quest or PICO.
 */
export type SpatialPenPhase = "hover" | "down" | "move" | "up" | "cancel";
export type Vec3 = readonly [number, number, number];

export interface MuseNativeSample {
  readonly tracked: boolean;
  /** World-space tip point in metres, relative to the Viro immersive session. */
  readonly position: Vec3 | null;
  readonly headPosition: Vec3 | null;
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
  p !== null && p.length === 3 && p.every(Number.isFinite);

function normalizedPressure(sample: MuseNativeSample): number | undefined {
  return Number.isFinite(sample.pressure) &&
    sample.pressure >= 0 && sample.pressure <= 1
    ? sample.pressure : undefined;
}

/**
 * The single subscription owner for one pen input consumer. Consumers project
 * world points to the board using their existing surface input router.
 *
 * The adapter cancels an active stroke if tracking is lost, the tip disappears
 * or the subscriber is disposed. A pen that remains pressed after tracking
 * loss cannot silently resume the old stroke: it must be released before a new
 * down event. Side buttons remain available separately for tools/gestures.
 */
export function subscribeMuseSpatialInk(options: MuseSubscriptionOptions): () => void {
  const now = options.now ?? (() => performance.now());
  let drawing = false;
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
      if (drawing) emit("cancel", sample);
      drawing = false;
      if (pressed) blockedUntilRelease = true;
      else blockedUntilRelease = false;
      return;
    }

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
    try {
      if (drawing && lastSample !== undefined) emit("cancel", lastSample);
    } finally {
      drawing = false;
      unsubscribe();
    }
  };
}
