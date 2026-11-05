import test from 'node:test';
import assert from 'node:assert/strict';
import { studioDropdownGroups } from './nyc-tron-options.ts';

test('grouped picker keeps headings, unavailable options and supporting descriptions', () => {
  const groups = [{ id: 'formats', label: 'Export formats', options: [
    { value: 'pdf', label: 'PDF', supportingText: 'Print', disabled: true },
    { value: 'png', label: 'PNG' },
  ] }];
  const before = structuredClone(groups);
  assert.deepEqual(studioDropdownGroups(groups), [{ heading: 'Export formats', options: [
    { value: 'pdf', label: 'PDF (Print)', disabled: true },
    { value: 'png', label: 'PNG' },
  ] }]);
  assert.deepEqual(groups, before);
});

test('a group without a caption still has a nonempty canonical heading', () => {
  assert.equal(studioDropdownGroups([{ id: 'formats', label: ' ', options: [{ value: 'png', label: 'PNG' }] }])[0]?.heading, 'formats');
});
