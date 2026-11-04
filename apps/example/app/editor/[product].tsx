import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';
import { useColorScheme } from 'react-native';
import { Button } from '@nitro-forge/studio-workspace/ui';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ForgeWorkspace, QuillTextEditor, type QuillTextEditorHandle } from '@nitro-forge/studio-workspace';
import { PrismEditor } from '@nitro-forge/studio-workspace/prism';
import { STUDIOS, type Studio } from '@nitro-forge/studio-layout';
import { useEditorDoc } from '../../src/useDocument';
import { getEditorConfig } from '../../src/editors';
import { PersonaDock, usePersonaPlacement, usePersonaSession } from '../../src/persona/persona-placement-host';
import { playTurretHaptic } from '../../src/persona/turret-haptics-driver';

export default function EditorScreen() {
  const { product } = useLocalSearchParams<{ product: string }>();
  const studioId: Studio = STUDIOS.find(id => id === product) ?? 'prism';
  // Each studio owns its document session. Pending actions from the previous
  // studio retain its unmounted hook and cannot dispatch to the next engine.
  return <StudioEditor key={studioId} studioId={studioId} />;
}

function StudioEditor({ studioId }: { studioId: Studio }) {
  const router = useRouter();
  const theme = useColorScheme() === 'light' ? 'light' : 'dark';
  const config = useMemo(() => getEditorConfig(studioId), [studioId]);
  const open = useCallback(config.open, [config]);
  const doc = useEditorDoc(open);
  const textEditor = useRef<QuillTextEditorHandle>(null);
  const save = async () => { await textEditor.current?.flush(); return doc.save(); };
  // One persona session per Prism document, shared with the sheet route.
  const personaKey = `persona:${studioId}`;
  const personas = usePersonaSession(personaKey);
  const placement = usePersonaPlacement(personas);
  // Phones present the sheet route, two-pane foldables the docked panel;
  // regular-width windows keep PrismEditor's own inline panel.
  const openPersonas = placement.mode === 'sheet' ? () => router.push({ pathname: '/personas', params: { session: personaKey } })
    : placement.mode === 'dock' ? () => personas.ui.setState({ open: true }) : undefined;
  const prism = studioId === 'prism';
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1 }}>
    <Stack.Screen options={{ headerShown: false }} />
    <ForgeWorkspace studioId={studioId} title={config.title} documentTitle={`Untitled ${config.title} document`}
      headerLeading={<Button title="All apps" aria-label="All apps" onPress={() => router.replace('/')} variant="ghost" tone="carolina" size="sm" cornerRadius={4} className="rounded-[4px]" />}
      theme={theme} state={doc.state} rows={doc.state ? config.rows(doc.state) : []}
      actions={config.actions.map(action => ({ title: action.title, run: () => action.run(doc) }))}
      onUndo={doc.undo} onRedo={doc.redo} onSave={save} onRefresh={doc.reload}
      busy={!doc.state} error={doc.error}>
      {studioId === 'quill' ? <QuillTextEditor ref={textEditor} theme={theme} documentTitle={`Untitled ${config.title} document`} state={doc.state} apply={doc.apply} reload={doc.reload} /> : studioId === 'prism' ? <PrismEditor state={doc.state} theme={theme} apply={doc.apply} reload={doc.reload} busy={!doc.state} personas={personas.personas} onPersonaEffect={playTurretHaptic} {...(openPersonas ? { onOpenPersonas: openPersonas } : {})} /> : undefined}
    </ForgeWorkspace>
    {prism && <PersonaDock session={personas} sessionKey={personaKey} placement={placement} />}
  </SafeAreaView>;
}
