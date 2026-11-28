import {DevicePairingDialog,type DevicePairingDialogProps} from './DevicePairingDialog.tsx';
export type PenPairingDialogProps=DevicePairingDialogProps;
export type {PairingState,PairingDevice} from './pairing-model.ts';
/** Shared pairing owner preserves linked-versus-verified input and close/cancel semantics. */
export function PenPairingDialog(props:PenPairingDialogProps){return <DevicePairingDialog {...props} title={props.title??'Connect a pen'} deviceNoun={props.deviceNoun??'pen'}/>;}
