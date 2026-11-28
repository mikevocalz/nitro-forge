import assert from 'node:assert/strict';
import { formatOpacity, moveLayer, stepOpacity, validateLayers, type LayerRow } from '@nitro-forge/editor-controls/layers/layer-model';

export async function example() {
  const rows: LayerRow[] = [
    { id: 'title', name: 'Title', kind: 'text', visible: true, opacity: 1 },
    { id: 'photo', name: 'Photo', kind: 'raster', visible: true, opacity: 0.8 },
    { id: 'paper', name: 'Paper', kind: 'raster', visible: false, opacity: 1 },
  ];
  validateLayers(rows);

  const reordered = moveLayer(rows, 'paper', 0);
  assert.deepEqual(reordered.map((row) => row.id), ['paper', 'title', 'photo']);

  assert.equal(stepOpacity(0.8, 1), 0.85);
  assert.equal(formatOpacity(0.85), '85%');
}
