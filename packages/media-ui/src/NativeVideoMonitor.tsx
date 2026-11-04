import { Text, View } from "react-native";
import type { StoreApi } from "zustand/vanilla";
import type { FrameRate } from "./timebase";
import type { VideoMonitorState } from "./videoMonitorState";
import { VIDEO_PLAYBACK_CAPABILITY } from "./videoCapability";

/** A native asset identifier or host-resolved URI. Does not load any media. */
export type ForgeVideoSource = string | number | { readonly uri: string };

export interface NativeVideoMonitorProps {
  readonly source: ForgeVideoSource;
  /** Reserved existing preview state; never mutated by an unavailable player. */
  readonly store: StoreApi<VideoMonitorState>;
  readonly frameRate?: FrameRate;
  readonly height?: number;
  readonly testID?: string;
  readonly autoplay?: boolean;
}

/**
 * Explicitly unavailable until the selected react-native-video adapter supports
 * the required Nitro v1 host. No fake frames, timer, fallback decoder, or controls.
 * Prop names remain stable; the source type is a minimal host descriptor, not
 * the previous backend-specific source/options API.
 */
export function NativeVideoMonitor({ height = 220, testID }: NativeVideoMonitorProps) {
  return (
    <View testID={testID} style={{ width: "100%", minHeight: height, padding: 16, gap: 12 }}>
      <Text accessibilityRole="header" style={{ color: "#FFFFFF", fontSize: 18 }}>
        Video playback unavailable
      </Text>
      <Text accessibilityRole="alert" style={{ color: "#CBCBDE" }}>
        {VIDEO_PLAYBACK_CAPABILITY.reason}
      </Text>
    </View>
  );
}
