import { Column, Host, Slider, Text } from "@expo/ui";
import { View } from "react-native";
import { assertRgba, rgbaToHex, type RgbaColor } from "./color.js";

export interface NativeColorChannelsProps {
  /** Controlled RGBA display color; document-specific profiles stay in Rust. */
  readonly value: RgbaColor;
  readonly onValueChange: (color: RgbaColor) => void;
  readonly showAlpha?: boolean;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/**
 * Original cross-platform color-channel control: actual SwiftUI/Jetpack
 * Compose sliders through universal @expo/ui, web range fallback.
 * It does not pretend that sRGB handles HDR, CMYK or spot inks.
 */
export function NativeColorChannels({
  value,
  onValueChange,
  showAlpha = true,
  disabled = false,
  testID,
}: NativeColorChannelsProps) {
  assertRgba(value);
  const preview = rgbaToHex(value);
  const update = (channel: "r" | "g" | "b", next: number) => {
    const val = Math.round(Math.min(255, Math.max(0, next)));
    onValueChange({ ...value, [channel]: val });
  };

  return (
    <View testID={testID} style={{ width: "100%" }}>
      <View
        accessibilityLabel={`Selected color ${preview}`}
        style={{
          height: 32,
          width: "100%",
          borderRadius: 6,
          backgroundColor: preview,
        }}
      />
      <Host style={{ width: "100%" }}>
        <Column>
          <Text>{preview}</Text>
          <Text>{`Red ${value.r}`}</Text>
          <Slider value={value.r} min={0} max={255} step={1} disabled={disabled}
            testID={testID ? testID + "-red" : undefined}
            onValueChange={(next) => update("r", next)} />
          <Text>{`Green ${value.g}`}</Text>
          <Slider value={value.g} min={0} max={255} step={1} disabled={disabled}
            testID={testID ? testID + "-green" : undefined}
            onValueChange={(next) => update("g", next)} />
          <Text>{`Blue ${value.b}`}</Text>
          <Slider value={value.b} min={0} max={255} step={1} disabled={disabled}
            testID={testID ? testID + "-blue" : undefined}
            onValueChange={(next) => update("b", next)} />
          {showAlpha ? (
            <>
              <Text>{`Opacity ${Math.round(value.alpha * 100)}%`}</Text>
              <Slider value={value.alpha} min={0} max={1} step={0.01} disabled={disabled}
                testID={testID ? testID + "-alpha" : undefined}
                onValueChange={(next) => onValueChange({
                  ...value,
                  alpha: Math.min(1, Math.max(0, next)),
                })} />
            </>
          ) : null}
        </Column>
      </Host>
    </View>
  );
}
