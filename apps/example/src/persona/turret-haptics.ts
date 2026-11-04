import type { PrismEditorProps } from '@nitro-forge/studio-workspace/prism';

/** The turret's host feedback events, as PrismEditor hands them out. */
export type TurretEffect = Parameters<NonNullable<PrismEditorProps['onPersonaEffect']>>[0];

/** Android View.performHapticFeedback constants exposed by expo-haptics
 * (`AndroidHaptics` values). These go through the view, so the system
 * "Touch feedback" setting applies; the Vibrator-based calls ignore it. */
export type AndroidHapticName = 'segment-tick' | 'clock-tick' | 'reject' | 'long-press' | 'confirm' | 'virtual-key';

/** What a platform should play for one turret effect. */
export type HapticCue =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'ios-selection' }>
  | Readonly<{ kind: 'ios-impact'; style: 'light' | 'rigid' }>
  | Readonly<{ kind: 'ios-notification'; type: 'success' }>
  /** `fallback` is a constant from API 1, played when `primary` is newer than the device. */
  | Readonly<{ kind: 'android'; primary: AndroidHapticName; fallback: AndroidHapticName | null }>;

export type HapticPlatform = 'ios' | 'android' | 'web' | 'windows' | 'macos' | 'native';

const NONE: HapticCue = { kind: 'none' };

/**
 * Detent is a selection tick, the end stop a firmer knock, commit a success
 * notification and cancel a light tick. iOS feedback generators already obey
 * Settings > Sounds & Haptics > System Haptics and Low Power Mode.
 */
export function turretHapticCue(effect: TurretEffect, platform: HapticPlatform): HapticCue {
  if (effect === 'none') return NONE;
  if (platform === 'ios') {
    switch (effect) {
      case 'detent': return { kind: 'ios-selection' };
      case 'end-stop': return { kind: 'ios-impact', style: 'rigid' };
      case 'commit': return { kind: 'ios-notification', type: 'success' };
      case 'cancel': return { kind: 'ios-impact', style: 'light' };
    }
  }
  if (platform === 'android') {
    switch (effect) {
      // SEGMENT_TICK is API 34, REJECT and CONFIRM are API 30.
      case 'detent': return { kind: 'android', primary: 'segment-tick', fallback: 'clock-tick' };
      case 'end-stop': return { kind: 'android', primary: 'reject', fallback: 'long-press' };
      case 'commit': return { kind: 'android', primary: 'confirm', fallback: 'virtual-key' };
      case 'cancel': return { kind: 'android', primary: 'clock-tick', fallback: null };
    }
  }
  return NONE;
}

/** The native calls a cue needs. The app binds these to expo-haptics. */
export type HapticPort = Readonly<{
  selection: () => Promise<void>;
  impact: (style: 'light' | 'rigid') => Promise<void>;
  notification: (type: 'success') => Promise<void>;
  android: (name: AndroidHapticName) => Promise<void>;
}>;

/**
 * Returns the `onPersonaEffect` handler. It never throws: the turret's
 * visuals and announcements carry every state, so a device without a haptic
 * engine loses nothing. An Android constant newer than the device rejects in
 * expo-haptics; the handler then plays the API 1 fallback once.
 */
export function createTurretHaptics(port: HapticPort, platform: HapticPlatform): (effect: TurretEffect) => void {
  return effect => {
    const cue = turretHapticCue(effect, platform);
    switch (cue.kind) {
      case 'none': return;
      case 'ios-selection': void port.selection().catch(() => undefined); return;
      case 'ios-impact': void port.impact(cue.style).catch(() => undefined); return;
      case 'ios-notification': void port.notification(cue.type).catch(() => undefined); return;
      case 'android': {
        const { fallback } = cue;
        void port.android(cue.primary).catch(() => fallback ? port.android(fallback) : undefined).catch(() => undefined);
        return;
      }
    }
  };
}
