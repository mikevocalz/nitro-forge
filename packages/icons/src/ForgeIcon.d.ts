import type {ReactElement,ReactNode} from "react";
import type {PressableProps} from "react-native";
import type {ForgeIconOptions,ForgeIconSize} from "./index.js";

/** Props passed to a host-supplied Rive renderer by {@linkcode ForgeIcon}. */
export interface ForgeIconRiveRequest {
 readonly name:string;readonly selected:boolean;readonly disabled:boolean;
 readonly loading:boolean;readonly pressed:boolean;readonly hovered:boolean;
 readonly status:"idle"|"success"|"error"|"recording";readonly color:string;
 readonly size:number;readonly reducedMotion:boolean;
 readonly artboard:"ForgeIcon";readonly stateMachine:"ForgeIconStates";
}
/** Props for {@linkcode ForgeIcon}. `name` is a catalog ID such as `vector/pen`. */
export interface ForgeIconProps extends ForgeIconOptions {
 name:string;
 /** Return a Rive view to replace the SVG fallback; return null to keep it. */
 renderRive?:(request:ForgeIconRiveRequest)=>ReactNode;
 testID?:string;
}
/** Outline when idle, filled when selected. Renders null when `name` has no finished artwork. */
export function ForgeIcon(props:ForgeIconProps):ReactElement|null;
/** Props for {@linkcode ForgeIconButton}. `label` is required and must not be blank. */
export interface ForgeIconButtonProps extends Omit<ForgeIconProps,"pressed">,
 Pick<PressableProps,"onPress"|"hitSlop"> {
 label:string;size?:number|ForgeIconSize;
}
/** 44pt minimum icon button with button role, label and selected/disabled/busy state. */
export function ForgeIconButton(props:ForgeIconButtonProps):ReactElement;
