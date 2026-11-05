import type { PersonaStoragePort } from '@nitro-forge/studio-workspace/personas';

/** The web export has no document directory: expo-file-system's `File` throws
 * on construction in a browser, which blanked every editor route. Personas go
 * to localStorage under the file's name instead. A blocked read loads none; a
 * failed write throws, so the persona store reports it instead of claiming a save. */
export function personaFileStorage(name = 'personas.v1.json'): PersonaStoragePort {
  const key = `nitroforge.${name}`;
  return {
    load: () => { try { return localStorage.getItem(key); } catch { return null; } },
    save: json => { localStorage.setItem(key, json); },
  };
}
