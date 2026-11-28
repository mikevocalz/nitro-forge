import {forgeHairlineRadius} from "../radius.ts";
import {PropertyInspector} from '../inputs/PropertyInspector.tsx';
import {useEditorBoundary} from '@nyc-tron/ui/components/gestures/editor-interaction-scope';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import { useMemo, type ReactNode } from "react";
import { Text, View, type ViewProps } from "react-native";
import { Button } from "@nyc-tron/ui/components/Button";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { rangeAddress, type SheetRange } from "../sheet-window.ts";
import {
  chartSeriesFromCells, parseA1Range, SHEET_CHART_KINDS, MAX_CHART_CELLS,
  type ChartCellValues, type SheetChartData, type SheetChartKind, type SheetChartSpec,
} from "./chart-model.ts";
import { PanelCheckbox, PanelChoices, PanelField, PanelHeading } from "./panel-controls.tsx";
import {exact} from '../exact-optional.ts';
import { tokens } from "../tokens.ts";

/**
 * Controlled chart builder: type gallery, data range, series orientation,
 * header/x-value options and axis titles. It derives series from the cells
 * the app passes for `spec.range` and hands them to `renderPreview`, where the
 * app mounts `@nyc-tron/native-charts` (a separate package this one does not
 * import). Saving a chart into a document is the app's `onInsert`; without it
 * there is no insert button.
 */
export interface ChartPresentation {showLegend:boolean;showDataLabels:boolean;xNumberFormat:string;yNumberFormat:string;series:readonly {id:string;colorId:string}[]}
export interface ChartBuilderProps extends Omit<ViewProps, "children">,ScopedControlProps {
  readonly spec: SheetChartSpec;
  readonly presentation?:ChartPresentation;
  readonly chartColors?:readonly {id:string;label:string}[];
  readonly onPresentationChange?:((value:ChartPresentation)=>unknown)|undefined;
  readonly onSpecChange: (spec: SheetChartSpec) => void;
  /** Values for `spec.range`, keyed by A1 address. */
  readonly cells: ChartCellValues;
  /** The grid's current selection; adds a "Use selection" button. */
  readonly selection?: SheetRange;
  /** Draws the chart. Receives series already validated and labeled. */
  readonly renderPreview?: (spec: SheetChartSpec, data: SheetChartData) => ReactNode;
  readonly onInsert?: ((spec: SheetChartSpec, data: SheetChartData) => unknown) | undefined;
  /** `true` while the app is still loading `cells` for the range. */
  readonly loading?: boolean;
  readonly disabled?:boolean;
  readonly className?: string;
  readonly unstyled?: boolean;
}

const KIND_LABEL: Record<SheetChartKind, string> = { line: "Line", column: "Column", area: "Area" };

/** Small drawn previews for the gallery; theme tokens only. */
function KindGlyph({ kind, unstyled }: { kind: SheetChartKind; unstyled: boolean }) {
  const ink = !unstyled ? "bg-primary" : undefined;
  if (kind === "column") {
    return <View aria-hidden style={{ width: tokens.spacing.off33, height: tokens.spacing.fixedSection, flexDirection: "row", alignItems: "flex-end", gap: tokens.spacing.fixedStack }}>
      {[10, 20, 14, 24].map((h, i) => <View key={i} {...{ className: ink }} style={{ width: tokens.spacing.off6, height: h, borderRadius: forgeHairlineRadius.tick }} />)}
    </View>;
  }
  if (kind === "area") {
    return <View aria-hidden style={{ width: tokens.spacing.off33, height: tokens.spacing.fixedSection, flexDirection: "row", alignItems: "flex-end" }}>
      {[8, 12, 18, 14, 20, 24].map((h, i) => <View key={i} {...{ className: !unstyled ? "bg-primary/40 border-t-2 border-t-primary" : undefined }}
        style={{ width: tokens.spacing.off6, height: h }} />)}
    </View>;
  }
  // Line: three rotated strokes.
  const strokes = [{ x: 0, y: 14, len: 14, deg: -30 }, { x: 12, y: 10, len: 13, deg: 25 }, { x: 23, y: 8, len: 15, deg: -45 }];
  return <View aria-hidden style={{ width: tokens.spacing.off33, height: tokens.spacing.fixedSection }}>
    {strokes.map((s, i) => <View key={i} {...{ className: ink }}
      style={{ position: "absolute", left: s.x, top: s.y, width: s.len, height: tokens.spacing.off2, borderRadius: forgeHairlineRadius.tick, transform: [{ rotate: `${s.deg}deg` }] }} />)}
  </View>;
}

export function ChartBuilder({scope='ChartBuilder',revision=0,...props}:ChartBuilderProps){
 if(props.spec.range.length>512||!SHEET_CHART_KINDS.includes(props.spec.kind)||(props.presentation?.series.length??0)>124)throw new RangeError('Invalid chart configuration');
 const identity=JSON.stringify(controlIdentity(scope,revision)),owner=JSON.stringify([identity,props.disabled,props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <ChartBuilderBody key={identity} {...props} scope={scope} revision={revision} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onPresentationChange={props.onPresentationChange?value=>guard.run('presentation',h=>h.onPresentationChange?.(value)):undefined}
  onInsert={props.onInsert?(...args:Parameters<NonNullable<ChartBuilderProps['onInsert']>>)=>guard.run('onInsert',h=>h.onInsert?.(...args)):undefined}
  onSpecChange={(...args:Parameters<ChartBuilderProps['onSpecChange']>)=>{guard.current()?.onSpecChange(...args);}}
 />;
}
function ChartBuilderBody({actionError,disabledReason,disabled=false,scope='chart',revision=0,presentation,chartColors=[],onPresentationChange,
  spec, onSpecChange, cells, selection, renderPreview, onInsert, loading = false,
  className, unstyled = false, ...props
}: ChartBuilderProps&{actionError?:string|null}) {
  const presentationScope=useEditorBoundary([scope,revision]);
  const set = (patch: Partial<SheetChartSpec>) => onSpecChange({ ...spec, ...patch });
  const result = useMemo((): { data: SheetChartData } | { error: string } => {
    try {
      return { data: chartSeriesFromCells(spec, cells) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Check the data range." };
    }
  }, [spec, cells]);
  const data = "data" in result ? result.data : undefined;
  const rangeError = spec.range.trim() === "" ? "Enter a range such as A1:C12."
    : parseA1Range(spec.range) ? ("error" in result ? result.error : undefined) : `"${spec.range}" is not a cell range.`;
  const points = data?.series.reduce((n, s) => n + s.points.length, 0) ?? 0;
  const muted = !unstyled ? "text-text-muted" : undefined;
  const byColumns = spec.seriesIn === "columns";

  let summary: string;
  if (loading) summary = "Loading the range…";
  else if (!data) summary = "Fix the range to see a preview.";
  else if (points === 0) summary = "No numbers in this range yet. Pick cells that hold values.";
  else summary = `${data.series.length} series, ${points} ${points === 1 ? "point" : "points"}` +
    (data.skippedCells ? `; ${data.skippedCells} ${data.skippedCells === 1 ? "cell has" : "cells have"} no number and ${data.skippedCells === 1 ? "is" : "are"} left out.` : ".");

  return <View {...props} {...{ className: joinClasses(!unstyled && "rounded-card border border-border bg-surface-raised", className) }}
    style={[{ padding: tokens.spacing.fixedGroup, gap: tokens.spacing.fixedGroup }, props.style]}>
    <PanelHeading title="Chart" unstyled={unstyled} />
    <PanelChoices disabled={disabled} label="Chart type" value={spec.kind} unstyled={unstyled}
      choices={SHEET_CHART_KINDS.map(kind => ({ value: kind, label: KIND_LABEL[kind], glyph: <KindGlyph kind={kind} unstyled={unstyled} /> }))}
      onChange={kind => set({ kind })} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.fixedInset, alignItems: "flex-end" }}>
      <PanelField disabled={disabled} label="Data range" value={spec.range} placeholder="A1:C12" unstyled={unstyled}
        hint={`Up to ${MAX_CHART_CELLS} cells on this sheet`} error={rangeError}
        onChange={range => set({ range })} />
      {selection ? <Button disabled={disabled} title="Use selection" variant="secondary" unstyled={unstyled}
        onPress={() => set({ range: rangeAddress(selection) })} /> : null}
    </View>
    <PanelChoices disabled={disabled} label="Series run down" value={spec.seriesIn} unstyled={unstyled}
      choices={[{ value: "columns", label: "Columns" }, { value: "rows", label: "Rows" }]}
      onChange={seriesIn => set({ seriesIn })} />
    <View>
      <PanelCheckbox disabled={disabled} unstyled={unstyled} checked={spec.hasHeader} onChange={hasHeader => set({ hasHeader })}
        label={byColumns ? "First row names the series" : "First column names the series"} />
      <PanelCheckbox disabled={disabled} unstyled={unstyled} checked={spec.hasXValues} onChange={hasXValues => set({ hasXValues })}
        label={byColumns ? "First column holds x values" : "First row holds x values"} />
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.fixedInset }}>
      <PanelField disabled={disabled} label="Title" value={spec.title ?? ""} unstyled={unstyled} autoCapitalize="sentences"
        onChange={title => set({ title })} />
      <PanelField disabled={disabled} label="X axis title" value={spec.xAxisLabel ?? ""} unstyled={unstyled} autoCapitalize="sentences"
        onChange={xAxisLabel => set({ xAxisLabel })} />
      <PanelField disabled={disabled} label="Y axis title" value={spec.yAxisLabel ?? ""} unstyled={unstyled} autoCapitalize="sentences"
        onChange={yAxisLabel => set({ yAxisLabel })} />
    </View>
    {data && points > 0 && renderPreview ? <View accessibilityLabel={spec.title || `${KIND_LABEL[spec.kind]} chart preview`}
      {...{ className: joinClasses(!unstyled && "rounded-control border border-border bg-surface-sunken") }}
      style={{ padding: tokens.spacing.fixedElement }}>
      {renderPreview(spec, data)}
    </View> : null}
    <Text accessibilityLiveRegion="polite" {...{ className: muted }}>{summary}</Text>
    {presentation&&onPresentationChange?<PropertyInspector scope={presentationScope} label="Chart formatting" disabledReason={disabled?'Chart formatting unavailable':undefined} unstyled={unstyled} fields={[
     {id:'showLegend',kind:'boolean',label:'Show chart legend',value:presentation.showLegend},{id:'showDataLabels',kind:'boolean',label:'Show point labels',value:presentation.showDataLabels},
     {id:'xNumberFormat',kind:'text',label:'X-axis number format',value:presentation.xNumberFormat,maxLength:256},{id:'yNumberFormat',kind:'text',label:'Y-axis number format',value:presentation.yNumberFormat,maxLength:256},
     ...presentation.series.slice(0,124).map(series=>({id:'series:'+series.id,kind:'choice' as const,label:'Color for '+(data?.series.find(s=>s.id===series.id)?.label??series.id),value:series.colorId,choices:chartColors}))
    ]} onCommit={(id,value)=>id.startsWith('series:')?onPresentationChange({...presentation,series:presentation.series.map(s=>s.id===id.slice(7)?{...s,colorId:String(value)}:s)}):onPresentationChange({...presentation,[id]:value})}/>:null}
    {onInsert ? <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
      <Button title="Insert chart" disabled={!data || points === 0 || loading} unstyled={unstyled}
        onPress={() => data && onInsert(spec, data)} />
    </View> : null}
  <ErrorMessage {...exact({message:actionError??disabledReason,unstyled:unstyled})}/></View>;
}
