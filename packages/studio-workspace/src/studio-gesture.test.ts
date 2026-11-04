import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

function nativeFixture() {
  const callbacks: Record<string, (...args: any[]) => void> = {};
  const options: Record<string, unknown> = {};
  const tapCallbacks: Record<string, (...args: any[]) => void> = {};
  const tap = new Proxy({}, { get: (_target, name: string) => (value: unknown) => {
    if (name.startsWith('on')) tapCallbacks[name] = value as (...args: any[]) => void;
    return tap;
  } });
  const pan = new Proxy({}, { get: (_target, name: string) => (value: unknown) => {
    if (name.startsWith('on')) callbacks[name] = value as (...args: any[]) => void;
    else options[name] = value;
    return pan;
  } });
  const module = { exports: {} as Record<string, any> };
  const exports = module.exports;
  const source = readFileSync(new URL('./studio-gesture.native.tsx', import.meta.url), 'utf8');
  const js = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
  runInNewContext(js, { module, exports, require: (name: string) => {
    if (name === 'react') return { useRef: (current: unknown) => ({ current }), useMemo: (fn: () => unknown) => fn() };
    if (name === 'react/jsx-runtime') return { jsx: (type: unknown, props: unknown) => ({ type, props }) };
    if (name === 'react-native-gesture-handler') return { Gesture: { Pan: () => pan, Tap: () => tap, Race: (...gestures: unknown[]) => gestures }, GestureDetector: 'GestureDetector' };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const calls: unknown[][] = [];
  const child = { type: 'View' };
  const tree = module.exports.StudioGesture({ children: child, disabled: false,
    onBegin: (point: unknown) => calls.push(['begin', point]),
    onMove: (point: unknown, touches: number) => calls.push(['move', point, touches]),
    onRelease: (point: unknown) => calls.push(['release', point]),
    onCancel: () => calls.push(['cancel']),
  });
  return { callbacks, tapCallbacks, options, calls, tree, child };
}

test('native transport uses RNGH with one pointer, JS callbacks and an unchanged child', () => {
  const f = nativeFixture();
  assert.deepEqual(f.options, { enabled: true, minDistance: 0, maxPointers: 1, runOnJS: true });
  assert.equal(f.tree.type, 'GestureDetector'); assert.equal(f.tree.props.children, f.child);
  f.callbacks.onBegin!({ absoluteX: 10, absoluteY: 20 });
  f.callbacks.onStart!({});
  f.callbacks.onUpdate!({ absoluteX: 30, absoluteY: 40, numberOfPointers: 1 });
  f.callbacks.onEnd!({ absoluteX: 30, absoluteY: 40 }, true);
  f.callbacks.onFinalize!({}, true);
  // Cross-realm objects deliberately normalize before comparison.
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
    ['begin', { x: 10, y: 20 }], ['move', { x: 30, y: 40 }, 1], ['release', { x: 30, y: 40 }],
  ]);
});

test('failure and extra pointers cancel without committing', () => {
  for (const action of ['failedEnd', 'failedFinalize', 'multitouch']) {
    const f = nativeFixture();
    f.callbacks.onBegin!({ absoluteX: 10, absoluteY: 20 });
    f.callbacks.onStart!({});
    f.calls.length = 0;
    if (action === 'failedEnd') f.callbacks.onEnd!({}, false);
    if (action === 'failedFinalize') f.callbacks.onFinalize!({}, false);
    if (action === 'multitouch') f.callbacks.onTouchesDown!({ numberOfTouches: 2 });
    assert.deepEqual(f.calls, [['cancel']]);
  }
});

test('native app mounts its navigator inside the gesture root', () => {
  const root = readFileSync(new URL('../../../apps/example/app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(root, /<GestureHandlerRootView style=\{\{ flex: 1 \}\}>[\s\S]*<StudioUIProvider[\s\S]*<Stack>/);
});

function webFixture() {
  let handlers: Record<string, (...args: any[]) => unknown> = {};
  const module = { exports: {} as Record<string, any> };
  const exports = module.exports;
  const source = readFileSync(new URL('./studio-gesture.tsx', import.meta.url), 'utf8');
  const js = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
  const refs: { current: any }[] = [];
  let refIndex = 0;
  let memo: unknown;
  runInNewContext(js, { module, exports, require: (name: string) => {
    if (name === 'react') return {
      useRef: (current: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current }),
      useMemo: (fn: () => unknown) => memo ?? (memo = fn()),
      cloneElement: (child: any, props: unknown) => ({ ...child, props: { ...child.props, ...props as object } }),
    };
    if (name === 'react-native') return { PanResponder: { create: (next: typeof handlers) => {
      handlers = next; return { panHandlers: { onResponderGrant: next.onPanResponderGrant } };
    } } };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const calls: unknown[][] = [];
  const ref = { current: 'host' };
  const keyboard = () => {};
  const child = { type: 'View', ref, props: { accessibilityLabel: 'Artboard', onKeyDown: keyboard } };
  const props = { children: child, disabled: false,
    onBegin: (point: unknown) => calls.push(['begin', point]),
    onMove: (point: unknown, touches: number) => calls.push(['move', point, touches]),
    onRelease: (point: unknown) => calls.push(['release', point]),
    onCancel: () => calls.push(['cancel']),
  };
  const render = (next = props) => { refIndex = 0; return module.exports.StudioGesture(next); };
  const tree = render();
  const event = (count = 1) => ({ nativeEvent: { pageX: 30, pageY: 40, touches: Array.from({ length: count }, () => ({})) } });
  return { handlers, calls, child, tree, props, render, event };
}

test('web transport retains child identity props and delivers browser page coordinates', () => {
  const f = webFixture();
  assert.equal(f.tree.type, f.child.type);
  assert.equal(f.tree.ref, f.child.ref);
  assert.equal(f.tree.props.accessibilityLabel, f.child.props.accessibilityLabel);
  assert.equal(f.tree.props.onKeyDown, f.child.props.onKeyDown);
  assert.equal(f.tree.props.onResponderGrant, f.handlers.onPanResponderGrant);
  assert.equal(f.handlers.onStartShouldSetPanResponder!(f.event()), true);
  f.handlers.onPanResponderGrant!(f.event());
  f.handlers.onPanResponderMove!(f.event(), { numberActiveTouches: 1 });
  f.handlers.onPanResponderRelease!(f.event(0));
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
    ['begin', { x: 30, y: 40 }], ['move', { x: 30, y: 40 }, 1], ['release', { x: 30, y: 40 }],
  ]);
});

test('web transport rejects disabled/multitouch starts and cancels interruption', () => {
  const f = webFixture();
  assert.equal(f.handlers.onStartShouldSetPanResponder!(f.event(2)), false);
  f.handlers.onPanResponderStart!(f.event(2));
  assert.equal(f.handlers.onPanResponderTerminationRequest!(), true);
  f.handlers.onPanResponderTerminate!();
  assert.deepEqual(f.calls, [['cancel'], ['cancel']]);
  f.render({ ...f.props, disabled: true });
  assert.equal(f.handlers.onStartShouldSetPanResponder!(f.event()), false);
});

test('web responder retains its lifecycle and reads current callbacks after rerender', () => {
  const f = webFixture();
  const calls: unknown[] = [];
  const tree = f.render({ ...f.props, onBegin: point => calls.push(point) });
  assert.equal(tree.props.onResponderGrant, f.tree.props.onResponderGrant);
  f.handlers.onPanResponderGrant!(f.event());
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ x: 30, y: 40 }]);
  assert.deepEqual(f.calls, []);
});


test('no-MOVE tap releases once and a losing pan finalize cannot cancel it', () => {
  const f = nativeFixture();
  f.callbacks.onBegin!({ absoluteX: 10, absoluteY: 20 });
  f.tapCallbacks.onBegin!({ numberOfPointers: 1 });
  f.tapCallbacks.onTouchesDown!({ numberOfTouches: 1 });
  f.tapCallbacks.onEnd!({ absoluteX: 10, absoluteY: 20 }, true);
  f.callbacks.onFinalize!({}, false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['begin', { x: 10, y: 20 }], ['release', { x: 10, y: 20 }]]);
});

test('multitouch or losing tap cannot start a second transaction', () => {
  for (const success of [false, true]) {
    const f = nativeFixture();
    f.tapCallbacks.onBegin!({ numberOfPointers: 1 });
    if (success) f.tapCallbacks.onTouchesDown!({ numberOfTouches: 2 });
    f.tapCallbacks.onEnd!({ absoluteX: 10, absoluteY: 20 }, success);
    assert.deepEqual(f.calls, []);
  }
});

test('pan then tap resets ownership, regardless of losing-finalize order', () => {
  for (const finalizeBeforeTap of [true, false]) {
    const f = nativeFixture();
    f.callbacks.onBegin!({ absoluteX: 1, absoluteY: 2 });
    f.callbacks.onStart!({});
    f.callbacks.onEnd!({ absoluteX: 20, absoluteY: 30 }, true);
    f.callbacks.onFinalize!({}, true);
    f.calls.length = 0;
    f.callbacks.onBegin!({ absoluteX: 40, absoluteY: 50 });
    f.tapCallbacks.onBegin!({ numberOfPointers: 1 });
    if (finalizeBeforeTap) f.callbacks.onFinalize!({}, false);
    f.tapCallbacks.onEnd!({ absoluteX: 40, absoluteY: 50 }, true);
    if (!finalizeBeforeTap) f.callbacks.onFinalize!({}, false);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['begin', { x: 40, y: 50 }], ['release', { x: 40, y: 50 }]]);
  }
});


test('simultaneous two-finger iOS touch-down stays rejected when begin follows touches', () => {
  const f = nativeFixture();
  f.tapCallbacks.onTouchesDown!({ numberOfTouches: 2 });
  f.tapCallbacks.onBegin!({ numberOfPointers: 2 });
  f.tapCallbacks.onEnd!({ absoluteX: 10, absoluteY: 20 }, true);
  assert.deepEqual(f.calls, []);
});
