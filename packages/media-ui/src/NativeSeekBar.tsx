import { Button, Column, Host, Row, Slider, Text } from "@expo/ui";
import { clampFrame, formatTimecode, type FrameRate } from "./timebase.js";

export interface NativeSeekBarProps {
  /** Integer frame index in the source timeline. The component is fully controlled. */
  readonly frame: number;
  /** Total accessible frames. 0 renders a disabled transport. */
  readonly durationFrames: number;
  readonly frameRate: FrameRate;
  /** Called with a clamped integer frame on every user seek, never a fractional time. */
  readonly onSeek: (frame: number) => void;
  readonly stepFrames?: number;
  readonly dropFrameTimecode?: boolean;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/**
 * Native SwiftUI/Jetpack Compose seek transport through universal @expo/ui;
 * web uses its accessible range implementation. No copy of playback state.
 *
 * This is a transport control, NOT a video decoder; the host must call its
 * actual player.seek() and update the controlled frame after a successful seek.
 */
export function NativeSeekBar({
  frame,
  durationFrames,
  frameRate,
  onSeek,
  stepFrames = 1,
  dropFrameTimecode = false,
  disabled = false,
  testID,
}: NativeSeekBarProps) {
  if (!Number.isSafeInteger(durationFrames) || durationFrames < 0 ||
      !Number.isSafeInteger(stepFrames) || stepFrames < 1) {
    throw new RangeError("durationFrames and stepFrames must be bounded positive integers");
  }
  const current = clampFrame(frame, durationFrames);
  const isDisabled = disabled || durationFrames === 0;
  const timecode = { dropFrame: dropFrameTimecode };
  const seek = (value: number) => {
    if (!isDisabled) onSeek(clampFrame(value, durationFrames));
  };

  return (
    <Host style={{ width: "100%" }}>
      <Column>
        <Slider
          value={current}
          onValueChange={seek}
          min={0}
          max={Math.max(1, durationFrames)}
          step={stepFrames}
          disabled={isDisabled}
          testID={testID}
        />
        <Row>
          <Button onPress={() => seek(current - stepFrames)} disabled={isDisabled} label={`−${stepFrames} frame`} />
          <Text>
            {`${formatTimecode(current, frameRate, timecode)} / ${formatTimecode(durationFrames, frameRate, timecode)}`}
          </Text>
          <Button onPress={() => seek(current + stepFrames)} disabled={isDisabled} label={`+${stepFrames} frame`} />
        </Row>
      </Column>
    </Host>
  );
}
