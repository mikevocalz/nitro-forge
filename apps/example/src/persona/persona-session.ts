import { Platform } from 'react-native';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createPersonaStore, type PersonaStore } from '@nitro-forge/studio-workspace/personas';

/** Host-side panel state. `peeking` mirrors the turret's open peek from its
 * effects (detent opens one; commit and cancel close it). `turretKey`
 * remounts the turret, which drops a peek back to the committed persona:
 * PersonaTurret exposes no cancel input, so this is the host's only way to
 * cancel from outside (Android Back). */
export type PersonaHostState = Readonly<{ open: boolean; peeking: boolean; turretKey: number }>;

export type PersonaSession = Readonly<{ personas: PersonaStore; ui: StoreApi<PersonaHostState> }>;

type Entry = { session: PersonaSession; holders: number };
const sessions = new Map<string, Entry>();

type PersonaSurface = Parameters<typeof createPersonaStore>[0]['surface'];
const hostSurface = (): PersonaSurface =>
  Platform.OS === 'ios' ? ((Platform as { isPad?: boolean }).isPad ? 'ipad' : 'iphone') : Platform.OS === 'android' ? 'android-phone' : 'web';

/** One persona session per open document, shared by the editor and the sheet route. */
export function acquirePersonaSession(key: string): PersonaSession {
  const existing = sessions.get(key);
  if (existing) { existing.holders += 1; return existing.session; }
  const session: PersonaSession = {
    personas: createPersonaStore({ surface: hostSurface() }),
    ui: createStore<PersonaHostState>(() => ({ open: false, peeking: false, turretKey: 0 })),
  };
  sessions.set(key, { session, holders: 1 });
  return session;
}

export function releasePersonaSession(key: string): void {
  const entry = sessions.get(key);
  if (!entry) return;
  entry.holders -= 1;
  if (entry.holders <= 0) sessions.delete(key);
}

/** The sheet route looks the session up; it never creates one. */
export function findPersonaSession(key: string | undefined): PersonaSession | undefined {
  return key ? sessions.get(key)?.session : undefined;
}
