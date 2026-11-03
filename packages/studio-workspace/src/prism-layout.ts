/** Geometry belongs to the editor viewport, never the native app window contract. */
export function prismViewportLayout(width: number, height: number, ratio: number, layersOpen: boolean, raster: boolean) {
  const narrow = width < 700;
  const short = height < 400;
  const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const panelWidth = Math.min(280, Math.max(1, width - 24));
  const panelTop = short ? 8 : narrow ? 76 : 12;
  const panelMaxHeight = Math.max(1, height - panelTop - (short ? 8 : 108));
  const layerListMaxHeight = Math.max(0, Math.min(245, panelMaxHeight - 184));
  const canvasLeft = narrow ? 76 : 88;
  const canvasRight = layersOpen && !narrow ? panelWidth + 32 : 20;
  const canvasTop = short ? 68 : 80;
  const canvasBottom = short ? 76 : 124;
  const availableWidth = Math.max(1, width - canvasLeft - canvasRight);
  const availableHeight = Math.max(1, height - canvasTop - canvasBottom);
  const canvasWidth = Math.max(0, Math.min(620, availableWidth, availableHeight * aspect));
  const canvasHeight = canvasWidth / aspect;
  // In short narrow windows the palette stays to the right of the tool capsule.
  // Its contents scroll horizontally when raster actions need more width.
  const paletteSpace = Math.max(1, width - (short && narrow ? 88 : 24));
  const fillWidth = Math.min(raster ? 384 : narrow ? 220 : 320, paletteSpace);
  const fillLeft = short && narrow ? width - fillWidth - 12 : (width - fillWidth) / 2;
  return { narrow, short, panelWidth, panelTop, panelMaxHeight, layerListMaxHeight,
    canvasLeft, canvasRight, canvasTop, canvasBottom, canvasWidth, canvasHeight,
    availableWidth, availableHeight, fillWidth, fillLeft };
}
