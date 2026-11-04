import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  BUILT_IN_PERSONAS, composePersona, exportPersona, importPersona, switchPersona,
  type ContinuityState, type PersonaDraft, type PersonaSpec, type PersonaSurface,
} from './persona.ts';

/** Host-supplied durable storage for user personas (MMKV on native, a file
 * or browser storage on web). The store never chooses a backend itself. */
export type PersonaStoragePort = Readonly<{
  load: () => string | null;
  save: (json: string) => void;
}>;

export type PersonaStoreState = Readonly<{
  surface: PersonaSurface;
  personas: readonly PersonaSpec[];
  activeId: string;
  continuity: ContinuityState;
  /** Last failure from switching, composing or importing, in plain words. */
  error: string | null;
}>;

export type PersonaStoreActions = Readonly<{
  switchTo: (personaId: string) => void;
  setContinuity: (patch: Partial<ContinuityState>) => void;
  compose: (draft: PersonaDraft) => PersonaSpec;
  importJson: (json: string) => PersonaSpec;
  exportJson: (personaId: string) => string;
  remove: (personaId: string) => void;
  clearError: () => void;
}>;

export type PersonaStore = StoreApi<PersonaStoreState & PersonaStoreActions>;

const INITIAL_CONTINUITY: ContinuityState = { selectedLayerId: undefined, viewport: { zoom: 1, panX: 0, panY: 0 }, color: [255, 255, 255, 255], brushSizePx: 8 };
const STORAGE_FORMAT = 1;

function readUserPersonas(storage: PersonaStoragePort | undefined): PersonaSpec[] {
  const raw = storage?.load();
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || (parsed as { format?: unknown }).format !== STORAGE_FORMAT || !Array.isArray((parsed as { personas?: unknown }).personas))
    throw new Error('Saved personas use an unknown format');
  const out: PersonaSpec[] = [];
  for (const item of (parsed as { personas: unknown[] }).personas) out.push(importPersona(JSON.stringify({ format: 1, ...(item as object) }), [...BUILT_IN_PERSONAS, ...out]));
  return out;
}

/** One persona session per open design document. Personas hold no document
 * state; edits and undo stay in the engine, continuity travels by reference. */
export function createPersonaStore(options: { surface: PersonaSurface; storage?: PersonaStoragePort; initialPersonaId?: string }): PersonaStore {
  let user: PersonaSpec[] = [];
  let error: string | null = null;
  try { user = readUserPersonas(options.storage); } catch (e) { error = `Saved personas could not be read: ${e instanceof Error ? e.message : String(e)}`; }
  const persist = (personas: readonly PersonaSpec[]) => {
    if (!options.storage) return;
    const userOnly = personas.filter(p => !p.builtIn).map(p => JSON.parse(exportPersona(p)) as object);
    options.storage.save(JSON.stringify({ format: STORAGE_FORMAT, personas: userOnly }));
  };
  const personas = [...BUILT_IN_PERSONAS, ...user];
  const initial = personas.find(p => p.id === options.initialPersonaId) ?? personas.find(p => p.id === 'vector')!;
  return createStore<PersonaStoreState & PersonaStoreActions>((set, get) => ({
    surface: options.surface,
    personas,
    activeId: initial.id,
    continuity: INITIAL_CONTINUITY,
    error,
    switchTo: personaId => {
      try {
        const next = switchPersona({ personaId: get().activeId, continuity: get().continuity }, personaId, get().personas, get().surface);
        set({ activeId: next.personaId, error: null });
      } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
    },
    setContinuity: patch => set({ continuity: { ...get().continuity, ...patch } }),
    compose: draft => {
      const persona = composePersona(draft, get().personas);
      const next = [...get().personas, persona];
      persist(next);
      set({ personas: next, error: null });
      return persona;
    },
    importJson: json => {
      const persona = importPersona(json, get().personas);
      const next = [...get().personas, persona];
      persist(next);
      set({ personas: next, error: null });
      return persona;
    },
    exportJson: personaId => {
      const persona = get().personas.find(p => p.id === personaId);
      if (!persona) throw new Error(`Unknown persona '${personaId}'`);
      return exportPersona(persona);
    },
    remove: personaId => {
      const persona = get().personas.find(p => p.id === personaId);
      if (!persona) throw new Error(`Unknown persona '${personaId}'`);
      if (persona.builtIn) throw new Error(`'${persona.label}' is built in and cannot be removed`);
      const next = get().personas.filter(p => p.id !== personaId);
      persist(next);
      set({ personas: next, activeId: get().activeId === personaId ? 'vector' : get().activeId });
    },
    clearError: () => set({ error: null }),
  }));
}
