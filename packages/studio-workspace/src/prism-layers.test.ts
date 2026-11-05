import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveLayer, validateLayers } from '@nyc-tron/ui/components/forge/layers/layer-model';
import {
  prismLayerRows, prismMoveCommand, prismOpacityCommand, prismRenameCommand, prismSelectedRowId,
  prismVisibilityCommand, type PrismLayer,
} from './prism-layers.ts';

const shape = (id: number, name: string): PrismLayer => ({ id, name, visible: true, opacity: 1, content: { type: 'shape', shape: { kind: 'rect', x: 0, y: 0, w: 1, h: 1, fill: [0, 0, 0, 255] } } });
const raster = (id: number, name: string): PrismLayer => ({ id, name, visible: false, opacity: 0.4, content: { type: 'raster', pixels_b64: '' } });
// Engine order: bottom to top.
const doc = [raster(7, 'Paper'), shape(3, 'Rectangle 2'), shape(9, 'Ellipse 3')];

test('rows list the top engine layer first and pass LayerStack validation', () => {
  const rows = prismLayerRows(doc);
  assert.deepEqual(rows.map(row => row.id), ['9', '3', '7']);
  assert.deepEqual(rows.map(row => row.kind), ['vector', 'vector', 'raster']);
  assert.equal(rows[2]!.visible, false);
  assert.equal(rows[2]!.opacity, 0.4);
  validateLayers(rows);
});

test('a blank engine name reads as the kind and id, so LayerStack never throws on it', () => {
  const rows = prismLayerRows([shape(4, '  ')]);
  assert.equal(rows[0]!.name, 'Rectangle 4');
  validateLayers(rows);
});

test('a row move becomes the engine index that puts the layer in the same place', () => {
  for (let from = 0; from < doc.length; from++) for (let to = 0; to < doc.length; to++) {
    const rows = prismLayerRows(doc);
    const id = rows[from]!.id;
    const command = prismMoveCommand(doc, id, to);
    if (from === to) { assert.equal(command, undefined); continue; }
    assert.equal(command?.op, 'moveLayer');
    // Apply the engine move bottom-to-top and compare with LayerStack's own top-first move.
    const engine = doc.slice();
    const index = engine.findIndex(layer => String(layer.id) === id);
    const [moved] = engine.splice(index, 1);
    engine.splice((command!.payload as { to_index: number }).to_index, 0, moved!);
    assert.deepEqual(prismLayerRows(engine).map(row => row.id), moveLayer(rows, id, to).map(row => row.id));
  }
});

test('moving to an index outside the list throws', () => {
  assert.throws(() => prismMoveCommand(doc, '9', 3), RangeError);
  assert.throws(() => prismMoveCommand(doc, '9', -1), RangeError);
});

test('an opacity release is one setLayerOpacity, and an unchanged value is none', () => {
  assert.deepEqual(prismOpacityCommand(doc, '7', 0.75), { op: 'setLayerOpacity', payload: { id: 7, opacity: 0.75 }, label: 'Layer opacity changed' });
  assert.equal(prismOpacityCommand(doc, '7', 0.4), undefined);
  assert.throws(() => prismOpacityCommand(doc, '7', 1.2), RangeError);
});

test('visibility flips the engine value', () => {
  assert.deepEqual(prismVisibilityCommand(doc, '7').payload, { id: 7, visible: true });
  assert.deepEqual(prismVisibilityCommand(doc, '9').payload, { id: 9, visible: false });
  assert.equal(prismVisibilityCommand(doc, '9').label, 'Layer hidden');
});

test('rename trims, and an unchanged name sends nothing', () => {
  assert.deepEqual(prismRenameCommand(doc, '3', '  Card  ')?.payload, { id: 3, name: 'Card' });
  assert.equal(prismRenameCommand(doc, '3', 'Rectangle 2'), undefined);
  assert.throws(() => prismRenameCommand(doc, '3', '   '), RangeError);
});

test('a callback for a layer the document no longer has throws', () => {
  assert.throws(() => prismVisibilityCommand(doc, '42'), RangeError);
});

test('selection is the editor store id as a row id', () => {
  assert.equal(prismSelectedRowId(9), '9');
  assert.equal(prismSelectedRowId(null), undefined);
});
