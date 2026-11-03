import { createStore } from 'zustand/vanilla';
import {
  applyDockAction, collapsePanel, createWorkspace, dockPanel, parsePreset,
  resizeDock, resolveDockDropPreview, serializePreset, stageFits,
  type Dock, type DockAction, type DockDropPreview, type Geometry, type Layout,
  type Point, type Rect, type Studio,
} from '@nitro-forge/studio-layout';

/** Panels available in each studio workspace. */
export const PANEL_IDS = ['outline', 'properties', 'actions', 'history'] as const;
/** A panel managed by {@linkcode createStudioWorkspaceStore}. */
export type PanelId = typeof PANEL_IDS[number];
/** Panel registry used to validate workspace presets and transitions. */
export const KNOWN_PANELS: ReadonlySet<string> = new Set(PANEL_IDS);
/** Default minimum drawing-stage width, in logical pixels. */
export const MIN_STAGE_WIDTH = 320;
/** Default minimum drawing-stage height, in logical pixels. */
export const MIN_STAGE_HEIGHT = 240;

/** Create an independent default panel layout for a studio. */
export function createDefaultLayout(studioId: Studio = 'prism'): Layout {
  const layout = createWorkspace(studioId);
  return { ...layout,
    docks: { left: ['outline'], right: ['properties', 'actions'], bottom: ['history'] },
    activeTabs: studioId === 'quill' ? { left: 'outline' } : { left: 'outline', right: 'properties' },
    collapsed: studioId === 'quill' ? ['properties', 'actions', 'history'] : ['history'],
    sizes: { leftFraction: .18, rightFraction: .22, bottomFraction: .27 },
  };
}

/** Collapse controls without dropping their placement when a measured host shrinks. */
export function fitWorkspace(layout: Layout, geometry: Geometry): Layout | null {
  if (![geometry.width, geometry.height, geometry.minStageWidth, geometry.minStageHeight]
    .every(value => Number.isFinite(value) && value > 0)) return null;
  let next = layout;
  // Compact hosts reserve the full width for the document and bottom panels.
  // Apply this here so reset and preset restore follow the same measured policy.
  if (geometry.width < 700) {
    for (const panel of [...next.docks.left, ...next.docks.right]) {
      const result = collapsePanel(next, panel, true);
      if (result.ok) next = result.layout;
    }
  }
  for (const panel of ['history', 'actions', 'properties', 'outline']) {
    if (stageFits(next, geometry)) return next;
    const result = collapsePanel(next, panel, true);
    if (result.ok) next = result.layout;
  }
  // A host smaller than the requested stage still gets all panel space released.
  return next;
}

type PreviewInput = { point: Point; host: Rect; blockedRegions?: readonly Rect[] };
/** Observable workspace state and commands from {@linkcode createStudioWorkspaceStore}. */
export type WorkspaceState = {
  layout: Layout;
  geometry: Geometry | null;
  drag: { panelId: string; preview: DockDropPreview | null } | null;
  error: string | null;
  status: string;
  action: (panelId: string, action: DockAction) => boolean;
  resize: (dock: Dock, fraction: number) => boolean;
  setGeometry: (geometry: Geometry) => void;
  beginDrag: (panelId: string) => void;
  previewDrag: (input: PreviewInput) => void;
  cancelDrag: () => void;
  commitDrag: () => boolean;
  savePreset: () => string | null;
  restorePreset: (raw: string) => boolean;
  reset: () => void;
};

/** Create per-workspace state; subscribe with selectors in the host UI.
 * Drag previews never change the committed layout. A commit consumes its preview.
 * No document data or native resources are retained by this store.
 */
export function createStudioWorkspaceStore(studioId: Studio = 'prism') {
  return createStore<WorkspaceState>((set, get) => ({
    layout: createDefaultLayout(studioId), geometry: null, drag: null, error: null,
    status: 'Workspace ready',
    action(panelId, action) {
      const { layout, geometry } = get();
      const result = applyDockAction(layout, panelId, action, KNOWN_PANELS, geometry ?? undefined);
      // expand is deliberately geometry-checked here: the layout primitive only
      // applies that check to activate, whereas every visible expansion must fit.
      if (!result.ok || (geometry && !stageFits(result.layout, geometry) && action !== 'collapse')) {
        set({ error: result.ok ? 'no-stage-space' : result.reason, drag: null });
        return false;
      }
      set({ layout: result.layout, drag: null, error: null, status: `${panelId}: ${action}` });
      return true;
    },
    resize(dock, fraction) {
      const { layout, geometry } = get();
      if (!geometry) { set({ error: 'Measure the workspace before resizing' }); return false; }
      const result = resizeDock(layout, dock, fraction, geometry);
      if (!result.ok) { set({ error: result.reason }); return false; }
      set({ layout: result.layout, drag: null, error: null, status: `${dock} dock resized` });
      return true;
    },
    setGeometry(geometry) {
      const layout = fitWorkspace(get().layout, geometry);
      if (!layout) { set({ error: 'invalid-geometry', drag: null }); return; }
      set({ geometry: { ...geometry }, layout, drag: null, error: null,
        status: stageFits(layout, geometry) ? 'Workspace fitted' : 'Compact workspace: panels collapsed' });
    },
    beginDrag(panelId) {
      if (!KNOWN_PANELS.has(panelId)) { set({ error: 'unknown-panel', drag: null }); return; }
      set({ drag: { panelId, preview: null }, error: null, status: `Moving ${panelId}` });
    },
    previewDrag(input) {
      const { drag, layout, geometry } = get();
      if (!drag) return;
      const preview = resolveDockDropPreview({ ...input, layout, known: KNOWN_PANELS,
        panelId: drag.panelId,
        minimumStageWidth: geometry?.minStageWidth ?? MIN_STAGE_WIDTH,
        minimumStageHeight: geometry?.minStageHeight ?? MIN_STAGE_HEIGHT });
      set({ drag: { panelId: drag.panelId, preview }, error: null });
    },
    cancelDrag() { set({ drag: null, error: null, status: 'Move cancelled' }); },
    commitDrag() {
      const { drag, layout, geometry } = get();
      if (!drag?.preview) { set({ drag: null, status: 'No docking target' }); return false; }
      const result = dockPanel(layout, drag.panelId, drag.preview.dock, drag.preview.position,
        KNOWN_PANELS, geometry ?? undefined);
      if (!result.ok) { set({ drag: null, error: result.reason }); return false; }
      set({ layout: result.layout, drag: null, error: null, status: `${drag.panelId} docked` });
      return true;
    },
    savePreset() {
      try {
        const raw = serializePreset(get().layout, KNOWN_PANELS);
        set({ error: null, status: 'Workspace preset saved' });
        return raw;
      } catch { set({ error: 'Invalid workspace preset' }); return null; }
    },
    restorePreset(raw) {
      const parsed = parsePreset(raw, KNOWN_PANELS);
      // Presets are local to one studio and must retain every available panel.
      const ids = parsed ? [...Object.values(parsed.docks).flat(), ...parsed.floating.map(f => f.panelId)] : [];
      if (!parsed || parsed.studioId !== studioId || PANEL_IDS.some(id => !ids.includes(id))) {
        set({ error: 'Invalid workspace preset', drag: null }); return false;
      }
      const geometry = get().geometry;
      const layout = geometry ? fitWorkspace(parsed, geometry) : parsed;
      if (!layout) { set({ error: 'invalid-geometry', drag: null }); return false; }
      set({ layout, drag: null, error: null, status: 'Workspace preset restored' });
      return true;
    },
    reset() {
      const geometry = get().geometry;
      const defaults = createDefaultLayout(studioId);
      set({ layout: geometry ? fitWorkspace(defaults, geometry) ?? defaults : defaults,
        drag: null, error: null, status: 'Workspace reset' });
    },
  }));
}
