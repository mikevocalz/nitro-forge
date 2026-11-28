import { Text, View, type ViewProps } from "react-native";
import { Button } from "@nyc-tron/ui/components/Button";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import {rgbaToHex} from "../color.ts";
import { validateGamutReport, type GamutReport } from "./color-management.ts";
import { tokens } from "../tokens.ts";
export type { GamutReport } from "./color-management.ts";
/** Measured gamut information and optional host inspection action. */
export interface GamutWarningProps extends Omit<ViewProps, "children"> {
  /** null means measurement has not arrived, not that every color is in gamut. */
  readonly report: GamutReport | null;
  readonly onInspect?: () => void;
  readonly unstyled?: boolean;
}
/** Announces the actual measured sample count; no guessed gamut test or clipping. */
export function GamutWarning({ report, onInspect, unstyled = false, ...props }: GamutWarningProps) {
  if (report) validateGamutReport(report);
  return <View {...props} style={[{ gap: tokens.spacing.fixedElement }, props.style]}>
    <Text accessibilityLiveRegion="polite" {...{ className: joinClasses(!unstyled && "text-text") }}>{!report ? "Gamut not measured" : report.total === 0 ? "No color samples" : `${report.outside} of ${report.total} samples outside ${report.destinationProfileId}${report.maximumDeltaE !== undefined ? `; maximum delta E ${report.maximumDeltaE}` : ""}`}</Text>
    {report?.comparison ? <View style={{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.fixedInset}}>{(['original','mapped'] as const).map(key=>{
      const color=report.comparison![key];return <View key={key} style={{flex:1,minWidth:tokens.spacing.off96,gap:tokens.spacing.fixedStack}}><View accessibilityLabel={`${key} display preview`} style={{height:tokens.spacing.fixedTarget,backgroundColor:rgbaToHex(color.preview,true)}}/><Text selectable {...{className:joinClasses(!unstyled&&"text-text")}}>{key}: {color.profileId}; channels {color.channels.join(', ')}; alpha {color.alpha}</Text></View>;
    })}</View> : null}
    {onInspect ? <Button title="Inspect out-of-gamut colors" disabled={!report || report.outside === 0} onPress={onInspect} unstyled={unstyled}/> : null}
  </View>;
}
