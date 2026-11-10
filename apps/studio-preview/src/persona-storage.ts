import { createPersonaStore, type PersonaStoragePort, type PersonaStore } from '@nitro-forge/studio-workspace/personas';

const KEY = 'nitroforge.personas.v1';

/** Browser storage for user personas. A blocked localStorage read loads none;
 * a failed write throws, so the composer reports it instead of claiming a save. */
const browserStorage: PersonaStoragePort = {
  load: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  save: json => { localStorage.setItem(KEY, json); },
};

let shared: PersonaStore | null = null;
/** The preview's Prism document persona session, shared by the editor and the composer. */
export function prismPersonaStore(): PersonaStore {
  if (!shared) shared = createPersonaStore({ surface: 'web', storage: browserStorage });
  return shared;
}
