import { it, expect } from 'vitest';
import type { ComponentProps } from 'react';
import type { ViroImage } from '@reactvision/react-viro';
import { createXRPresentation, type XRPresentationFrame, type XRPresentationImage } from '../src/xr/presentation';
import { createViroLoadBinding } from '../src/xr/viro-load-binding';

type NativeImageProps = ComponentProps<typeof ViroImage>;
type LoadEvent = Parameters<NonNullable<NativeImageProps['onLoadEnd']>>[0];
type ErrorEvent = Parameters<NonNullable<NativeImageProps['onError']>>[0];
// Actual Viro callback shapes; these are lifecycle unit events, not a native-renderer run.
const loaded = (success: boolean) => ({ nativeEvent: { success } } as LoadEvent);
const failed = (error: Error | string) => ({ nativeEvent: { error } } as ErrorEvent);
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fixture() {
  let revision = 1, changed = () => {}, removed = 0;
  const offered: (XRPresentationImage | null)[] = [], errors: Error[] = [], released: number[] = [];
  const requests: { revision: number; signal: AbortSignal; resolve(frame: XRPresentationFrame): void; reject(error: Error): void }[] = [];
  const source = {
    getRevision: () => revision,
    addOnChangedListener: (listener: () => void) => { changed = listener; return { remove: () => { removed++; } }; },
    renderFrame: (revision: number, signal: AbortSignal) => new Promise<XRPresentationFrame>((resolve, reject) => requests.push({ revision, signal, resolve, reject })),
  };
  const controller = createXRPresentation({ source, onFrame: image => offered.push(image), onError: error => errors.push(error) });
  const frame = (revision: number): XRPresentationFrame => ({
    revision, uri: 'file:///cache/frame-' + revision + '.png', widthPx: 640, heightPx: 480,
    dispose: () => { released.push(revision); },
  });
  const image = () => offered.at(-1)!;
  return { controller, requests, frame, image, offered, errors, released, source,
    change: (next: number) => { revision = next; changed(); }, removed: () => removed };
}
function attach(image: XRPresentationImage) {
  const presented: number[] = [], errors: Error[] = [];
  const binding = createViroLoadBinding(image, () => ({ onPresented: revision => presented.push(revision), onError: error => errors.push(error) }));
  expect(binding).not.toBeNull();
  return { binding: binding!, presented, errors };
}

it('keeps the previous file until Viro load succeeds and the new file until its surface detaches', async () => {
  const f = fixture(); await tick();
  f.requests[0]!.resolve(f.frame(1)); await tick();
  const a = attach(f.image()!);
  a.binding.onLoadEnd(loaded(true));
  f.change(2); await tick(); f.requests[1]!.resolve(f.frame(2)); await tick();
  const b = attach(f.image()!);
  a.binding.release();
  expect(f.released).toEqual([]); // onFrame/React replacement is not a load acknowledgment.
  b.binding.onLoadEnd(loaded(true));
  expect(f.released).toEqual([1]);
  expect(b.presented).toEqual([2]);
  b.binding.onLoadEnd(loaded(true));
  expect(b.presented).toEqual([2]);
  f.controller.dispose(); f.controller.dispose();
  expect(f.released).toEqual([1]); // Still mounted in Viro.
  expect(f.image()).toBeNull();
  expect(f.removed()).toBe(1);
  b.binding.release(); b.binding.release();
  expect(f.released).toEqual([1, 2]);
});

it('coalesces rapid edits behind one running renderer even when cancellation is ignored', async () => {
  const f = fixture(); await tick();
  for (let revision = 2; revision <= 100; revision++) f.change(revision);
  await tick();
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]!.signal.aborted).toBe(true);
  f.requests[0]!.resolve(f.frame(1)); await tick();
  expect(f.released).toEqual([1]);
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]!.revision).toBe(100);
  f.requests[1]!.resolve(f.frame(100)); await tick();
  for (let revision = 101; revision <= 200; revision++) f.change(revision);
  await tick();
  expect(f.requests).toHaveLength(2); // Native loading also exerts backpressure.
  const surface = attach(f.image()!);
  surface.binding.onLoadEnd(loaded(true)); await tick();
  expect(f.requests).toHaveLength(3);
  expect(f.requests[2]!.revision).toBe(200);
  f.controller.dispose(); surface.binding.release();
  f.requests[2]!.resolve(f.frame(200)); await tick();
  expect(f.released).toEqual([1, 100, 200]);
  expect(f.offered.filter(Boolean).map(image => image!.revision)).toEqual([100]);
});

it('a failed native load restores the prior image and reports one renderer error', async () => {
  const f = fixture(); await tick();
  f.requests[0]!.resolve(f.frame(1)); await tick();
  const a = attach(f.image()!); a.binding.onLoadEnd(loaded(true));
  f.change(2); await tick(); f.requests[1]!.resolve(f.frame(2)); await tick();
  const b = attach(f.image()!); a.binding.release();
  b.binding.onLoadEnd(loaded(false));
  b.binding.onError(failed('duplicate native failure'));
  expect(f.offered.filter(Boolean).map(image => image!.revision)).toEqual([1, 2, 1]);
  expect(b.errors).toHaveLength(1);
  expect(b.presented).toEqual([]);
  expect(f.released).toEqual([]);
  b.binding.release();
  expect(f.released).toEqual([2]);
  f.controller.dispose();
  expect(f.released).toEqual([2, 1]);
});

it('disposal releases an unmounted offer and every late render without notifying a stale surface', async () => {
  const f = fixture(); await tick();
  f.requests[0]!.resolve(f.frame(1)); await tick();
  const stale = f.image()!;
  f.controller.dispose();
  expect(f.released).toEqual([1]);
  expect(stale.retain()).toBeNull();
  expect(stale.loaded()).toBe(false);
  expect(createViroLoadBinding(stale, () => ({ onPresented: () => { throw Error('stale'); }, onError: () => { throw Error('stale'); } }))).toBeNull();
  const late = fixture(); await tick(); late.controller.dispose();
  late.requests[0]!.resolve(late.frame(1)); await tick();
  late.change(2); await tick();
  expect(late.requests).toHaveLength(1);
  expect(late.released).toEqual([1]);
  expect(late.offered).toEqual([null]);
});

it('unmounting a pending Viro image clears the offer and permits the latest revision', async () => {
  const f = fixture(); await tick(); f.requests[0]!.resolve(f.frame(1)); await tick();
  const surface = attach(f.image()!);
  f.change(2);
  surface.binding.release(); await tick();
  surface.binding.onLoadEnd(loaded(true));
  surface.binding.onError(failed('late callback'));
  expect(surface.presented).toEqual([]);
  expect(surface.errors).toEqual([]);
  expect(f.released).toEqual([1]);
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]!.revision).toBe(2);
  f.controller.dispose(); f.requests[1]!.resolve(f.frame(2)); await tick();
  expect(f.released).toEqual([1, 2]);
});

it('an effect detach/attach replay retains a pending load instead of withdrawing it', async () => {
  const f = fixture(); await tick(); f.requests[0]!.resolve(f.frame(1)); await tick();
  const old = attach(f.image()!);
  old.binding.release();
  const next = attach(f.image()!);
  await tick();
  expect(f.released).toEqual([]);
  old.binding.onLoadEnd(loaded(true));
  expect(old.presented).toEqual([]);
  next.binding.onLoadEnd(loaded(true));
  expect(next.presented).toEqual([1]);
  f.controller.dispose(); next.binding.release();
  expect(f.released).toEqual([1]);
});

it('rejects wrong revisions and unsupported image URIs without spinning retries', async () => {
  const f = fixture(); await tick();
  f.requests[0]!.resolve({ ...f.frame(1), uri: 'data:image/png;base64,AAAA' }); await tick();
  expect(f.offered).toEqual([]);
  expect(f.errors).toHaveLength(1);
  expect(f.released).toEqual([1]);
  expect(f.requests).toHaveLength(1);
  f.controller.refresh(); await tick(); f.requests[1]!.resolve(f.frame(5)); await tick();
  expect(f.errors).toHaveLength(2);
  expect(f.released).toEqual([1, 5]);
  f.controller.dispose();
});

it('a renderer rejection permits an explicit retry and never automatically loops', async () => {
  const f = fixture(); await tick();
  f.requests[0]!.reject(new Error('decoder unavailable')); await tick();
  expect(f.errors[0]?.message).toBe('decoder unavailable');
  expect(f.requests).toHaveLength(1);
  f.controller.refresh(); await tick();
  expect(f.requests).toHaveLength(2);
  f.requests[1]!.resolve(f.frame(1)); await tick();
  expect(f.image()?.revision).toBe(1);
  f.controller.dispose();
});

it('repeated raw leases cannot dispose an image that is still presented', async () => {
  const f = fixture(); await tick();
  const raw = f.frame(1);
  f.requests[0]!.resolve(raw); await tick();
  const surface = attach(f.image()!); surface.binding.onLoadEnd(loaded(true));
  f.controller.refresh(); await tick(); f.requests[1]!.resolve(raw); await tick();
  expect(f.errors.at(-1)?.message).toMatch(/distinct image lease/);
  expect(f.released).toEqual([]);
  f.controller.dispose(); surface.binding.release();
  expect(f.released).toEqual([1]);
});

it('typed Viro reload events report a later failure and ignore events after detach', async () => {
  const f = fixture(); await tick(); f.requests[0]!.resolve(f.frame(1)); await tick();
  const surface = attach(f.image()!);
  surface.binding.onLoadEnd(loaded(true));
  surface.binding.onLoadStart({ nativeEvent: {} } as Parameters<typeof surface.binding.onLoadStart>[0]);
  surface.binding.onError(failed('texture unavailable'));
  surface.binding.onLoadEnd(loaded(false));
  expect(surface.errors.map(error => error.message)).toEqual(['texture unavailable']);
  expect(f.image()).toBeNull();
  expect(f.released).toEqual([]);
  surface.binding.release();
  surface.binding.onLoadStart({ nativeEvent: {} } as Parameters<typeof surface.binding.onLoadStart>[0]);
  surface.binding.onLoadEnd(loaded(true));
  expect(surface.presented).toEqual([1]);
  expect(f.released).toEqual([1]);
  f.controller.dispose();
});

it('cleanup completes even if subscription removal, disposal and diagnostics throw', async () => {
  let resolve!: (frame: XRPresentationFrame) => void;
  let releaseCount = 0;
  const controller = createXRPresentation({
    source: { getRevision: () => 1, addOnChangedListener: () => ({ remove() { throw Error('remove failed'); } }),
      renderFrame: () => new Promise<XRPresentationFrame>(yes => { resolve = yes; }) },
    onFrame() { throw Error('consumer failed'); },
    onError() { throw Error('diagnostic failed'); },
  });
  await tick();
  resolve({ revision: 1, uri: 'file:///frame.png', widthPx: 20, heightPx: 20, dispose() { releaseCount++; throw Error('release failed'); } });
  await tick();
  expect(releaseCount).toBe(1);
  expect(() => controller.dispose()).not.toThrow();
  expect(releaseCount).toBe(1);
});
