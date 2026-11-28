/**
 * Mixer state helpers for {@linkcode MixingConsole} and
 * {@linkcode SoloMuteButtons}. Pure; no React or engine imports.
 */

/** Engine id of a track or bus. */
type ChannelId = string | number;

/**
 * One post-fader send from a track to a bus, as the engine reports it.
 * @see {@linkcode MixerChannel.sends}
 */
export interface MixerSend {
  /** Id of the receiving bus channel. */
  readonly bus: ChannelId;
  /** Linear send level, 0 .. 1. */
  readonly level: number;
}

/** One channel as the engine reports it. All values are committed state. */
export interface MixerChannel {
  /** Stable engine id; also the React key. */
  readonly id: ChannelId;
  readonly name: string;
  /** Linear gain, 0 (silence) .. 1 (0 dB). */
  readonly gain: number;
  /**
   * -1 .. 1. Equal-power mono pan on a track; balance on a bus, where the
   * far side is attenuated and the near side kept.
   */
  readonly pan: number;
  readonly muted: boolean;
  readonly solo: boolean;
  /**
   * `"bus"` sums the tracks routed or sent to it and feeds the master.
   * @default "track"
   */
  readonly kind?: "track" | "bus";
  /** Mix group name. Group solo and mute act on every member at once. */
  readonly group?: string;
  /**
   * A solo-safe channel that is not muted keeps sounding while other
   * channels are soloed. @default false
   */
  readonly soloSafe?: boolean;
  /** Id of the bus this channel feeds; `null` or absent means the master. */
  readonly output?: ChannelId | null;
  /** Post-fader sends to buses. */
  readonly sends?: readonly MixerSend[];
}

/**
 * Why a channel is or is not heard. Solo takes precedence over mute, the
 * same rule as the Cadence engine's render.
 * @see {@linkcode audibility}
 */
export type Audibility =
  | "audible"
  | "muted"
  /** Silent because another track or bus is soloed. */
  | "silenced-by-solo";

/**
 * Fields {@linkcode audibility} reads. Only `muted` and `solo` are required,
 * so callers from before buses and solo-safe keep working.
 */
export type AudibilityInput = Pick<MixerChannel, "muted" | "solo">
  & Partial<Pick<MixerChannel, "id" | "kind" | "soloSafe" | "output" | "sends">>;

function feeds(source: AudibilityInput, busId: ChannelId | undefined): boolean {
  if (busId === undefined) return false;
  return source.output === busId || (source.sends ?? []).some(s => s.bus === busId);
}

/**
 * Audibility of each channel, in input order, mirroring the Cadence
 * engine's `audible()`:
 *
 * - With nothing soloed, every unmuted channel sounds.
 * - With any track or bus soloed, a track sounds when it is soloed, or
 *   solo-safe and unmuted, or routed or sent into a soloed bus; a bus sounds
 *   when it is soloed, or solo-safe and unmuted, or fed by a soloed channel.
 * - Solo beats mute: a soloed channel sounds even when muted.
 *
 * Ids are compared with `===`, so pass the same id type the engine uses.
 */
export function audibility(channels: readonly AudibilityInput[]): Audibility[] {
  const anySolo = channels.some(c => c.solo);
  return channels.map(c => {
    if (!anySolo) return c.muted ? "muted" : "audible";
    if (c.solo || (c.soloSafe === true && !c.muted)) return "audible";
    const heard = c.kind === "bus"
      ? channels.some(src => src.solo && feeds(src, c.id))
      : channels.some(bus => bus.kind === "bus" && bus.solo && feeds(c, bus.id));
    return heard ? "audible" : "silenced-by-solo";
  });
}

/** Extra facts {@linkcode describeAudibility} can speak. */
export interface AudibilityDetails {
  /** @default "track" */
  readonly kind?: "track" | "bus";
  /** @default false */
  readonly soloSafe?: boolean;
  /** Mix group name. */
  readonly group?: string;
}

/**
 * Spoken summary for a strip, e.g. `"Bass, muted"` or
 * `"Drum bus, bus, group Drums, soloed"`.
 */
export function describeAudibility(
  name: string, state: Audibility, solo: boolean, details: AudibilityDetails = {},
): string {
  const parts = [name];
  if (details.kind === "bus") parts.push("bus");
  if (details.group) parts.push("group " + details.group);
  if (solo) parts.push("soloed");
  if (details.soloSafe) parts.push("solo safe");
  if (state === "muted") parts.push("muted");
  if (state === "silenced-by-solo") parts.push("silent while another channel is soloed");
  return parts.join(", ");
}
