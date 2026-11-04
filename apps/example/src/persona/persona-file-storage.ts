import { File, Paths } from 'expo-file-system';
import type { PersonaStoragePort } from '@nitro-forge/studio-workspace/personas';

/** User personas live in the app's document directory, which the OS does
 * not purge. MMKV is the usual choice, but react-native-mmkv 4.x is built
 * for Nitro 0.35 and this app runs Nitro v1, so a plain JSON file is used.
 * A missing file means no saved personas; read and write failures throw so
 * the persona store reports them instead of claiming a save. */
export function personaFileStorage(name = 'personas.v1.json'): PersonaStoragePort {
  const file = new File(Paths.document, name);
  return {
    load: () => (file.exists ? file.textSync() : null),
    save: json => { file.writeSync(json); },
  };
}
