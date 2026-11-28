import { useRef } from "react";
import { Platform } from "react-native";
import { Host } from "@expo/ui";
import { Slider as SwiftUISlider } from "@expo/ui/swift-ui";
import { disabled as swiftUIDisabled } from "@expo/ui/swift-ui/modifiers";
import { Slider as ComposeSlider } from "@expo/ui/jetpack-compose";
import { SeekBarLayout, useSeekBarModel } from "./NativeSeekBar.shared.tsx";
import type { NativeSeekBarProps } from "./NativeSeekBar.types.ts";

export type { NativeSeekBarBaseProps, NativeSeekBarCommitProps, NativeSeekBarProps } from "./NativeSeekBar.types.ts";

/**
 * Frame-accurate seek bar on the OS slider: SwiftUI `Slider` on iOS, Material 3
 * `Slider` on Android, both from `@expo/ui`. Dragging previews through
 * `onPreview`; the seek commits once through `onCommit` when the OS reports
 * the drag ended (`onEditingChanged(false)` on iOS, `onValueChangeFinished` on
 * Android). The step buttons commit once per press.
 *
 * On iOS a value change outside a drag, such as a VoiceOver increment,
 * commits on its own. Android's TalkBack and keyboard steps already end with
 * `onValueChangeFinished`.
 *
 * Requires @expo/ui native APIs on a verified Expo SDK 58 host. Not a WinUI,
 * Spark SDK 55, audio decoder or Forge engine adapter.
 */
export function NativeSeekBar(props: NativeSeekBarProps) {
  const { model, shown, step } = useSeekBarModel(props);
  // Whether SwiftUI reported a drag in progress. Kept out of render state:
  // it only routes the next value change.
  const editing = useRef(false);
  const slider = Platform.OS === "android"
    ? <ComposeSlider value={model.position} min={0} max={1} enabled={!model.off}
        onValueChange={model.move} onValueChangeFinished={() => model.release()} />
    : <SwiftUISlider value={model.position} min={0} max={1}
        modifiers={model.off ? [swiftUIDisabled(true)] : []}
        onEditingChanged={isEditing => {
          editing.current = isEditing;
          if (!isEditing) model.release();
        }}
        onValueChange={value => {
          model.move(value);
          if (!editing.current) model.release();
        }} />;
  // Only the slider is an @expo/ui host; the transport is app-token RN.
  return <SeekBarLayout props={props} shown={shown} step={step} off={model.off}
    slider={<Host key={model.key} style={{ width: "100%" }}>{slider}</Host>} />;
}
