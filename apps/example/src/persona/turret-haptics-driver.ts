import { AndroidHaptics, ImpactFeedbackStyle, impactAsync, notificationAsync, NotificationFeedbackType, performAndroidHapticsAsync, selectionAsync } from 'expo-haptics';
import { Platform } from 'react-native';
import { createTurretHaptics, type AndroidHapticName, type HapticPort } from './turret-haptics';

const ANDROID: Readonly<Record<AndroidHapticName, AndroidHaptics>> = {
  'segment-tick': AndroidHaptics.Segment_Tick,
  'clock-tick': AndroidHaptics.Clock_Tick,
  reject: AndroidHaptics.Reject,
  'long-press': AndroidHaptics.Long_Press,
  confirm: AndroidHaptics.Confirm,
  'virtual-key': AndroidHaptics.Virtual_Key,
};

const expoHaptics: HapticPort = {
  selection: selectionAsync,
  impact: style => impactAsync(style === 'rigid' ? ImpactFeedbackStyle.Rigid : ImpactFeedbackStyle.Light),
  notification: () => notificationAsync(NotificationFeedbackType.Success),
  // performHapticFeedback on the current view: honours the Touch feedback setting.
  android: name => performAndroidHapticsAsync(ANDROID[name]),
};

/** PrismEditor `onPersonaEffect` for this host. */
export const playTurretHaptic = createTurretHaptics(expoHaptics, Platform.OS);
