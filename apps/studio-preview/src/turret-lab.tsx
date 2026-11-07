import { useEffect, useMemo } from 'react';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Button, NightScope, Pressable, SegmentedControl, Text, TokenScope, View, type StudioViewProps } from '@nitro-forge/studio-workspace/ui';

import { BUILT_IN_PERSONAS, PersonaTurret, useForgeRenderPrefs, type PersonaSurface } from '@nitro-forge/studio-workspace/turret';
import { PrecisionScrubber } from '@nyc-tron/ui/components/forge/inputs/PrecisionScrubber';
import { workspaceScale as scale } from '@nitro-forge/studio-workspace/theme';
import {
  FORGE_DIRECTION_IDS, directionPalette, forgeDirections, glassAllowed, isForgeDirection, labCanvas, nycTronTokensFor, prismFillSwatches,
  type ForgeDirectionId, type ForgeScheme,
} from '@nitro-forge/studio-workspace/directions';

/** View style plus the web-only keys this lab sets (boxShadow strings, backdropFilter, dvh). */
type ViewStyle = Record<string, unknown>;
const style = (value: ViewStyle) => value as unknown as NonNullable<StudioViewProps['style']>;

/** `#/lab/turret?direction=workbench|optics|atelier&theme=dark|light&surface=web|ipad` */
export const isTurretLabRoute = () => window.location.hash.startsWith('#/lab/turret');

type LabState = {
  direction: ForgeDirectionId; scheme: ForgeScheme; surface: PersonaSurface;
  open: boolean; personaId: string; fill: number; opacity: number; width: number;
};

function readQuery(): Pick<LabState, 'direction' | 'scheme' | 'surface'> {
  const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const direction = query.get('direction');
  const theme = query.get('theme');
  const surface = query.get('surface');
  return {
    direction: isForgeDirection(direction) ? direction : 'workbench',
    scheme: theme === 'light' || theme === 'dark' ? theme : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
    surface: surface === 'ipad' || surface === 'iphone' || surface === 'desktop' ? surface : 'web',
  };
}

const directionShort: Record<ForgeDirectionId, string> = { workbench: 'Workbench', optics: 'Optics', atelier: 'Atelier' };

/** The three Forge directions on the same three controls: the persona turret,
 * the Precision Scrubber and Prism's fill swatches, over a Prism artboard. */
export function TurretLab() {
  const store = useMemo(() => createStore<LabState>(() => ({ ...readQuery(), open: true, personaId: 'vector', fill: 0, opacity: 64, width: window.innerWidth })), []);
  const s = useStore(store, x => x);
  const prefs = useForgeRenderPrefs();
  useEffect(() => {
    const sync = () => store.setState(readQuery());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [store]);
  const direction = forgeDirections[s.direction];
  const m = direction.materials[s.scheme];
  const depth = direction.depth[s.scheme];
  const canvas = labCanvas[s.scheme];
  const palette = directionPalette(direction, s.scheme);
  const glass = glassAllowed(direction, prefs);
  const phone = s.width < 700;
  const active = BUILT_IN_PERSONAS.find(p => p.id === s.personaId);
  const chrome = (extra: ViewStyle): ViewStyle => ({
    backgroundColor: glass ? m.panel : m.panelSolid, borderWidth: 1, borderColor: m.panelEdge,
    borderRadius: scale.radius.panel, padding: scale.space.group, gap: scale.space.inset,
    ...(depth.panel ? { boxShadow: depth.panel } : {}),
    ...(glass && direction.glass ? { backdropFilter: `blur(${direction.glass.blurPx}px) saturate(${direction.glass.saturate})` } : {}),
    ...extra,
  });
  const fill = prismFillSwatches[s.fill]!;
  const setDirection = (id: string) => {
    if (!isForgeDirection(id)) return;
    const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    query.set('direction', id);
    window.location.hash = `#/lab/turret?${query.toString()}`;
  };

  const artboard = <View testID="lab-artboard" accessibilityLabel={`Artboard 800 × 600 px, ${fill.name} rectangle and ellipse at ${s.opacity} % opacity`}
    style={style({ width: phone ? s.width - 32 : 560, aspectRatio: 4 / 3, maxHeight: phone ? 240 : undefined, alignSelf: 'center', backgroundColor: canvas.paper, borderRadius: scale.radius.paper, overflow: 'hidden', boxShadow: '0 1px 2px #0000002E' })}>
    <View style={{ position: 'absolute', left: '14%', top: '20%', width: '42%', height: '44%', backgroundColor: fill.hex, opacity: s.opacity / 100, borderRadius: scale.radius.paper }} />
    <View style={{ position: 'absolute', left: '44%', top: '36%', width: '38%', height: '46%', backgroundColor: fill.hex, opacity: s.opacity / 100, borderRadius: '50%' }} />
    <Text style={{ position: 'absolute', right: 10, top: 8, color: canvas.paperInk, fontSize: scale.type.micro + 1, fontVariant: ['tabular-nums'] }}>800 × 600 px</Text>
  </View>;

  const turretPanel = <View testID="lab-turret-panel" style={style(chrome({ alignItems: 'center', width: phone ? s.width - 32 : 340 }))}>
    <View style={{ flexDirection: 'row', alignSelf: 'stretch', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: m.text, fontSize: scale.type.label + 1, fontWeight: '600' }}>Persona</Text>
      <Button title="Close" aria-label="Close personas" variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px] border border-transparent" onPress={() => store.setState({ open: false })} />
    </View>
    <PersonaTurret personas={BUILT_IN_PERSONAS} surface={s.surface} activeId={s.personaId} direction={s.direction} scheme={s.scheme}
      onSwitch={personaId => store.setState({ personaId })} />
  </View>;

  const inspector = <View testID="lab-inspector" style={style(chrome({ width: phone ? s.width - 32 : 340 }))}>
    <PrecisionScrubber label="Layer opacity" value={s.opacity} min={0} max={100} step={1} unit="%" detents={[0, 25, 50, 75, 100]}
      forcedColors={!!prefs.forcedColors} onCommit={value => store.setState({ opacity: Math.round(value) })} />
    <View testID="lab-fill-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 2, borderTopWidth: 1, borderTopColor: m.panelEdge, paddingTop: scale.space.element }}>
      <Text style={{ color: m.muted, fontSize: scale.type.label, marginRight: scale.space.element }}>Fill</Text>
      {prismFillSwatches.map((swatch, index) => <Pressable key={swatch.name} accessibilityRole="button" accessibilityLabel={`Choose ${swatch.name} fill`}
        accessibilityState={{ selected: s.fill === index }} onPress={() => store.setState({ fill: index })}
        style={{ width: scale.size.target, height: scale.size.target, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderWidth: 1, borderColor: 'transparent' }}>
        <View style={{ width: 26, height: 26, backgroundColor: swatch.hex, borderRadius: scale.radius.control, borderWidth: s.fill === index ? 3 : 1, borderColor: s.fill === index ? m.text : m.panelEdge }} />
      </Pressable>)}
      <Text style={{ color: m.muted, fontSize: scale.type.label, marginLeft: 'auto', fontVariant: ['tabular-nums'] }}>{fill.hex}</Text>
    </View>
  </View>;

  const trigger = <View style={style(chrome({ flexDirection: 'row', alignItems: 'center', gap: scale.space.element, paddingVertical: scale.space.stack, paddingHorizontal: scale.space.inset, alignSelf: 'flex-start' }))}>
    <Text style={{ color: m.muted, fontSize: scale.type.label }}>Persona</Text>
    <Button title={active?.label ?? 'Persona'} aria-label={`Persona: ${active?.label ?? 'none'}. Open the turret`} selected={s.open}
      variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px] border border-transparent" onPress={() => store.setState({ open: !s.open })} />
  </View>;

  const page = <View testID="turret-lab" className={s.scheme === 'dark' ? 'scheme-dark' : 'scheme-light'} onLayout={e => store.setState({ width: e.nativeEvent.layout.width })}
    style={style({ minHeight: '100dvh', backgroundColor: canvas.ground, padding: 16, gap: 16 })}>
    <View style={{ flexDirection: phone ? 'column' : 'row', alignItems: phone ? 'stretch' : 'center', justifyContent: 'space-between', gap: 12 }}>
      <View style={{ gap: 4, flexShrink: 1 }}>
        <Text accessibilityRole="header" style={{ color: m.text, fontSize: scale.type.title, fontWeight: '600', letterSpacing: -0.3 }}>{direction.name}</Text>
        <Text style={{ color: m.muted, fontSize: scale.type.label, maxWidth: 520 }}>{direction.concept}</Text>
      </View>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,alignItems:'center'}}>
        <SegmentedControl aria-label="Direction" className="border border-transparent" segmentClassName="border border-transparent" value={s.direction} onChange={setDirection}
          options={FORGE_DIRECTION_IDS.map(id => ({ value: id, label: directionShort[id] }))} />
        <Button title="Real Prism task" variant="ghost" onPress={()=>{window.location.hash='#/lab/prism?direction='+s.direction+'&density=standard&theme='+s.scheme;}}/>
      </View>
    </View>
    <View testID="lab-stage" style={{ backgroundColor: canvas.mat, borderRadius: scale.radius.panel, padding: phone ? 16 : 32, gap: phone ? 0 : 16, minHeight: phone ? undefined : 640, flex: phone ? undefined : 1 }}>
      {trigger}
      <View style={{ height: phone ? 12 : 0 }} />
      {artboard}
      {phone
        ? <View style={{ gap: 12, marginTop: -48, alignItems: 'center' }}>{s.open && turretPanel}{inspector}</View>
        : <>
          {s.open && <View style={{ position: 'absolute', left: 32, top: 92 }}>{turretPanel}</View>}
          <View style={{ position: 'absolute', right: 32, bottom: 32 }}>{inspector}</View>
        </>}
    </View>
  </View>;
  const themed = <TokenScope variables={nycTronTokensFor(palette)}>{page}</TokenScope>;
  return s.scheme === 'dark' ? <NightScope>{themed}</NightScope> : themed;
}
