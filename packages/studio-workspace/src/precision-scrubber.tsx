import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { Text, TextInput, Pressable, View } from './ui';
import { StudioGesture } from './studio-gesture';
import type { GesturePoint } from './studio-gesture-types';
import { scrubPrecision, type ScrubMode } from './instrument-system';
import { workspaceScale as scale, workspaceThemes, type WorkspaceColors } from './theme';
import { keyboardKey, type StudioKeyboardEvent } from './keyboard-event';

export type ForgePrecisionScrubberProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  /** A local visual preview only. Only onCommit is allowed to mutate the Rust document. */
  onPreview?: (value: number) => void;
  onCommit: (value: number) => Promise<unknown> | unknown;
  /** Use the same neutral semantic palette supplied by the Studio shell. */
  colors?: WorkspaceColors;
  detents?: readonly number[];
};

type PrecisionState = {
  preview: number;
  active: boolean;
  hovered: boolean;
  focused: boolean;
  pending: boolean;
  editing: boolean;
  draft: string;
  mode: ScrubMode;
  error: string | null;
};

const format = (value: number, step: number) => {
  const places = step >= 1 ? 1 : step >= 0.1 ? 2 : step >= 0.01 ? 3 : 4;
  return Number(value.toFixed(places)).toString();
};
const bounded = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Forge 2046 precision control: numeric edit, calibrated direct manipulation,
 * vertical fine/coarse drag, keyboard and screen-reader actions.
 *
 * Native/Web gestures share StudioGesture transport. This control never creates
 * its own undo stack; a completed adjustment makes exactly one engine command.
 */
export function ForgePrecisionScrubber(props: ForgePrecisionScrubberProps) {
  const ref = useRef(props);
  ref.current = props;
  const local = useRef<StoreApi<PrecisionState> | null>(null);
  if (!local.current) {
    local.current = createStore<PrecisionState>(() => ({
      preview: props.value,
      active: false,
      hovered: false,
      focused: false,
      pending: false,
      editing: false,
      draft: format(props.value, props.step),
      mode: 'normal',
      error: null,
    }));
  }
  const store = local.current;
  const state = useStore(store, x => x);
  const start = useRef<{ point: GesturePoint; value: number } | null>(null);
  const palette = props.colors ?? workspaceThemes.dark;
  const disabled = !!props.disabled || state.pending;
  const percent = bounded((state.preview - props.min) / (props.max - props.min), 0, 1);
  const display = format(state.preview, props.step);

  useEffect(() => {
    if (!store.getState().active && !store.getState().editing && !store.getState().pending) {
      store.setState({ preview: props.value, draft: format(props.value, props.step) });
    }
  }, [props.value, props.step, store]);
  useEffect(() => () => { start.current = null; }, []);

  const commit = async (next: number) => {
    const current = ref.current;
    if (current.disabled || store.getState().pending || !Number.isFinite(next)) return;
    const clipped = bounded(next, current.min, current.max);
    if (Math.abs(clipped - current.value) < 1e-10) {
      store.setState({ preview: current.value, draft: format(current.value, current.step), editing: false, active: false });
      return;
    }
    store.setState({ pending: true, editing: false, active: false, preview: clipped, draft: format(clipped, current.step), error: null });
    try {
      await current.onCommit(clipped);
      // Do not display a fabricated success state; the host's document reload
      // is responsible for supplying the committed value.
    } catch (error) {
      const fallback = ref.current;
      store.setState({
        error: error instanceof Error ? error.message : 'Could not apply value',
        preview: fallback.value,
        draft: format(fallback.value, fallback.step),
      });
    } finally {
      const latest = ref.current;
      store.setState({ pending: false, preview: latest.value, draft: format(latest.value, latest.step) });
    }
  };
  const begin = (point: GesturePoint) => {
    if (disabled) return;
    start.current = { point, value: ref.current.value };
    store.setState({ active: true, error: null, mode: 'normal' });
  };
  const calculate = (point: GesturePoint) => {
    const gesture = start.current;
    if (!gesture) return null;
    const mode: ScrubMode = point.y - gesture.point.y < -28 ? 'fine'
      : point.y - gesture.point.y > 28 ? 'coarse' : 'normal';
    const current = ref.current;
    const next = scrubPrecision({
      min: current.min, max: current.max, step: current.step,
      startValue: gesture.value, deltaPixels: point.x - gesture.point.x,
      pixelsPerStep: 8, mode,
      ...(current.detents === undefined ? {} : { detents: current.detents }),
    });
    return { next, mode };
  };
  const move = (point: GesturePoint, touches: number) => {
    if (touches !== 1) { cancel(); return; }
    const result = calculate(point);
    if (!result || disabled) return;
    const previous = store.getState();
    if (previous.preview !== result.next || previous.mode !== result.mode) {
      store.setState({ preview: result.next, mode: result.mode, draft: format(result.next, ref.current.step) });
      ref.current.onPreview?.(result.next);
    }
  };
  const release = (point: GesturePoint) => {
    if (!start.current || disabled) return;
    const result = calculate(point);
    start.current = null;
    store.setState({ active: false, mode: 'normal' });
    if (result) void commit(result.next);
  };
  const cancel = () => {
    start.current = null;
    const current = ref.current;
    store.setState({
      active: false, mode: 'normal',
      preview: current.value, draft: format(current.value, current.step),
    });
  };
  const nudge = (direction: -1 | 1) => {
    if (disabled) return;
    const current = ref.current;
    const next = scrubPrecision({
      min: current.min, max: current.max, step: current.step,
      startValue: current.value, deltaPixels: direction * 8,
    });
    void commit(next);
  };
  const applyDraft = () => {
    const existing = store.getState();
    if (!existing.editing || disabled) return;
    const entered = Number(existing.draft.trim().replace(',', '.'));
    if (!existing.draft.trim() || !Number.isFinite(entered)) {
      store.setState({ editing: false, draft: format(ref.current.value, ref.current.step), error: 'Enter a valid number' });
      return;
    }
    void commit(entered);
  };
  const keys = {
    onKeyDown: (event: StudioKeyboardEvent) => {
      const key = keyboardKey(event);
      if (key === 'Escape' && start.current) cancel();
      if (key === 'ArrowRight' || key === 'ArrowUp') nudge(1);
      if (key === 'ArrowLeft' || key === 'ArrowDown') nudge(-1);
    },
  };
  const ticks = Array.from({ length: 31 }, (_, i) => {
    const tickPercent = i / 30;
    const major = i % 5 === 0;
    return <View key={i} style={{
      width: 1, height: major ? 12 : 5,
      backgroundColor: tickPercent <= percent ? palette.accent : palette.line,
      opacity: major ? 0.9 : 0.55,
    }} />;
  });

  return <View testID="forge-precision-scrubber" style={{ gap: 8, opacity: props.disabled ? 0.5 : 1 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, justifyContent: 'space-between', gap: 10 }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: palette.text, flex: 1 }}>{props.label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 4, backgroundColor: palette.base, borderWidth: 1,
        borderColor: state.editing || state.active ? palette.accent : palette.line, paddingHorizontal: 10, minHeight: 40 }}>
        <TextInput
          testID="precision-value-input"
          selectTextOnFocus
          keyboardType="decimal-pad"
          returnKeyType="done"
          editable={!disabled}
          accessibilityLabel={`${props.label} value`}
          value={state.editing ? state.draft : display}
          onFocus={() => store.setState({ editing: true, draft: display })}
          onChangeText={draft => store.setState({ draft })}
          onSubmitEditing={applyDraft}
          onBlur={applyDraft}
          style={{ color: palette.text, width: 58, textAlign: 'right', fontSize: scale.type.body, fontWeight: '600', fontVariant: ['tabular-nums'], paddingVertical: 6, paddingHorizontal: 2, borderWidth: 1, borderColor: state.editing ? palette.accent : 'transparent', borderRadius: scale.radius.control }}
        />
        {!!props.unit && <Text style={{ fontSize: 11, color: palette.muted, paddingLeft: 2 }}>{props.unit}</Text>}
      </View>
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${props.label}`}
        accessibilityState={{ disabled }} onPress={() => nudge(-1)}
        style={{ minHeight: 44, minWidth: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 4,
          backgroundColor: palette.base, borderColor: palette.line, borderWidth: 1 }}>
        <Text style={{ color: palette.text, fontSize: 20, fontWeight: '400' }}>−</Text>
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <StudioGesture disabled={disabled} onBegin={begin} onMove={move} onRelease={release} onCancel={cancel}>
          <View collapsable={false} {...keys}
            testID="precision-scale"
            onPointerEnter={() => { if (!disabled) store.setState({ hovered: true }); }}
            onPointerLeave={() => store.setState({ hovered: false })}
            onFocus={() => store.setState({ focused: true })}
            onBlur={() => store.setState({ focused: false })}
            focusable={!disabled}
            accessible accessibilityRole="adjustable" accessibilityLabel={props.label}
            accessibilityHint="Drag horizontally to adjust. Move upward for fine precision or downward for coarse. Use arrow keys or the increase and decrease controls."
            accessibilityValue={{ min: props.min, max: props.max, now: state.preview, text: `${display}${props.unit ?? ''}` }}
            accessibilityState={{ disabled }}
            accessibilityActions={[{ name: 'increment', label: 'Increase' }, { name: 'decrement', label: 'Decrease' }]}
            onAccessibilityAction={event => {
              if (event.nativeEvent.actionName === 'increment') nudge(1);
              if (event.nativeEvent.actionName === 'decrement') nudge(-1);
            }}
            style={{ minHeight: 44, borderWidth: 1,
              borderColor: state.active || state.focused ? palette.accent : state.hovered ? palette.muted : palette.line,
              backgroundColor: state.active ? palette.soft : state.hovered ? palette.raised : palette.deep,
              borderRadius: 4, paddingHorizontal: 11, justifyContent: 'center',
              overflow: 'hidden' }}>
            <View pointerEvents="none" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 20 }}>
              {ticks}
            </View>
            <View pointerEvents="none" style={{ position: 'absolute', left: 11, right: 11, bottom: 5, height: 3, backgroundColor: palette.line }}>
              <View style={{ width: `${percent * 100}%`, height: 3, backgroundColor: palette.accent }} />
            </View>
          </View>
        </StudioGesture>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${props.label}`}
        accessibilityState={{ disabled }} onPress={() => nudge(1)}
        style={{ minHeight: 44, minWidth: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 4,
          backgroundColor: palette.base, borderColor: palette.line, borderWidth: 1 }}>
        <Text style={{ color: palette.text, fontSize: 20, fontWeight: '400' }}>+</Text>
      </Pressable>
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: scale.type.label, color: state.active || state.focused ? palette.accent : palette.muted }}>
        {state.active ? `${state.mode.toUpperCase()} PRECISION` : 'DRAG · FINE ↑ · COARSE ↓'}
      </Text>
      <Text style={{ fontSize: scale.type.label, color: palette.muted, fontVariant: ['tabular-nums'] }}>
        {format(props.min, props.step)} – {format(props.max, props.step)}{props.unit ?? ''}
      </Text>
    </View>
    {!!state.error && <Text accessibilityLiveRegion="assertive" style={{ fontSize: 11, color: palette.error }}>{state.error}</Text>}
  </View>;
}
