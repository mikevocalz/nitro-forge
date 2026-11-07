import { keyboardKey, type StudioKeyboardEvent } from './keyboard-event';
import type { StudioViewRef } from './ui';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {useStore} from 'zustand';
import {createStore} from 'zustand/vanilla';
import { Platform } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { View, Text, Button } from './ui';
import { StudioGesture } from './studio-gesture';
import { shapeOutline, windowToPageRect, type CanvasDocument, type CanvasRect } from './prism-canvas-model';
import { createCanvasGesture, type CanvasPreview } from './prism-canvas-model';

/** The engine composite is transparent where nothing is painted (an empty
 * raster layer stays clear), so the artboard shows that as a fine checker
 * instead of a white block: 8 pt squares in two near-white neutrals, quiet
 * enough that every fill reads over it. */
export const ARTBOARD_CHECKER = { size: 8, light: '#FFFFFF', dark: '#EDEFF3' } as const;

function TransparencyChecker({ width, height }: { width: number; height: number }) {
  const { size, light, dark } = ARTBOARD_CHECKER;
  return <Svg testID="prism-transparency" width={width} height={height} aria-hidden pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0 }}
    {...(Platform.OS === 'web' ? {} : { accessible: false, focusable: false })}>
    <Defs>
      <Pattern id="prism-checker" width={size * 2} height={size * 2} patternUnits="userSpaceOnUse">
        <Rect width={size * 2} height={size * 2} fill={light} />
        <Rect width={size} height={size} fill={dark} />
        <Rect x={size} y={size} width={size} height={size} fill={dark} />
      </Pattern>
    </Defs>
    <Rect width={width} height={height} fill="url(#prism-checker)" />
  </Svg>;
}

/** Touch/pointer edits commit once on release. The overlay previews bounds only. */
export function PrismCanvas(props: {
  document: CanvasDocument; width: number; height: number; selectedId: number | null;
  disabled: boolean; color: string; children: ReactNode; overlay?: ReactNode;
  onSelect: (id: number | null) => void;
  onMoveShape: (id: number, dx: number, dy: number) => void;
}) {
  const current = useRef(props); current.current = props;
  const selection = useRef(props.selectedId); selection.current = props.selectedId;
  const view = useRef<StudioViewRef>(null);
  const mounted = useRef(true);
  const previewStore=useMemo(()=>createStore(()=>({preview:null as CanvasPreview})),[]);
  const preview=useStore(previewStore,state=>state.preview);
  const setPreview=(preview:CanvasPreview)=>previewStore.setState({preview});
  const controller = useRef<ReturnType<typeof createCanvasGesture> | null>(null);
  if (!controller.current) controller.current = createCanvasGesture({
    context: () => ({ ...current.current, selectedId: selection.current, disabled: current.current.disabled || !mounted.current }),
    measure: () => new Promise<CanvasRect | null>(resolve => {
      const timer = setTimeout(() => resolve(null), 500);
      if (!view.current) { clearTimeout(timer); resolve(null); return; }
      try {
        view.current.measureInWindow((x, y, width, height) => {
          clearTimeout(timer);
          const browser = globalThis as { scrollX?: number; scrollY?: number };
          resolve(windowToPageRect({ x, y, width, height }, Platform.OS === 'web'
            ? { x: browser.scrollX ?? 0, y: browser.scrollY ?? 0 } : { x: 0, y: 0 }));
        });
      } catch { clearTimeout(timer); resolve(null); }
    }),
    select: id => { selection.current = id; current.current.onSelect(id); },
    preview: value => { if (mounted.current) setPreview(value); },
    commit: (id, dx, dy) => current.current.onMoveShape(id, dx, dy),
  });
  const gesture = controller.current;
  useEffect(() => { gesture.cancel(); }, [props.document, props.width, props.height, props.disabled, gesture]);
  useEffect(() => { gesture.selectionChanged(props.selectedId); }, [props.selectedId, gesture]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; gesture.cancel(); }; }, [gesture]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const browser = globalThis as unknown as {
      addEventListener: (event: string, callback: () => void, capture: boolean) => void;
      removeEventListener: (event: string, callback: () => void, capture: boolean) => void;
    };
    // Capture nested scrolling too: measured artboard geometry is then stale.
    for (const event of ['scroll', 'resize', 'blur']) browser.addEventListener(event, gesture.cancel, true);
    return () => { for (const event of ['scroll', 'resize', 'blur']) browser.removeEventListener(event, gesture.cancel, true); };
  }, [gesture]);
  const layer = props.document.layers.find(item => item.id === (preview?.id ?? props.selectedId));
  const touchStyle = Platform.OS === 'web' ? { touchAction: 'none' as const } : {};
  const outline = shapeOutline(props.document, props.width, props.height, layer, preview ?? undefined);
  return <StudioGesture disabled={props.disabled}
    onBegin={point => { view.current?.focus(); gesture.begin(point); }}
    onMove={gesture.move} onRelease={point => { void gesture.release(point); }} onCancel={gesture.cancel}>
    <View ref={view} collapsable={false} focusable onLayout={() => gesture.cancel()}
    {...{ onKeyDown: (event: StudioKeyboardEvent) => { if (keyboardKey(event) === 'Escape') gesture.cancel(); } }}
    testID="prism-artboard" accessibilityLabel="Prism artboard. Select layers or use Transform for accessible move actions."
    style={{ ...touchStyle, width: props.width, height: props.height, backgroundColor: ARTBOARD_CHECKER.light, overflow: 'hidden', boxShadow: '0 12px 35px #00000035' }}>
    <TransparencyChecker width={props.width} height={props.height} />
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>{props.children}</View>
    {props.overlay}
    {!props.overlay && outline && <View pointerEvents="none" testID="prism-selection-bounds" style={{ position: 'absolute', left: outline.x, top: outline.y, width: outline.width, height: outline.height, borderWidth: 2, borderColor: props.color, borderStyle: preview ? 'dashed' : 'solid' }} />}
    {preview && <View style={{ position: 'absolute', bottom: 4, left: 4, backgroundColor: '#111827', padding: 4 }}>
      <Text style={{ color: '#FFFFFF', fontSize: 11 }}>Move preview · release to apply</Text>
      <Button title="Cancel move" aria-label="Cancel shape move" onPress={() => gesture.cancel()} variant="ghost" size="sm" tone="carolina" cornerRadius={4} />
    </View>}
  </View></StudioGesture>;
}
