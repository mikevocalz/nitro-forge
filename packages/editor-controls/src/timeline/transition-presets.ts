import type {TransitionTarget} from "./transitions.ts";

/**
 * Transition kinds for `TransitionPresetBrowser` (D-37). The default list is
 * the set Splice stores (`addTransition` `kind`); a host with a different
 * engine passes its own. Nothing here renders video: there is no compositor
 * yet, so each kind is shown as a drawn diagram, not a preview.
 */
export interface TransitionKindInfo {
  readonly kind:string;
  readonly label:string;
  readonly description:string;
  /** Which cuts take it: video and overlay tracks, or audio tracks. */
  readonly tracks:TransitionTarget;
}

export const TRANSITION_KINDS:readonly TransitionKindInfo[]=[
  {kind:"cross_dissolve",label:"Cross dissolve",description:"The first clip fades out while the second fades in.",tracks:"visual"},
  {kind:"dip_to_black",label:"Dip to black",description:"Fades to black, then up into the second clip.",tracks:"visual"},
  {kind:"dip_to_white",label:"Dip to white",description:"Fades to white, then down into the second clip.",tracks:"visual"},
  {kind:"wipe_left",label:"Wipe left",description:"An edge sweeps right to left, revealing the second clip.",tracks:"visual"},
  {kind:"wipe_right",label:"Wipe right",description:"An edge sweeps left to right, revealing the second clip.",tracks:"visual"},
  {kind:"push_left",label:"Push left",description:"The second clip slides in from the right and pushes the first out.",tracks:"visual"},
  {kind:"push_right",label:"Push right",description:"The second clip slides in from the left and pushes the first out.",tracks:"visual"},
  {kind:"cross_fade",label:"Crossfade",description:"Audio: the first clip fades down as the second fades up.",tracks:"audio"},
];

/** How the browser draws a kind: two tiles that overlap, dip through a fill, or meet at a moving edge. */
export type TransitionDiagram=
  |{readonly shape:"overlap"}
  |{readonly shape:"dip";readonly through:"black"|"white"}
  |{readonly shape:"wipe"|"push";readonly direction:"left"|"right"};

/** The diagram for `kind`; unknown kinds draw as an overlap. */
export function transitionDiagram(kind:string):TransitionDiagram{
  if(kind==="dip_to_black")return {shape:"dip",through:"black"};
  if(kind==="dip_to_white")return {shape:"dip",through:"white"};
  const m=/^(wipe|push)_(left|right)$/.exec(kind);
  if(m)return {shape:m[1] as "wipe"|"push",direction:m[2] as "left"|"right"};
  return {shape:"overlap"};
}

/** Kinds whose label or description contains `query` (case-insensitive), for `target` cuts when given. */
export function filterTransitionKinds(kinds:readonly TransitionKindInfo[],query:string,target?:TransitionTarget):TransitionKindInfo[]{
  const q=query.trim().toLowerCase();
  return kinds.filter(k=>(!target||k.tracks===target)&&(!q||k.label.toLowerCase().includes(q)||k.description.toLowerCase().includes(q)));
}
