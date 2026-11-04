import { useRef } from "react";
import { View } from "react-native";
import { peaksToBars, resamplePeaks, type WaveformPeak } from "./waveform";

export interface WaveformLaneProps {
  readonly peaks: readonly WaveformPeak[];
  readonly height?: number;
  /** Caps expensive native view count until Skia v3 tile renderer is integrated. */
  readonly columns?: number;
  readonly foregroundColor?: string;
  readonly backgroundColor?: string;
  readonly onSeekNormalized?: (progress: number) => void;
  readonly testID?: string;
}

/**
 * Reusable native RN waveform tile across iOS, Android and web.
 * Renders a bounded min/max display summary, not fake audio.
 * Large multitrack sessions should select the existing Skia v3 Board renderer.
 */
export function WaveformLane({
  peaks,
  height = 64,
  columns = 96,
  foregroundColor = "#A78BFA",
  backgroundColor = "#191919",
  onSeekNormalized,
  testID,
}: WaveformLaneProps) {
  const width = useRef(0);
  if (!Number.isInteger(columns) || columns < 1 || columns > 128) {
    throw new RangeError("WaveformLane columns must be within 1..128");
  }
  const bars = peaksToBars(resamplePeaks(peaks, columns), height);
  return (
    <View
      testID={testID}
      accessibilityRole={onSeekNormalized ? "adjustable" : "image"}
      accessibilityLabel="Audio waveform"
      style={{
        height,
        width: "100%",
        backgroundColor,
        flexDirection: "row",
        overflow: "hidden",
      }}
      onLayout={(event) => {
        width.current = event.nativeEvent.layout.width;
      }}
      onStartShouldSetResponder={() => onSeekNormalized != null}
      onResponderRelease={(event) => {
        if (!onSeekNormalized || width.current <= 0) return;
        const normalized = event.nativeEvent.locationX / width.current;
        onSeekNormalized(Math.max(0, Math.min(1, normalized)));
      }}>
      {bars.map((bar, index) => (
        <View key={index} style={{ flex: 1, height }}>
          <View
            style={{
              alignSelf: "center",
              width: "76%",
              marginTop: bar.top,
              height: bar.height,
              backgroundColor: foregroundColor,
            }}
          />
        </View>
      ))}
    </View>
  );
}
