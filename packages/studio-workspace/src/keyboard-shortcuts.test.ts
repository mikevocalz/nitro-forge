import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STUDIO_SHORTCUTS, dispatchStudioShortcut, isApplePlatform, isTextEntryTarget, shortcutLabel, studioShortcut, withShortcut,
  type ShortcutKeyEvent,
} from './keyboard-shortcuts.ts';

const key = (k: string, mods: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({ key: k, ...mods });

test('⌘ on Apple platforms and Ctrl elsewhere', () => {
  assert.equal(isApplePlatform('ios'), true);
  assert.equal(isApplePlatform('web', 'MacIntel'), true, 'iPadOS Safari reports MacIntel');
  assert.equal(isApplePlatform('web', 'iPad'), true);
  assert.equal(isApplePlatform('web', 'Win32'), false);
  assert.equal(isApplePlatform('android'), false);
});

test('undo, redo, save and open on the command key', () => {
  assert.equal(studioShortcut(key('z', { metaKey: true }), true), 'undo');
  assert.equal(studioShortcut(key('Z', { metaKey: true, shiftKey: true }), true), 'redo');
  assert.equal(studioShortcut(key('s', { metaKey: true }), true), 'save');
  assert.equal(studioShortcut(key('o', { metaKey: true }), true), 'open');
  assert.equal(studioShortcut(key('/', { metaKey: true }), true), 'help');
  assert.equal(studioShortcut(key('z', { ctrlKey: true }), false), 'undo');
  assert.equal(studioShortcut(key('Z', { ctrlKey: true, shiftKey: true }), false), 'redo');
  assert.equal(studioShortcut(key('y', { ctrlKey: true }), false), 'redo');
  assert.equal(studioShortcut(key('s', { ctrlKey: true }), false), 'save');
  assert.equal(studioShortcut(key('o', { ctrlKey: true }), false), 'open');
});

test('other modifiers and plain keys do nothing', () => {
  assert.equal(studioShortcut(key('z'), true), null);
  assert.equal(studioShortcut(key('z', { ctrlKey: true }), true), null, 'Ctrl+Z is not undo on a Mac');
  assert.equal(studioShortcut(key('z', { metaKey: true }), false), null, 'the Windows key is not the command key');
  assert.equal(studioShortcut(key('z', { metaKey: true, altKey: true }), true), null);
  assert.equal(studioShortcut(key('y', { metaKey: true }), true), null, '⌘Y is not redo on a Mac');
  assert.equal(studioShortcut(key('s', { metaKey: true, shiftKey: true }), true), null, '⇧⌘S is Save As, not Save');
  assert.equal(studioShortcut(key('s', { metaKey: true, repeat: true }), true), null, 'a held S saves once');
  assert.equal(studioShortcut(key('z', { metaKey: true, repeat: true }), true), 'undo', 'a held Z keeps undoing, as on a Mac');
});

test('React Native key events carry the fields in nativeEvent', () => {
  assert.equal(studioShortcut({ nativeEvent: { key: 'z', metaKey: true, shiftKey: true } }, true), 'redo');
});

test('typing in a field keeps its own undo', () => {
  assert.equal(isTextEntryTarget({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isTextEntryTarget({ tagName: 'input' }), true, 'an input with no type is text');
  assert.equal(isTextEntryTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTextEntryTarget({ tagName: 'DIV', getAttribute: (name: string) => name === 'role' ? 'textbox' : null }), true);
  assert.equal(isTextEntryTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isTextEntryTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTextEntryTarget(null), false);
});

test('dispatch runs the matching handler once and stops the browser action', () => {
  const calls: string[] = [];
  let prevented = 0;
  const handlers = { undo: () => calls.push('undo'), redo: () => calls.push('redo'), save: () => calls.push('save'), open: () => calls.push('open') };
  const event = (k: string, mods: Partial<ShortcutKeyEvent> = {}) => ({ ...key(k, { metaKey: true, ...mods }), preventDefault: () => { prevented += 1; } });
  assert.equal(dispatchStudioShortcut(event('z'), true, handlers), true);
  assert.equal(dispatchStudioShortcut(event('z', { shiftKey: true }), true, handlers), true);
  assert.equal(dispatchStudioShortcut(event('s'), true, handlers), true);
  assert.equal(dispatchStudioShortcut(event('o'), true, handlers), true);
  assert.deepEqual(calls, ['undo', 'redo', 'save', 'open']);
  assert.equal(prevented, 4);
  // In a text field the field keeps ⌘Z; nothing runs and the event is untouched.
  assert.equal(dispatchStudioShortcut(event('z', { target: { tagName: 'TEXTAREA' } }), true, handlers), false);
  // Without an open handler ⌘O is left to the browser.
  assert.equal(dispatchStudioShortcut(event('o'), true, { ...handlers, open: undefined }), false);
  assert.equal(dispatchStudioShortcut(event('/'), true, handlers), false, 'no help handler, nothing to show');
  assert.equal(calls.length, 4);
  assert.equal(prevented, 4);
});

test('labels name the keys the way each platform prints them', () => {
  assert.equal(shortcutLabel('redo', true), '⇧⌘Z');
  assert.equal(shortcutLabel('redo', false), 'Ctrl+Shift+Z');
  assert.equal(withShortcut('Undo', 'undo', true), 'Undo (⌘Z)');
  assert.equal(withShortcut('Save', 'save', false), 'Save (Ctrl+S)');
  assert.deepEqual(STUDIO_SHORTCUTS.map(item => item.shortcut), ['undo', 'redo', 'save', 'open', 'help']);
});

test('the workspace wires the layer and names the shortcut on each control', () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.tsx'), 'utf8');
  for (const [label, shortcut] of [['Undo', 'undo'], ['Redo', 'redo'], ['Save', 'save']]) {
    assert.match(source, new RegExp(`withShortcut\\('${label}', '${shortcut}', applePlatform\\)`), `${label} names its shortcut`);
  }
  assert.match(source, /document\.addEventListener\('keydown'/, 'the web listens on the document');
  assert.match(source, /getClientRects\(\)\.length === 0\) return/, 'a hidden studio ignores the keys');
  assert.match(source, /Platform\.OS !== 'web'\) dispatchStudioShortcut/, 'native hardware keys go through the focused view');
  assert.match(source, /testID="workspace-shortcuts"/, 'the shortcut list can be opened');
});
