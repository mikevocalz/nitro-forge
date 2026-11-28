import { Text, View, type ViewProps } from "react-native";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { bounded, poolHistogram, type HistogramChannel } from "./color-adjustments.ts";
import { tokens } from "../tokens.ts";
export type { HistogramChannel } from "./color-adjustments.ts";
/** Actual histogram bins and their explicit numeric domain. */
export interface LiveHistogramProps extends Omit<ViewProps,"children"> {
  readonly channels: readonly HistogramChannel[];
  readonly domain: readonly [number,number];
  readonly logarithmic?: boolean;
  readonly height?: number;
  readonly unstyled?: boolean;
}
/** Renders bounded, count-preserving histograms; no fake signal or recurring UI timer. */
export function LiveHistogram({channels,domain,logarithmic=false,height=120,unstyled=false,...props}:LiveHistogramProps){
  bounded(height,44,600,"Histogram height");
  if(!domain.every(Number.isFinite)||domain[0]>=domain[1])throw new RangeError("Histogram domain must increase");
  if(channels.length>8||new Set(channels.map(c=>c.id)).size!==channels.length||channels.some(c=>!c.id||!c.label))throw new TypeError("Histogram requires at most eight distinct labeled channels");
  return <View {...props} style={[{gap:tokens.spacing.fixedElement},props.style]}>{channels.length===0?<Text {...{className:joinClasses(!unstyled&&"text-text-muted")}}>No histogram measurements</Text>:channels.map(channel=>{
    const counts=poolHistogram(channel.bins),values=counts.map(n=>logarithmic?Math.log1p(n):n),peak=Math.max(0,...values),total=channel.bins.reduce((sum,n)=>sum+n,0);
    if(!Number.isFinite(total))throw new RangeError("Histogram sample total overflow");
    if(channel.clipping&&(![channel.clipping.low,channel.clipping.high].every(n=>Number.isSafeInteger(n)&&n>=0)||channel.clipping.low+channel.clipping.high>total))throw new RangeError("Invalid measured clipping counts");
    return <View key={channel.id} accessible accessibilityLabel={`${channel.label}: ${total} samples, ${channel.bins.length} bins, domain ${domain[0]} to ${domain[1]}${logarithmic?', logarithmic':''}`} style={{gap:tokens.spacing.fixedStack}}>
      <Text {...{className:joinClasses(!unstyled&&"text-text")}}>{channel.label}: {total} samples</Text>
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" aria-hidden style={{height,flexDirection:'row',alignItems:'flex-end',gap:0}}>{values.map((value,index)=><View key={index} {...{className:joinClasses(!unstyled&&"bg-primary")}} style={{flex:1,height:peak?value/peak*height:0}}/>)}</View>
      <Text accessibilityLiveRegion="polite" {...{className:joinClasses(!unstyled&&(channel.clipping&&(channel.clipping.low>0||channel.clipping.high>0)?"text-danger":"text-text-muted"))}}>{channel.clipping?`Clipped low ${channel.clipping.low}, high ${channel.clipping.high}`:'Clipping not measured'}</Text>
      <Text {...{className:joinClasses(!unstyled&&"text-text-muted")}}>{domain[0]} → {domain[1]}</Text>
    </View>;
  })}</View>;
}
