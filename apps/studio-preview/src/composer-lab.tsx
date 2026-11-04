import { useMemo } from 'react';
import { createPersonaStore, type PersonaStoragePort } from '@nitro-forge/studio-workspace/personas';
import { PersonaComposer } from '@nitro-forge/studio-workspace/composer';
import { ScrollView } from '@nitro-forge/studio-workspace/ui';
import { prismThemes } from '@nitro-forge/studio-workspace/theme';

/** Hash route for the Persona Composer lab. */
export const COMPOSER_LAB_HASH = '#/lab/composer';

/** True when the preview is on the composer lab route. */
export function isComposerLabRoute(hash: string = window.location.hash): boolean {
  return hash === COMPOSER_LAB_HASH;
}

const KEY = 'nitroforge.personas.v1';

/** Browser storage port for the lab. Failures surface through the store's error. */
const browserStorage: PersonaStoragePort = {
  load: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  save: json => { localStorage.setItem(KEY, json); },
};

/** Persona Composer against a real PersonaStore on the web surface. */
export function ComposerLab({ theme }: { theme: 'dark' | 'light' }) {
  const store = useMemo(() => createPersonaStore({ surface: 'web', storage: browserStorage }), []);
  return <ScrollView style={{ flex: 1, backgroundColor: prismThemes[theme].base }} contentContainerStyle={{ maxWidth: 1200, width: '100%', alignSelf: 'center' }}>
    <PersonaComposer store={store} theme={theme}
      onExportPersona={async json => { await navigator.clipboard.writeText(json); return 'copied'; }} />
  </ScrollView>;
}
