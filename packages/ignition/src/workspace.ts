/**
 * WorkspaceSession: one open engine document shared by several editing
 * modes, with per-mode panel layouts and layout presets that persist in a
 * host-supplied key-value store (roster A-01 WorkspaceHost, A-02
 * WorkspacePresetSwitcher).
 *
 * The document is opened once and closed once. Switching modes never
 * reopens, snapshots or restores it, so an edit made in one mode is the same
 * engine state every other mode reads. Layouts are opaque JSON values owned
 * by the UI (NYC-Tron's dock layout); this module validates names and ids,
 * stores them, and never interprets dock geometry.
 *
 * Persistence goes through `WorkspaceStore`, which matches MMKV's
 * synchronous `getString`/`set`/`remove` so an app passes its MMKV instance
 * directly. Nothing here imports MMKV.
 */
import { DocumentHandle } from "./document";
import type { EngineHost } from "./host";
import type { EngineKind } from "./types";

/** Synchronous string store. An `MMKV` instance satisfies it. */
export interface WorkspaceStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** A JSON-serializable dock layout. The UI defines its shape. */
export type WorkspaceLayout = unknown;

export interface WorkspaceMode {
  readonly id: string;
  readonly label: string;
  /** Layout used until the user changes it, and restored by `resetLayout`. */
  readonly defaultLayout: WorkspaceLayout;
}

export type BuiltInPresetId = "edit" | "color" | "audio" | "review" | "presentation";

/** Built-in presets are read-only; custom presets can be renamed and deleted. */
export interface WorkspacePreset {
  readonly id: string;
  readonly name: string;
  readonly builtIn: boolean;
  /** Mode to switch to when the preset is selected. */
  readonly modeId: string;
  readonly layout: WorkspaceLayout;
}

export interface WorkspaceState {
  readonly documentId: number;
  readonly kind: EngineKind;
  readonly activeModeId: string;
  readonly activePresetId: string | undefined;
  readonly modes: readonly WorkspaceMode[];
  /** Current layout per mode id. */
  readonly layouts: Readonly<Record<string, WorkspaceLayout>>;
  readonly presets: readonly WorkspacePreset[];
}

export interface WorkspaceOptions {
  /** Store namespace; one per workspace kind (e.g. "prism-studio"). */
  readonly storeKey: string;
  readonly store: WorkspaceStore;
  readonly modes: readonly WorkspaceMode[];
  readonly initialModeId?: string;
  /** Built-in presets. Their ids must not collide with custom ones. */
  readonly builtInPresets?: readonly Omit<WorkspacePreset, "builtIn">[];
}

/** Longest preset name, in UTF-16 code units, after trimming. */
export const PRESET_NAME_MAX = 40;

const STORE_VERSION = 1;

interface Persisted {
  v: number;
  activeModeId: string;
  activePresetId?: string | undefined;
  layouts: Record<string, WorkspaceLayout>;
  custom: { id: string; name: string; modeId: string; layout: WorkspaceLayout }[];
  nextCustom: number;
}

export class WorkspaceError extends Error {
  constructor(
    readonly code: "invalid-mode" | "invalid-preset" | "invalid-name" | "read-only" | "closed",
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export class WorkspaceSession {
  private listeners = new Set<(s: WorkspaceState) => void>();
  private closed = false;

  private constructor(
    readonly document: DocumentHandle,
    private readonly opts: WorkspaceOptions,
    private data: Persisted,
  ) {}

  /** Opens the engine document once and restores persisted layouts. */
  static async open(host: EngineHost, kind: EngineKind, opts: WorkspaceOptions): Promise<WorkspaceSession> {
    validateModes(opts);
    opts=copyOptions(opts);
    const data = loadPersisted(opts);
    const document = await DocumentHandle.open(host, kind);
    return new WorkspaceSession(document, opts, data);
  }

  /** Wraps an already-open document (e.g. one restored from a file). */
  static attach(document: DocumentHandle, opts: WorkspaceOptions): WorkspaceSession {
    validateModes(opts);
    opts=copyOptions(opts);
    return new WorkspaceSession(document, opts, loadPersisted(opts));
  }

  get state(): WorkspaceState {
    const builtIns: WorkspacePreset[] = (this.opts.builtInPresets ?? []).map((p) => ({ ...p, builtIn: true }));
    const custom: WorkspacePreset[] = this.data.custom.map((p) => ({ ...p, builtIn: false }));
    const layouts: Record<string, WorkspaceLayout> = {};
    for (const m of this.opts.modes) layouts[m.id] = this.data.layouts[m.id] ?? m.defaultLayout;
    return JSON.parse(JSON.stringify({
      documentId: this.document.id,
      kind: this.document.kind,
      activeModeId: this.data.activeModeId,
      activePresetId: this.data.activePresetId,
      modes: this.opts.modes,
      layouts,
      presets: [...builtIns, ...custom],
    })) as WorkspaceState;
  }

  subscribe(listener: (s: WorkspaceState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setMode(modeId: string): WorkspaceState {
    this.assertOpen();
    this.requireMode(modeId);
    if (modeId === this.data.activeModeId) return this.state;
    return this.commit({ ...this.data, activeModeId: modeId, activePresetId: undefined });
  }

  setLayout(modeId: string, layout: WorkspaceLayout): WorkspaceState {
    this.assertOpen();
    this.requireMode(modeId);
    const serialized = JSON.stringify(layout);
    if (serialized === undefined) throw new WorkspaceError("invalid-preset", "layout must be JSON-serializable");
    return this.commit({
      ...this.data,
      layouts: { ...this.data.layouts, [modeId]: JSON.parse(serialized) as WorkspaceLayout },
      activePresetId: undefined,
    });
  }

  resetLayout(modeId: string): WorkspaceState {
    this.assertOpen();
    this.requireMode(modeId);
    const layouts = { ...this.data.layouts };
    delete layouts[modeId];
    return this.commit({ ...this.data, layouts, activePresetId: undefined });
  }

  /** Applies a preset: switches to its mode and loads its layout. */
  selectPreset(presetId: string): WorkspaceState {
    this.assertOpen();
    const preset = this.requirePreset(presetId);
    return this.commit({
      ...this.data,
      activeModeId: preset.modeId,
      activePresetId: preset.id,
      layouts: { ...this.data.layouts, [preset.modeId]: preset.layout },
    });
  }

  /** Saves the active mode's current layout as a new custom preset. */
  saveAsPreset(name: string): { state: WorkspaceState; presetId: string } {
    this.assertOpen();
    const clean = this.validName(name);
    const id = `custom-${this.data.nextCustom}`;
    const modeId = this.data.activeModeId;
    const layout = this.state.layouts[modeId];
    const state = this.commit({
      ...this.data,
      nextCustom: this.data.nextCustom + 1,
      custom: [...this.data.custom, { id, name: clean, modeId, layout }],
      activePresetId: id,
    });
    return { state, presetId: id };
  }

  renamePreset(presetId: string, name: string): WorkspaceState {
    this.assertOpen();
    this.requireCustom(presetId);
    const clean = this.validName(name, presetId);
    return this.commit({
      ...this.data,
      custom: this.data.custom.map((p) => (p.id === presetId ? { ...p, name: clean } : p)),
    });
  }

  duplicatePreset(presetId: string): { state: WorkspaceState; presetId: string } {
    this.assertOpen();
    const source = this.requirePreset(presetId);
    const name = this.uniqueCopyName(source.name);
    const id = `custom-${this.data.nextCustom}`;
    const state = this.commit({
      ...this.data,
      nextCustom: this.data.nextCustom + 1,
      custom: [...this.data.custom, { id, name, modeId: source.modeId, layout: source.layout }],
    });
    return { state, presetId: id };
  }

  /** Deletes a custom preset and returns it so the UI can offer Undo via `restorePreset`. */
  deletePreset(presetId: string): { state: WorkspaceState; deleted: WorkspacePreset; index: number } {
    this.assertOpen();
    this.requireCustom(presetId);
    const index = this.data.custom.findIndex((p) => p.id === presetId);
    const removed = this.data.custom[index]!;
    const state = this.commit({
      ...this.data,
      custom: this.data.custom.filter((p) => p.id !== presetId),
      activePresetId: this.data.activePresetId === presetId ? undefined : this.data.activePresetId,
    });
    return { state, deleted: { ...removed, builtIn: false }, index };
  }

  /** Puts back a preset returned by `deletePreset`, at its old position. */
  restorePreset(preset: WorkspacePreset, index: number): WorkspaceState {
    this.assertOpen();
    if (preset.builtIn) throw new WorkspaceError("read-only", "built-in presets are never deleted");
    if (this.allPresets().some((p) => p.id === preset.id)) {
      throw new WorkspaceError("invalid-preset", `preset ${preset.id} already exists`);
    }
    this.requireMode(preset.modeId);
    const clean = this.validName(preset.name);
    const custom = [...this.data.custom];
    custom.splice(Math.max(0, Math.min(index, custom.length)), 0, {
      id: preset.id,
      name: clean,
      modeId: preset.modeId,
      layout: preset.layout,
    });
    return this.commit({ ...this.data, custom });
  }

  /** Built-in preset "Reset to default": restores its mode's default layout. */
  resetPreset(presetId: string): WorkspaceState {
    this.assertOpen();
    const preset = this.requirePreset(presetId);
    if (!preset.builtIn) throw new WorkspaceError("read-only", "only built-in presets have a default to reset to");
    return this.selectPreset(presetId);
  }

  /** Closes the document exactly once. Layout state is already persisted. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    await this.document.close();
  }

  // -- internals -----------------------------------------------------------

  private commit(next: Persisted): WorkspaceState {
    // Persist before notifying: a listener that throws must not leave the
    // store behind the in-memory state.
    this.opts.store.set(this.opts.storeKey, JSON.stringify(next));
    this.data = next;
    const state = this.state;
    for (const l of this.listeners) l(state);
    return state;
  }

  private assertOpen(): void {
    if (this.closed) throw new WorkspaceError("closed", "workspace is closed");
  }

  private requireMode(modeId: string): void {
    if (!this.opts.modes.some((m) => m.id === modeId)) {
      throw new WorkspaceError("invalid-mode", `unknown mode '${modeId}'`);
    }
  }

  private allPresets(): WorkspacePreset[] {
    return this.state.presets as WorkspacePreset[];
  }

  private requirePreset(presetId: string): WorkspacePreset {
    const p = this.allPresets().find((x) => x.id === presetId);
    if (!p) throw new WorkspaceError("invalid-preset", `unknown preset '${presetId}'`);
    return p;
  }

  private requireCustom(presetId: string): void {
    const p = this.requirePreset(presetId);
    if (p.builtIn) throw new WorkspaceError("read-only", `preset '${p.name}' is built in`);
  }

  private validName(name: string, exceptId?: string): string {
    const clean = name.trim();
    if (clean.length === 0) throw new WorkspaceError("invalid-name", "preset name is empty");
    if (clean.length > PRESET_NAME_MAX) {
      throw new WorkspaceError("invalid-name", `preset name is longer than ${PRESET_NAME_MAX} characters`);
    }
    const lower = clean.toLocaleLowerCase();
    if (this.allPresets().some((p) => p.id !== exceptId && p.name.toLocaleLowerCase() === lower)) {
      throw new WorkspaceError("invalid-name", `a preset named '${clean}' already exists`);
    }
    return clean;
  }

  private uniqueCopyName(base: string): string {
    const taken = new Set(this.allPresets().map((p) => p.name.toLocaleLowerCase()));
    for (let n = 1; ; n++) {
      const suffix = n === 1 ? " copy" : ` copy ${n}`;
      const name = base.slice(0, PRESET_NAME_MAX - suffix.length) + suffix;
      if (!taken.has(name.toLocaleLowerCase())) return name;
    }
  }
}

function validateModes(opts: WorkspaceOptions): void {
  if (opts.modes.length === 0) throw new WorkspaceError("invalid-mode", "a workspace needs at least one mode");
  const ids = new Set<string>();
  for (const m of opts.modes) {
    if (!m.id || ids.has(m.id)) throw new WorkspaceError("invalid-mode", `duplicate or empty mode id '${m.id}'`);
    if(!m.label.trim())throw new WorkspaceError("invalid-mode","mode label is empty");
    cloneLayout(m.defaultLayout);
    ids.add(m.id);
  }
  if (opts.initialModeId !== undefined && !ids.has(opts.initialModeId)) {
    throw new WorkspaceError("invalid-mode", `unknown initial mode '${opts.initialModeId}'`);
  }
  const presetIds=new Set<string>(),names=new Set<string>();
  for (const p of opts.builtInPresets ?? []) {
    if(!p.id||presetIds.has(p.id)||!p.name.trim()||p.name.trim().length>PRESET_NAME_MAX||names.has(p.name.trim().toLocaleLowerCase()))throw new WorkspaceError("invalid-preset","duplicate or invalid built-in preset");
    presetIds.add(p.id);names.add(p.name.trim().toLocaleLowerCase());cloneLayout(p.layout);
    if (!ids.has(p.modeId)) throw new WorkspaceError("invalid-preset", `preset '${p.id}' targets unknown mode`);
    if (p.id.startsWith("custom-")) throw new WorkspaceError("invalid-preset", "built-in ids must not start with 'custom-'");
  }
}

/**
 * Reads the persisted record. A missing, corrupt or older record falls back
 * to defaults instead of failing to open the document; stale mode ids and
 * presets pointing at removed modes are dropped.
 */
function loadPersisted(opts: WorkspaceOptions): Persisted {
  const fallback: Persisted = {
    v: STORE_VERSION,
    activeModeId: opts.initialModeId ?? opts.modes[0]!.id,
    layouts: {},
    custom: [],
    nextCustom: 1,
  };
  const raw = opts.store.getString(opts.storeKey);
  if (raw === undefined) return fallback;
  let parsed: Partial<Persisted>;
  try {
    parsed = JSON.parse(raw) as Partial<Persisted>;
  } catch {
    return fallback;
  }
  if (typeof parsed !== "object" || parsed === null || parsed.v !== STORE_VERSION) return fallback;
  const modeIds = new Set(opts.modes.map((m) => m.id));
  const layouts: Record<string, WorkspaceLayout> = {};
  for (const [k, v] of Object.entries(parsed.layouts ?? {})) if (modeIds.has(k)) layouts[k] = v;
  const seenIds=new Set((opts.builtInPresets??[]).map(p=>p.id));
  const seenNames=new Set((opts.builtInPresets??[]).map(p=>p.name.toLocaleLowerCase()));
  const custom:Persisted['custom']=[];
  for(const p of Array.isArray(parsed.custom)?parsed.custom:[]){
    if(!p||typeof p.id!=='string'||!/^custom-[1-9]\d*$/.test(p.id)||!Number.isSafeInteger(Number(p.id.slice(7)))||seenIds.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>PRESET_NAME_MAX||seenNames.has(p.name.trim().toLocaleLowerCase())||!modeIds.has(p.modeId))continue;
    seenIds.add(p.id);seenNames.add(p.name.trim().toLocaleLowerCase());custom.push({...p,name:p.name.trim()});
  }
  const activeModeId =
    typeof parsed.activeModeId === "string" && modeIds.has(parsed.activeModeId)
      ? parsed.activeModeId
      : fallback.activeModeId;
  const presetIds = new Set([...(opts.builtInPresets ?? []).map((p) => p.id), ...custom.map((p) => p.id)]);
  const highest = custom.reduce((n, p) => Math.max(n, Number(p.id.replace("custom-", "")) || 0), 0);
  return {
    v: STORE_VERSION,
    activeModeId,
    activePresetId:
      typeof parsed.activePresetId === "string" && presetIds.has(parsed.activePresetId)
        ? parsed.activePresetId
        : undefined,
    layouts,
    custom,
    nextCustom: Math.max(Number.isSafeInteger(parsed.nextCustom)&&Number(parsed.nextCustom)>0?Number(parsed.nextCustom):1, highest + 1),
  };
}

function cloneLayout(value:unknown):WorkspaceLayout {
 const text=JSON.stringify(value);if(text===undefined)throw new WorkspaceError('invalid-preset','layout must be JSON-serializable');return JSON.parse(text) as WorkspaceLayout;
}
function copyOptions(opts:WorkspaceOptions):WorkspaceOptions {
 return {...opts,modes:opts.modes.map(m=>({...m,defaultLayout:cloneLayout(m.defaultLayout)})),...(opts.builtInPresets?{builtInPresets:opts.builtInPresets.map(p=>({...p,layout:cloneLayout(p.layout)}))}:{})};
}
