import { useMemo, useRef } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Button, Column, Host, Row, Slider, Text } from "@expo/ui";
import {
  PanResponder,
  View,
  type GestureResponderEvent,
} from "react-native";
import { hsvToRgb, rgbaToHex, rgbToHsv, type HsvColor } from "./color";
import { assertHsv } from "./fieldGeometry";
import { createFieldGesture } from "./fieldGesture";
import { NativeColorChannels } from "./NativeColorChannels";

export interface NativeHsvPickerProps {
  /** One authoritative HSV color; keep it in the host's Zustand/Rust state. */
  readonly value: HsvColor;
  readonly onValueChange: (next: HsvColor) => void;
  /** Apply exactly once: the host owns the Rust undo/commit transaction. */
  readonly onApply?: (color: HsvColor) => void;
  readonly onCancel?: () => void;
  readonly fieldHeight?: number;
  readonly disabled?: boolean;
  readonly testID?: string;
}

const SPECTRUM = [
  "#FF0000", "#FFFF00", "#00FF00", "#00FFFF",
  "#0000FF", "#FF00FF", "#FF0000",
] as const;

export function NativeHsvPicker({
  value,
  onValueChange,
  onApply,
  onCancel,
  fieldHeight = 210,
  disabled = false,
  testID,
}: NativeHsvPickerProps) {
  assertHsv(value);
  if (!Number.isFinite(fieldHeight) || fieldHeight < 80 || fieldHeight > 1000) {
    throw new RangeError("fieldHeight must be in the range 80..1000 dp");
  }

  const refs = useRef({ value, onValueChange, disabled });
  refs.current = { value, onValueChange, disabled };
  // Width stays 0 until onLayout runs; the gesture ignores input until then.
  const dimensions = useRef({ width: 0, height: 0 });
  const panResponder = useMemo(() => {
    const gesture = createFieldGesture({
      getSize: () => dimensions.current,
      getValue: () => refs.current.value,
      getDisabled: () => refs.current.disabled,
      onChange: (next) => refs.current.onValueChange(next),
    });
    const point = (e: GestureResponderEvent) => ({
      x: e.nativeEvent.locationX,
      y: e.nativeEvent.locationY,
    });
    return PanResponder.create({
      onStartShouldSetPanResponder: gesture.shouldStart,
      onStartShouldSetPanResponderCapture: gesture.shouldStart,
      onMoveShouldSetPanResponder: gesture.shouldStart,
      onMoveShouldSetPanResponderCapture: gesture.shouldStart,
      onPanResponderGrant: (event) => gesture.grant(point(event)),
      onPanResponderMove: (event) => gesture.move(point(event)),
      // onApply is intentionally NOT called on release. A color dialog can
      // preview continuously, then commit a single Rust transaction.
      onPanResponderRelease: gesture.release,
      onPanResponderTerminate: gesture.terminate,
      // Refuse hand-off to a parent ScrollView while dragging, and ask the
      // native side (Android) not to intercept the touch stream.
      onPanResponderTerminationRequest: gesture.terminationRequest,
      onShouldBlockNativeResponder: () => true,
    });
  }, []);

  const rgb = hsvToRgb(value);
  const hueFill = rgbaToHex(hsvToRgb({ h: value.h, s: 1, v: 1, alpha: 1 }), false);
  const displayHex = rgbaToHex(rgb);
  return (
    <View style={{ width: "100%", gap: 10 }} {...(testID ? { testID } : {})}>
      <View
        {...panResponder.panHandlers}
        onLayout={(event) => {
          dimensions.current = {
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height,
          };
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Saturation and brightness"
        accessibilityValue={{ text: `Saturation ${Math.round(value.s * 100)} percent, brightness ${Math.round(value.v * 100)} percent` }}
        style={{
          width: "100%", height: fieldHeight,
          borderRadius: 9, overflow: "hidden",
          borderWidth: 1, borderColor: "#686868",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <LinearGradient
          pointerEvents="none"
          colors={["#FFFFFF", hueFill]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ position: "absolute", width: "100%", height: "100%" }}
        />
        <LinearGradient
          pointerEvents="none"
          colors={["transparent", "#000000"]}
          start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
          style={{ position: "absolute", width: "100%", height: "100%" }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: `${value.s * 100}%`,
            top: `${(1 - value.v) * 100}%`,
            transform: [{ translateX: -11 }, { translateY: -11 }],
            width: 22, height: 22,
            borderRadius: 11,
            borderColor: "#FFFFFF", borderWidth: 2,
            backgroundColor: displayHex,
          }}
        />
      </View>

      <LinearGradient
        colors={SPECTRUM}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ height: 12, borderRadius: 6 }}
        pointerEvents="none"
      />
      <Host style={{ width: "100%" }}>
        <Column spacing={5}>
          <Text>{`Hue ${Math.round(value.h)}°`}</Text>
          <Slider
            value={((value.h % 360) + 360) % 360}
            min={0} max={359} step={1}
            disabled={disabled}
            {...(testID ? { testID: testID + "-hue" } : {})}
            onValueChange={(h) => onValueChange({ ...value, h })}
          />
          <Text>{`Saturation ${Math.round(value.s * 100)}%`}</Text>
          <Slider value={value.s} min={0} max={1} step={0.01} disabled={disabled}
            {...(testID ? { testID: testID + "-saturation" } : {})}
            onValueChange={(s) => onValueChange({ ...value, s })}
          />
          <Text>{`Brightness ${Math.round(value.v * 100)}%`}</Text>
          <Slider value={value.v} min={0} max={1} step={0.01} disabled={disabled}
            {...(testID ? { testID: testID + "-brightness" } : {})}
            onValueChange={(v) => onValueChange({ ...value, v })}
          />
          <Text>{`Hex: ${displayHex}`}</Text>
        </Column>
      </Host>

      <NativeColorChannels
        value={rgb}
        disabled={disabled}
        {...(testID ? { testID: testID + "-channels" } : {})}
        onValueChange={(rgba) => onValueChange(rgbToHsv(rgba, value.h))}
      />

      {(onApply || onCancel) && (
        <Host style={{ width: "100%" }}>
          <Row spacing={10}>
            {onCancel && <Button
              label="Cancel" variant="outlined" disabled={disabled}
              onPress={onCancel}
            />}
            {onApply && <Button
              label="Apply color" disabled={disabled}
              onPress={() => onApply(value)}
            />}
          </Row>
        </Host>
      )}
    </View>
  );
}
