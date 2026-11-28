import { useEffect, useRef, type ComponentRef } from "react";
import { View } from "react-native";
import { Host, Slider } from "@expo/ui";
import { SeekBarLayout, useSeekBarModel } from "./NativeSeekBar.shared.tsx";
import type { NativeSeekBarProps } from "./NativeSeekBar.types.ts";

export type { NativeSeekBarBaseProps, NativeSeekBarCommitProps, NativeSeekBarProps } from "./NativeSeekBar.types.ts";

/** The part of a DOM node this file uses; React Native Web Views are DOM nodes. */
type ChangeTarget = {
  addEventListener(type: "change", listener: (event: { target: unknown }) => void): void;
  removeEventListener(type: "change", listener: (event: { target: unknown }) => void): void;
};

/**
 * Web build of `NativeSeekBar` over the `@expo/ui` universal slider, an
 * `<input type="range">`. Its `input` events preview through `onPreview`.
 * The browser fires one DOM `change` when the pointer is released and one per
 * arrow-key step; that event commits through `onCommit`. `@expo/ui` does not
 * expose `change`, so the wrapper View listens for it as it bubbles.
 */
export function NativeSeekBar(props: NativeSeekBarProps) {
  const { model, shown, step } = useSeekBarModel(props);
  const host = useRef<ComponentRef<typeof View> | null>(null);
  useEffect(() => {
    // React Native Web renders a View as a DOM element.
    const node = host.current as unknown as ChangeTarget | null;
    if (!node) return;
    const onChange = (event: { target: unknown }) => {
      const value = (event.target as { value?: unknown } | null)?.value;
      if (typeof value === "string") model.release(Number.parseFloat(value));
    };
    node.addEventListener("change", onChange);
    return () => node.removeEventListener("change", onChange);
  }, [model.key]);
  return <SeekBarLayout props={props} shown={shown} step={step} off={model.off}
    slider={<View key={model.key} ref={host} style={{ width: "100%" }}>
      <Host style={{ width: "100%" }}>
        <Slider min={0} max={1} value={model.position} disabled={model.off} onValueChange={model.move} />
      </Host>
    </View>} />;
}
