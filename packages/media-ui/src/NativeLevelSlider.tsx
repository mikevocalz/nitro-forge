import { Column, Host, Slider, Text } from "@expo/ui";

/** Stateless native gain/level control. Gain is linear [0,1], not decibels. */
export interface NativeLevelSliderProps {
  readonly value: number;
  readonly onValueChange: (nextValue: number) => void;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly testID?: string;
}

export function NativeLevelSlider({
  value,
  onValueChange,
  disabled = false,
  label = "Gain",
  testID,
}: NativeLevelSliderProps) {
  if (!Number.isFinite(value)) throw new RangeError("Gain must be finite");
  const gain = Math.max(0, Math.min(1, value));
  return (
    <Host style={{ width: "100%" }}>
      <Column>
        <Text>{label} {Math.round(gain * 100)}%</Text>
        <Slider
          value={gain}
          min={0}
          max={1}
          step={0.01}
          disabled={disabled}
          testID={testID}
          onValueChange={(next) => onValueChange(Math.max(0, Math.min(1, next)))}
        />
      </Column>
    </Host>
  );
}
