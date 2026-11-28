import {forgeHairlineRadius} from "../radius.ts";
import { View, type ViewProps } from "react-native";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { sparklineGeometry, type SparklineAxisMin, type SparklineKind, type SparklineMarkTone } from "./sparkline-model.ts";
import { tokens } from "../tokens.ts";

/**
 * An in-cell chart drawn with plain views, so it renders inside any grid cell
 * on every platform without a canvas. Fits `width` × `height` points.
 */
export interface SparklineProps extends Omit<ViewProps, "children"> {
  readonly values: readonly (number | undefined)[];
  readonly kind: SparklineKind;
  readonly width: number;
  readonly height: number;
  readonly axisMin?: SparklineAxisMin;
  readonly showHigh?: boolean;
  readonly showLow?: boolean;
  readonly showNegative?: boolean;
  /** Screen-reader summary. Defaults to a count with the low and high values. */
  readonly accessibilityLabel?: string;
  readonly unstyled?: boolean;
}

const fill: Record<SparklineMarkTone, string> = {
  normal: "bg-primary", negative: "bg-text-muted", high: "bg-success", low: "bg-accent",
};

export function Sparkline({
  values, kind, width, height, axisMin, showHigh, showLow, showNegative, accessibilityLabel, unstyled = false, style, ...props
}: SparklineProps) {
  const g = sparklineGeometry(values, { kind, width, height, axisMin, showHigh, showLow, showNegative });
  const label = accessibilityLabel ?? (g.valueCount === 0 ? "Sparkline, no values"
    : `Sparkline, ${g.valueCount} values, low ${values[g.lowIndex!]}, high ${values[g.highIndex!]}`);
  const cls = (tone: SparklineMarkTone) => (!unstyled ? fill[tone] : undefined);
  return <View {...props} role="img" accessibilityLabel={label} style={[{ width, height, overflow: "hidden" }, style]}>
    {kind === "winloss" ? <View aria-hidden {...{ className: !unstyled ? "bg-border" : undefined }}
      style={{ position: "absolute", left: 0, right: 0, top: height / 2, height: tokens.borderWidth.hairline }} /> : null}
    {g.bars.map(bar => <View key={bar.index} aria-hidden {...{ className: cls(bar.tone) }}
      style={{ position: "absolute", left: bar.left, top: bar.top, width: bar.width, height: bar.height, borderRadius: forgeHairlineRadius.tick }} />)}
    {g.segments.map((s, i) => <View key={i} aria-hidden {...{ className: cls("normal") }}
      style={{ position: "absolute", left: s.centerX - s.length / 2, top: s.centerY - tokens.borderWidth.hairline, width: s.length, height: tokens.spacing.off2,
        borderRadius: forgeHairlineRadius.tick, transform: [{ rotate: `${s.angleDeg}deg` }] }} />)}
    {g.markers.map(m => <View key={"m" + m.index} aria-hidden {...{ className: joinClasses(cls(m.tone)) }}
      style={{ position: "absolute", left: m.x - tokens.spacing.off3, top: m.y - tokens.spacing.off3, width: tokens.spacing.off6, height: tokens.spacing.off6, borderRadius: forgeHairlineRadius.tick }} />)}
  </View>;
}
