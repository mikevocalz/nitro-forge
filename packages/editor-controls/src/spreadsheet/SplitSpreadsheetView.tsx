import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {useLayoutEffect, useRef, type ReactNode } from "react";
import { I18nManager, View, type ViewProps } from "react-native";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import type { DragTransport } from "@nyc-tron/ui/components/gestures/drag-transport";
import { PanResponderDrag } from "@nyc-tron/ui/components/gestures/PanResponderDrag";
import { dragSplitRatio, splitGeometry, SPLIT_KEY_STEP, type SplitState } from "./freeze-split-model.ts";

/**
 * Two panes of one sheet with a draggable divider. Each pane is whatever
 * `renderPane` returns, normally a `SpreadsheetGrid` for the same sheet with
 * its own scroll position. The divider is an adjustable control: drag it, use
 * arrow keys, or the screen reader's increment/decrement actions. Escape
 * during a drag restores the ratio the drag started from.
 */
export interface SplitSpreadsheetViewProps extends Omit<ViewProps, "children">,ScopedControlProps {
  readonly split: SplitState;
  readonly onSplitChange: (next: SplitState) => void;
  readonly renderPane: (pane: 0 | 1, size: { readonly width: number; readonly height: number }) => ReactNode;
  /** Width and height may come from the host or from onLayout. */
  readonly width?: number;
  readonly height?: number;
  /** Smallest pane, in points. @default 136 */
  readonly minPane?: number;
  /** @default PanResponderDrag */
  readonly transport?: DragTransport;
  readonly className?: string;
  readonly unstyled?: boolean;
}

const DIVIDER = 12;
type Local = { measuredWidth: number; measuredHeight: number; dragStart: number | undefined; dragFrom: { x: number; y: number } | undefined };

export function SplitSpreadsheetView({scope='sheet-split',revision=0,...props}:SplitSpreadsheetViewProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabledReason,props.split.axis,props.width,props.height,props.minPane]),guard=useScopedControl(owner,props,props.disabledReason!==undefined);
 return <SplitSpreadsheetViewBody {...props} boundary={owner} onSplitChange={value=>guard.current()?.onSplitChange(value)}/>;
}
function SplitSpreadsheetViewBody({boundary,disabledReason,

  split, onSplitChange, renderPane, width, height, minPane = 136, transport: Transport = PanResponderDrag,
  className, unstyled = false, onLayout, style, ...props
}: SplitSpreadsheetViewProps&{boundary:string}) {
  const storeRef = useRef<StoreApi<Local> | null>(null);
  if (!storeRef.current) storeRef.current = createStore<Local>(() => ({ measuredWidth: 0, measuredHeight: 0, dragStart: undefined, dragFrom: undefined }));
  const store = storeRef.current;
  const measuredWidth = useStore(store, s => s.measuredWidth);
  const measuredHeight = useStore(store, s => s.measuredHeight);
  const w = width ?? measuredWidth;
  const h = height ?? measuredHeight;
  const stacked = split.axis === "horizontal";
  const total = stacked ? h : w;
  const g = splitGeometry(total, split.ratio, DIVIDER, minPane);
  const latest = useRef(split);
  useLayoutEffect(()=>{latest.current=split;});
  useLayoutEffect(()=>{store.setState({dragStart:undefined,dragFrom:undefined});},[boundary,w,h]);
  const setRatio = (ratio: number) => {
    if(disabledReason!==undefined)return;
    const next = splitGeometry(total, ratio, DIVIDER, minPane).ratio;
    if (next !== latest.current.ratio) onSplitChange({ ...latest.current, ratio: next });
  };
  const nudge = (sign: 1 | -1) => setRatio(g.ratio + sign * SPLIT_KEY_STEP);
  const rtl = I18nManager.isRTL;
  const size0 = stacked ? { width: w, height: g.first } : { width: g.first, height: h };
  const size1 = stacked ? { width: w, height: g.second } : { width: g.second, height: h };
  const percent = Math.round(g.ratio * 100);

  return <View {...props}
    onLayout={e => {
      const { width: nw, height: nh } = e.nativeEvent.layout;
      const s = store.getState();
      if (s.measuredWidth !== nw || s.measuredHeight !== nh) store.setState({ measuredWidth: nw, measuredHeight: nh });
      onLayout?.(e);
    }}
    {...{ className: joinClasses("overflow-hidden", className) }}
    style={[{ width: width ?? "100%", height: height ?? "100%", flexDirection: stacked ? "column" : "row" }, style]}>
    <View style={size0}>{total > 0 ? renderPane(0, size0) : null}</View>
    <Transport disabled={disabledReason!==undefined}
      onBegin={point => {if(disabledReason===undefined)store.setState({ dragStart: g.ratio, dragFrom: point });}}
      onMove={(point, touches) => {
        const s = store.getState();
        if (s.dragStart === undefined || !s.dragFrom) return;
        if (touches !== 1) { setRatio(s.dragStart); store.setState({ dragStart: undefined, dragFrom: undefined }); return; }
        const delta = stacked ? point.y - s.dragFrom.y : (rtl ? -1 : 1) * (point.x - s.dragFrom.x);
        setRatio(dragSplitRatio(total, s.dragStart, delta, DIVIDER, minPane));
      }}
      onRelease={point => {const s=store.getState();if(s.dragStart!==undefined&&s.dragFrom){const delta=stacked?point.y-s.dragFrom.y:(rtl?-1:1)*(point.x-s.dragFrom.x);setRatio(dragSplitRatio(total,s.dragStart,delta,DIVIDER,minPane));}store.setState({dragStart:undefined,dragFrom:undefined});}}
      onCancel={() => {
        const start = store.getState().dragStart;
        if (start !== undefined) setRatio(start);
        store.setState({ dragStart: undefined, dragFrom: undefined });
      }}>
      <View focusable={disabledReason===undefined} accessibilityState={{disabled:disabledReason!==undefined}} accessibilityRole="adjustable"
        accessibilityLabel={stacked ? "Split divider, top pane size" : "Split divider, first pane size"}
        // aria-value* rather than accessibilityValue: React Native Web 0.21
        // drops accessibilityValue, and RN maps these props on native too.
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent} percent`}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={e => nudge(e.nativeEvent.actionName === "increment" ? 1 : -1)}
        onKeyDown={(e: { nativeEvent: { key: string }; preventDefault?: () => void }) => {
          const key = e.nativeEvent.key;
          const grow = stacked ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
          const shrink = stacked ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
          if (key === grow) nudge(1);
          else if (key === shrink) nudge(-1);
          else if (key === "Home") setRatio(0);
          else if (key === "End") setRatio(1);
          else if (key === "Escape" && store.getState().dragStart !== undefined) {
            setRatio(store.getState().dragStart!);
            store.setState({ dragStart: undefined, dragFrom: undefined });
          } else return;
          e.preventDefault?.();
        }}
        {...{ className: joinClasses(!unstyled && "bg-surface-sunken border-border focus-visible:ring-2 focus-visible:ring-focus",
          !unstyled && (stacked ? "border-y" : "border-x")) }}
        style={{ ...(stacked ? { height: DIVIDER, width: w } : { width: DIVIDER, height: h }),
          alignItems: "center", justifyContent: "center" }}
        // The visible bar is 12pt; hitSlop widens the grab area to 44pt.
        hitSlop={stacked ? { top: 16, bottom: 16 } : { left: 16, right: 16 }}>
        <View aria-hidden {...{ className: !unstyled ? "bg-text-muted" : undefined }}
          style={{ borderRadius: 2, ...(stacked ? { width: 36, height: 4 } : { width: 4, height: 36 }) }} />
      </View>
    </Transport>
    <View style={size1}>{total > 0 ? renderPane(1, size1) : null}</View>
  </View>;
}
