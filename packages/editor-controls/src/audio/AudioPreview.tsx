import { ActivityIndicator, Text, View, type ViewProps } from "react-native";
import { Button } from "@nyc-tron/ui/components/Button";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { useStatusAnnouncement } from "@nyc-tron/ui/components/feedback/announce";
import { WaveformLane } from "../WaveformLane.tsx";
import type { WaveformPeak } from "../waveform.ts";
import { formatElapsed, spokenElapsed } from "./recording-model.ts";
import { presentPreview, type PreviewAction, type PreviewViewState } from "./preview-model.ts";

/** Props for {@linkcode AudioPreview}. */
export interface AudioPreviewProps extends Omit<ViewProps, "children"> {
  /** Player phase, mapped by the app from its own playback controller. */
  readonly state: PreviewViewState;
  readonly onPlay: () => void;
  readonly onStop: () => void;
  /** Retry after an error. @default onPlay */
  readonly onRetry?: () => void;
  /** Measured peaks of the clip; omit to hide the lane. */
  readonly peaks?: readonly WaveformPeak[];
  /** Seek while playing; makes the lane adjustable. */
  readonly onSeekNormalized?: (position: number) => void;
  readonly disabled?: boolean;
  /** @default 48 */
  readonly height?: number;
  className?: string;
  unstyled?: boolean;
}

/**
 * Controlled clip preview: status, position, play/stop and an optional
 * waveform. The app's player decodes and plays; this view only reflects it.
 */
export function AudioPreview({
  state, onPlay, onStop, onRetry, peaks, onSeekNormalized, disabled = false, height = 48,
  className, unstyled = false, testID, ...props
}: AudioPreviewProps) {
  const view = presentPreview(state);
  useStatusAnnouncement(view.status);
  const handlers: Record<PreviewAction, () => void> = { play: onPlay, stop: onStop, retry: onRetry ?? onPlay };
  const styled = !unstyled;
  const total = state.kind === "ready" || state.kind === "playing" ? state.durationMs : undefined;
  // Players can report a slightly negative position right after a seek.
  const at = state.kind === "playing" ? Math.max(0, state.positionMs) : 0;
  return <View
    {...props}
    {...(testID ? { testID } : {})}
    {...{ className: joinClasses("w-full gap-2", styled && "rounded-control border border-border bg-surface-raised p-3", className) }}
  >
    <View {...{ className: "flex-row items-center gap-2" }}>
      {view.isBusy ? <ActivityIndicator accessibilityElementsHidden importantForAccessibility="no" /> : null}
      <Text
        accessibilityLiveRegion="polite"
        {...{ className: joinClasses("flex-1", styled && "text-sm", styled && (view.isProblem ? "text-danger" : "text-text-muted")) }}
      >{view.status}</Text>
      {total !== undefined ? <Text
        accessibilityLabel={spokenElapsed(Math.min(at, total)) + " of " + spokenElapsed(total)}
        {...{ className: joinClasses(styled && "text-text") }}
        style={{ fontVariant: ["tabular-nums"] }}
      >{formatElapsed(Math.min(at, total)) + " / " + formatElapsed(total)}</Text> : null}
    </View>
    {peaks ? <WaveformLane
      peaks={peaks}
      height={height}
      accessibilityLabel="Clip waveform"
      {...(view.progress === undefined ? {} : { position: view.progress })}
      {...(onSeekNormalized && state.kind === "playing" ? { onSeekNormalized } : {})}
      {...(testID ? { testID: testID + "-waveform" } : {})}
    /> : null}
    {view.action ? <Button
      title={view.action.label}
      variant={view.isProblem || view.action.kind !== "play" ? "secondary" : "primary"}
      disabled={disabled}
      onPress={handlers[view.action.kind]}
      {...(testID ? { testID: testID + "-action" } : {})}
    /> : null}
  </View>;
}
