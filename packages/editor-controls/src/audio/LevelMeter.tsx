import {valueAccessibility} from "../value-a11y.ts";
import { useEffect, useRef } from "react";
import { View, type ViewProps } from "react-native";
import { announce as speak } from "@nyc-tron/ui/components/feedback/announce";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import {
  createMeterAnnouncer, METER_BAND_LABELS, meterBand, meterFill, type MeterBand,
} from "./level-meter.ts";

/** Props for {@linkcode LevelMeter}. */
export interface LevelMeterProps extends Omit<ViewProps, "children"> {
  /** Current linear input peak in [0, 1] from the app's audio engine. */
  readonly level: number;
  /** Held peak in [0, 1], drawn as a thin marker. */
  readonly peakHold?: number | undefined;
  /** @default "horizontal" */
  readonly orientation?: "horizontal" | "vertical";
  /** Thickness across the bar, in pt. @default 8 */
  readonly thickness?: number;
  /**
   * Speak band changes ("Input clipping") through the screen reader, at most
   * once per `announceIntervalMs`. Turn on only while a take is live.
   * @default false
   */
  readonly announce?: boolean;
  /** @default 2000 */
  readonly announceIntervalMs?: number;
  /** Spoken band text, for localization. @default METER_BAND_LABELS */
  readonly bandLabels?: Readonly<Record<MeterBand, string>>;
  className?: string;
  fillClassName?: string;
  /** Applied to the fill instead of `fillClassName` while clipping. */
  clipClassName?: string;
  unstyled?: boolean;
}

/**
 * Display-only input meter. The bar is a `progressbar` whose value text is a
 * coarse band, so a screen reader that focuses it hears "Input level good",
 * not a number that changes 30 times a second. With `announce`, band changes
 * are spoken at low priority and throttled; the bar itself is not a live
 * region, which would speak on every frame.
 */
export function LevelMeter({
  level, peakHold, orientation = "horizontal", thickness = 8, announce = false,
  announceIntervalMs = 2000, bandLabels = METER_BAND_LABELS,
  className, fillClassName, clipClassName, unstyled = false, style, ...props
}: LevelMeterProps) {
  const fill = meterFill(level);
  const band = meterBand(level);
  const hold = peakHold === undefined ? undefined : meterFill(peakHold);
  const announcer = useRef<ReturnType<typeof createMeterAnnouncer> | null>(null);
  const announcerKey = useRef("");
  const key = announceIntervalMs + "|" + JSON.stringify(bandLabels);
  if (announcer.current === null || announcerKey.current !== key) {
    announcer.current = createMeterAnnouncer({ minIntervalMs: announceIntervalMs, labels: bandLabels });
    announcerKey.current = key;
  }
  useEffect(() => {
    if (!announce) return;
    const text = announcer.current?.(level, Date.now());
    if (text) speak(text);
  }, [announce, level]);

  const vertical = orientation === "vertical";
  const extent = (fraction: number) => (fraction * 100).toFixed(1) + "%";
  const clipping = band === "clipping";
  return <View
    {...props}
    {...{ className: joinClasses("overflow-hidden", !unstyled && "rounded-full bg-surface-sunken", className) }}
    style={[vertical ? { width: thickness, height: "100%" } : { height: thickness, width: "100%" }, style]}
    accessible
    accessibilityRole="progressbar"
    accessibilityLabel={props.accessibilityLabel ?? "Input level"}
    {...valueAccessibility({ min: 0, max: 100, now: Math.round(fill * 100), text: bandLabels[band] })}
  >
    <View
      {...{ className: joinClasses(!unstyled && (clipping ? "bg-danger" : "bg-accent"),
        clipping ? clipClassName ?? fillClassName : fillClassName) }}
      style={vertical
        ? { position: "absolute", left: 0, right: 0, bottom: 0, height: extent(fill) }
        : { position: "absolute", top: 0, bottom: 0, left: 0, width: extent(fill) }}
    />
    {hold !== undefined && hold > 0 ? <View
      {...{ className: joinClasses(!unstyled && "bg-text") }}
      style={vertical
        // Pull the 2 pt marker back by up to its own width so a held peak at
        // full scale (clipping, the case that matters most) stays inside the
        // clipped track instead of being drawn past its end.
        ? { position: "absolute", left: 0, right: 0, height: 2, bottom: extent(hold), marginBottom: -2 * hold }
        : { position: "absolute", top: 0, bottom: 0, width: 2, left: extent(hold), marginLeft: -2 * hold }}
    /> : null}
  </View>;
}
