/** Below this editor width, contextual Layers overlays rather than resizing the artboard. */
export const PRISM_DOCKED_LAYERS_MIN_WIDTH = 1100;
/** Compact panel width; alpha.3 LayerStack collapses row opacity when space is tight. */
export const PRISM_LAYERS_PANEL_WIDTH = 280;

/** Geometry belongs to the editor viewport, never the native app window contract. */
/** Measured chrome, in editor coordinates. Larger text (200 %) grows the
 * toolbar and the tool rail, so the artboard and panels start below and
 * beside what was really laid out instead of at fixed offsets. */
export type PrismChromeMeasure = Readonly<{ toolbarBottom?: number; railRight?: number }>;

/** Toolbar and rail as drawn at 100 % text: a 48 pt toolbar at 12 pt and a 52 pt rail at 12 pt. */
export const PRISM_TOOLBAR_TOP = 12;
export const PRISM_DEFAULT_TOOLBAR_BOTTOM = 60;
export const PRISM_DEFAULT_RAIL_RIGHT = 64;
/** Gap between a piece of chrome and what sits below or beside it. */
const CHROME_GAP = 8;

export function prismViewportLayout(width: number, height: number, ratio: number, layersOpen: boolean, hasFillAction: boolean, chrome: PrismChromeMeasure = {}) {
  const narrow = width < 700;
  const short = height < 400;
  const dockedLayers = width >= PRISM_DOCKED_LAYERS_MIN_WIDTH;
  const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const toolbarBottom = Math.max(PRISM_DEFAULT_TOOLBAR_BOTTOM, chrome.toolbarBottom ?? 0);
  const railRight = Math.max(PRISM_DEFAULT_RAIL_RIGHT, chrome.railRight ?? 0);
  // The compact row keeps its name and remove action reachable at this width.
  const panelWidth = Math.max(1, Math.min(PRISM_LAYERS_PANEL_WIDTH, width - 24));
  // Grown chrome pushes the panel, rail and artboard down by the same amount.
  const grown = toolbarBottom - PRISM_DEFAULT_TOOLBAR_BOTTOM;
  const railTop = toolbarBottom + (short ? CHROME_GAP : CHROME_GAP * 2);
  const panelTop = short ? 8 : narrow ? toolbarBottom + 16 : 12;
  const panelMaxHeight = Math.max(1, height - panelTop - (short ? 8 : 108));
  const layerListMaxHeight = Math.max(0, Math.min(245, panelMaxHeight - 184));
  const canvasLeft = railRight + (narrow ? 12 : 24);
  // On a phone the artboard is centred on the screen: the right margin
  // matches the rail side, so the margins balance instead of 76 against 20.
  const canvasRight = layersOpen && dockedLayers ? panelWidth + 32 : narrow ? canvasLeft : 20;
  const canvasTop = (short ? 68 : 80) + grown;
  const canvasBottom = short ? 76 : 100;
  const availableWidth = Math.max(1, width - canvasLeft - canvasRight);
  const availableHeight = Math.max(1, height - canvasTop - canvasBottom);
  const canvasWidth = Math.max(0, Math.min(900, availableWidth, availableHeight * aspect));
  const canvasHeight = canvasWidth / aspect;
  // In short narrow windows the palette stays to the right of the tool capsule.
  // Its contents scroll horizontally when raster actions need more width.
  const paletteSpace = Math.max(1, width - (short && narrow ? 88 : 24));
  const fillWidth = Math.min(hasFillAction ? 384 : narrow ? 220 : 320, paletteSpace);
  const fillLeft = short && narrow ? width - fillWidth - 12 : (width - fillWidth) / 2;
  return { narrow, short, dockedLayers, panelWidth, panelTop, panelMaxHeight, layerListMaxHeight, railTop,
    canvasLeft, canvasRight, canvasTop, canvasBottom, canvasWidth, canvasHeight,
    availableWidth, availableHeight, fillWidth, fillLeft };
}
