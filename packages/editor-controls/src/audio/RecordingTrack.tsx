import { ActivityIndicator, Text, View, type ViewProps } from "react-native";
import { Button } from "@nyc-tron/ui/components/Button";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { useStatusAnnouncement } from "@nyc-tron/ui/components/feedback/announce";
import { WaveformLane } from "../WaveformLane.tsx";
import type { WaveformPeak } from "../waveform.ts";
import { LevelMeter } from "./LevelMeter.tsx";
import {
  formatElapsed, presentRecording, spokenElapsed, type RecordingAction, type RecordingViewState,
} from "./recording-model.ts";

/** Stopping or saving a live take stays available even when `disabled`. */
const keepsTake = (kind: RecordingAction) => kind === "stop" || kind === "save-interrupted";

/** Props for {@linkcode RecordingTrack}. */
export interface RecordingTrackProps extends Omit<ViewProps, "children"> {
  /** Recorder phase, mapped by the app from its own controller. */
  readonly state: RecordingViewState;
  /** Measured peaks: live history while recording, the saved take afterwards. */
  readonly peaks: readonly WaveformPeak[];
  /** Current linear input peak in [0, 1]. The meter shows only while recording. */
  readonly level?: number;
  /** Held input peak in [0, 1]. */
  readonly peakHold?: number;
  /** Track name shown above the status, e.g. "Vocals". */
  readonly title?: string;
  readonly onStart: () => void;
  readonly onStop: () => void;
  /** Save an interrupted take. @default onStop */
  readonly onSaveInterrupted?: () => void;
  /** Retry after an error, missing device or denied permission. @default onStart */
  readonly onRetry?: () => void;
  /** Open system settings after a permission denial. Hides "Ask again" when set. */
  readonly onOpenSettings?: () => void;
  /** Seek inside a saved take; makes the lane adjustable. */
  readonly onSeekNormalized?: (position: number) => void;
  /** Playhead in [0, 1] for a saved take. */
  readonly position?: number;
  /**
   * Blocks starting, retrying and opening Settings. "Stop and save" and
   * "Save what was recorded" stay enabled, so a take can never be trapped
   * recording.
   */
  readonly disabled?: boolean;
  /** @default 96 */
  readonly columns?: number;
  /** @default 72 */
  readonly height?: number;
  className?: string;
  unstyled?: boolean;
}

/**
 * Controlled recording lane: status, elapsed time, one primary action, an
 * input meter while recording and the measured waveform. It has no recorder;
 * the app passes state and peaks and handles the callbacks.
 */
export function RecordingTrack({
  state, peaks, level, peakHold, title, onStart, onStop, onSaveInterrupted, onRetry, onOpenSettings,
  onSeekNormalized, position, disabled = false, columns = 96, height = 72,
  className, unstyled = false, testID, ...props
}: RecordingTrackProps) {
  const view = presentRecording(state, onOpenSettings !== undefined);
  useStatusAnnouncement(view.status);
  const handlers: Record<RecordingAction, (() => void) | undefined> = {
    start: onStart,
    stop: onStop,
    "save-interrupted": onSaveInterrupted ?? onStop,
    retry: onRetry ?? onStart,
    "open-settings": onOpenSettings,
  };
  const styled = !unstyled;
  const recording = state.kind === "recording";
  const seekable = state.kind === "saved" ? onSeekNormalized : undefined;
  return <View
    {...props}
    {...(testID ? { testID } : {})}
    {...{ className: joinClasses("w-full gap-3", styled && "rounded-control border border-border bg-surface-raised p-3", className) }}
  >
    <View {...{ className: "flex-row items-center gap-3" }}>
      <View {...{ className: "flex-1 gap-1" }}>
        {title ? <Text accessibilityRole="header" {...{ className: joinClasses(styled && "font-semibold text-text") }}>{title}</Text> : null}
        <View {...{ className: "flex-row items-center gap-2" }}>
          {view.isBusy ? <ActivityIndicator accessibilityElementsHidden importantForAccessibility="no" /> : null}
          {/* Polite live region: changes once per phase, never per frame. */}
          <Text
            accessibilityLiveRegion="polite"
            {...{ className: joinClasses(styled && (view.isProblem ? "text-danger" : "text-text-muted"), styled && "text-sm") }}
          >{view.status}</Text>
        </View>
      </View>
      {view.durationMs !== undefined ? <Text
        accessibilityLabel={"Elapsed " + spokenElapsed(view.durationMs)}
        {...{ className: joinClasses(styled && "text-text font-semibold") }}
        style={{ fontVariant: ["tabular-nums"] }}
      >{formatElapsed(view.durationMs)}</Text> : null}
    </View>
    {recording && level !== undefined ? <LevelMeter
      level={level}
      {...(peakHold === undefined ? {} : { peakHold })}
      announce
      {...(testID ? { testID: testID + "-meter" } : {})}
    /> : null}
    <WaveformLane
      peaks={peaks}
      columns={Math.min(128, columns)}
      height={height}
      accessibilityLabel={recording ? "Live input waveform" : "Recorded waveform"}
      {...(seekable ? { onSeekNormalized: seekable } : {})}
      {...(position === undefined ? {} : { position })}
      {...(testID ? { testID: testID + "-waveform" } : {})}
    />
    {view.action ? <Button
      title={view.action.label}
      variant={view.action.kind === "stop" ? "danger" : view.isProblem ? "secondary" : "primary"}
      disabled={(disabled && !keepsTake(view.action.kind)) || handlers[view.action.kind] === undefined}
      onPress={handlers[view.action.kind]}
      {...(testID ? { testID: testID + "-action" } : {})}
    /> : null}
  </View>;
}
