import type { ViroImage } from '@reactvision/react-viro';
import type { ComponentProps } from 'react';
import type { XRPresentationImage } from './presentation';

type NativeImageProps = ComponentProps<typeof ViroImage>;
interface Callbacks { onPresented(revision: number): void; onError(error: Error): void }

/** Commit-time binding to the actual ViroImage callback types. */
export function createViroLoadBinding(image: XRPresentationImage, callbacks: () => Callbacks) {
  const lease = image.retain();
  if (!lease) return null;
  let active = true;
  let settled = false;
  const failure = (error: Error) => {
    if (!active || settled) return;
    settled = true;
    if (image.failed()) callbacks().onError(error);
  };
  const onLoadEnd: NonNullable<NativeImageProps['onLoadEnd']> = event => {
    if (!active || settled) return;
    if (!event.nativeEvent.success) { failure(new Error(`XR image loading failed at revision ${image.revision}.`)); return; }
    settled = true;
    if (image.loaded()) callbacks().onPresented(image.revision);
  };
  const onError: NonNullable<NativeImageProps['onError']> = event => failure(
    event.nativeEvent.error instanceof Error ? event.nativeEvent.error : new Error(String(event.nativeEvent.error)),
  );
  const onLoadStart: NonNullable<NativeImageProps['onLoadStart']> = () => { if (active) settled = false; };
  return { image, onLoadStart, onLoadEnd, onError, release() { if (active) { active = false; lease.release(); } } };
}
export type ViroLoadBinding = NonNullable<ReturnType<typeof createViroLoadBinding>>;
