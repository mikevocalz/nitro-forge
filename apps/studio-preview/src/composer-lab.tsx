import { ComposerGlyph, PersonaComposer } from '@nitro-forge/studio-workspace/composer';
import { Button, ScrollView, View } from '@nitro-forge/studio-workspace/ui';
import { prismThemes } from '@nitro-forge/studio-workspace/theme';
import { prismPersonaStore } from './persona-storage';

/** Hash route for the Persona Composer. */
export const COMPOSER_LAB_HASH = '#/lab/composer';

/** True when the preview is on the composer route. */
export function isComposerLabRoute(hash: string = window.location.hash): boolean {
  return hash === COMPOSER_LAB_HASH;
}

/** Persona Composer against the same store the Prism editor uses. */
export function ComposerLab({ theme }: { theme: 'dark' | 'light' }) {
  return <ScrollView style={{ flex: 1, backgroundColor: prismThemes[theme].base }} contentContainerStyle={{ maxWidth: 1200, width: '100%', alignSelf: 'center' }}>
    <View style={{ paddingHorizontal: 8, paddingTop: 8, alignItems: 'flex-start' }}>
      {/* Kit buttons carry a 48 px min-height target at every size. */}
      <Button title="Back to Prism" icon={<span className="back-chevron"><ComposerGlyph name="chevron-left" color={prismThemes[theme].accent} /></span>}
        onPress={() => { window.location.hash = '#/apps/prism'; }} variant="ghost" size="sm" tone="carolina" cornerRadius={4} className="rounded-[4px] border border-transparent" />
    </View>
    <PersonaComposer store={prismPersonaStore()} theme={theme}
      onExportPersona={async json => { await navigator.clipboard.writeText(json); return 'copied'; }} />
  </ScrollView>;
}
