import {ViroImage} from '@reactvision/react-viro';
import {useLayoutEffect,useRef,type ComponentProps} from 'react';
import {createStore,type StoreApi} from 'zustand/vanilla';
import {useStore} from 'zustand';
import type {XRPresentationImage} from './presentation';
import {createViroLoadBinding,type ViroLoadBinding} from './viro-load-binding';

/** Props for the actual Viro image surface; mount inside the app's existing Viro scene. */
export interface ViroDocumentSurfaceProps {
  readonly frame: XRPresentationImage;
  /** Physical width in metres. Height preserves the rendered document's aspect ratio. */
  readonly widthMeters: number;
  readonly position: [number,number,number];
  /** Viro Euler angles in degrees; the app's layout owns placement. */
  readonly rotation?: [number,number,number];
  readonly onPresented: (revision: number) => void;
  readonly onError: (error: Error) => void;
  /** Input passes to the existing world-to-document router. No edits occur in this leaf. */
  readonly onClickState?: ComponentProps<typeof ViroImage>['onClickState'];
  readonly onHover?: ComponentProps<typeof ViroImage>['onHover'];
}

/**
 * Optional native Viro presentation for compatible visionOS, PICO and Quest hosts.
 * This leaf alone imports Viro; portable Board imports remain independent. App
 * lifecycle, device capability, origin transforms and document authority stay outside it.
 */
export function ViroDocumentSurface({frame,widthMeters,position,rotation,onPresented,onError,onClickState,onHover}:ViroDocumentSurfaceProps){
  const callbacks=useRef({onPresented,onError});
  useLayoutEffect(()=>{callbacks.current={onPresented,onError};},[onPresented,onError]);
  const local=useRef<StoreApi<{binding:ViroLoadBinding|null}>|null>(null);
  local.current??=createStore(()=>({binding:null as ViroLoadBinding|null}));
  const store=local.current;
  const binding=useStore(store,state=>state.binding);
  useLayoutEffect(()=>{
    // Acquire after commit: an abandoned concurrent render must not leak a lease.
    const next=createViroLoadBinding(frame,()=>callbacks.current);
    store.setState({binding:next});
    return()=>next?.release();
  },[frame,store]);
  const heightMeters=widthMeters*frame.heightPx/frame.widthPx;
  if(!Number.isFinite(widthMeters)||widthMeters<=0||!Number.isFinite(heightMeters)||heightMeters<=0||position.length!==3||!position.every(Number.isFinite)||rotation&&(rotation.length!==3||!rotation.every(Number.isFinite)))throw new RangeError('XR placement requires finite coordinates and positive dimensions in metres.');
  if(!binding||binding.image!==frame)return null;
  return <ViroImage key={`${frame.revision}:${frame.uri}`} source={{uri:frame.uri}} width={widthMeters} height={widthMeters*frame.heightPx/frame.widthPx}
    position={position} {...(rotation?{rotation}:{})} resizeMode="ScaleToFit"
    {...(onClickState?{onClickState}:{})} {...(onHover?{onHover}:{})}
    onLoadStart={binding.onLoadStart} onLoadEnd={binding.onLoadEnd} onError={binding.onError}/>;
}
