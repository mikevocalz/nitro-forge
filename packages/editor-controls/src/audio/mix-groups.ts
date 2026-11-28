/**
 * Mix group summary for {@linkcode MixGroupBar}. The Cadence engine stores
 * one optional group name per track and applies group solo or mute to every
 * member as one undo step; this file only reads the committed channel list.
 * No React or engine imports.
 */
import type { MixerChannel } from "./mixer.ts";

/**
 * One mix group as {@linkcode mixGroups} reports it.
 * @see {@linkcode MixGroupBar}
 */
export interface MixGroup {
  /** Group name, as stored on each member's `group`. */
  readonly name: string;
  /** Member channel ids, in channel order. Never empty. */
  readonly memberIds: readonly MixerChannel["id"][];
  /** Every member is soloed. */
  readonly solo: boolean;
  /** Every member is muted. */
  readonly muted: boolean;
  /** Some members are soloed and some are not (solo shows as mixed). */
  readonly mixed: boolean;
  /** Some members are muted and some are not (mute shows as mixed). */
  readonly mutedMixed: boolean;
}

/**
 * Groups in the order their first member appears. Channels without a group
 * (absent or empty string) are skipped.
 */
export function mixGroups(
  channels: readonly Pick<MixerChannel, "id" | "group" | "solo" | "muted">[],
): MixGroup[] {
  const order: string[] = [];
  const members = new Map<string, Pick<MixerChannel, "id" | "solo" | "muted">[]>();
  for (const c of channels) {
    if (!c.group) continue;
    let list = members.get(c.group);
    if (list === undefined) {
      list = [];
      members.set(c.group, list);
      order.push(c.group);
    }
    list.push(c);
  }
  return order.map(name => {
    const list = members.get(name) ?? [];
    const soloCount = list.filter(c => c.solo).length;
    const muteCount = list.filter(c => c.muted).length;
    return {
      name,
      memberIds: list.map(c => c.id),
      solo: soloCount === list.length,
      muted: muteCount === list.length,
      mixed: soloCount > 0 && soloCount < list.length,
      mutedMixed: muteCount > 0 && muteCount < list.length,
    };
  });
}
