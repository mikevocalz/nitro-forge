/** Host-owned peer contract. Runtime resolves to nyc-mon/packages/ui/studio-controls. */
declare module '@acme/ui/studio-controls' {
  export const studioControls: import('@nitro-forge/studio-workspace/ui').StudioUIComponents;
}

/** Fold geometry from the canonical UI (ReservedRegions native module when the
 * host links it; an empty list otherwise). Declared narrowly: the planner's subset. */
declare module '@acme/ui/adaptive-panes' {
  export function useReservedRegions(): readonly import('./persona/persona-dock').DockRegion[];
}
