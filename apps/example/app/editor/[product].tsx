import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';
import { Pressable, Text, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ForgeWorkspace, QuillTextEditor, type QuillTextEditorHandle } from '@nitro-forge/studio-workspace';
import { workspaceThemes } from '@nitro-forge/studio-workspace/theme';
import { STUDIOS, type Studio } from '@nitro-forge/studio-layout';
import { useEditorDoc } from '../../src/useDocument';
import { getEditorConfig } from '../../src/editors';

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
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1 }}>
    <Stack.Screen options={{ headerShown: false }} />
    <ForgeWorkspace studioId={studioId} title={config.title} documentTitle={`Untitled ${config.title} document`}
      headerLeading={<Pressable accessibilityRole="button" accessibilityLabel="All apps" onPress={() => router.replace('/')} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}><Text style={{ color: workspaceThemes[theme].text, fontSize: 12 }}>All apps</Text></Pressable>}
      theme={theme} state={doc.state} rows={doc.state ? config.rows(doc.state) : []}
      actions={config.actions.map(action => ({ title: action.title, run: () => action.run(doc) }))}
      onUndo={doc.undo} onRedo={doc.redo} onSave={save} onRefresh={doc.reload}
      busy={!doc.state} error={doc.error}>
      {studioId === 'quill' ? <QuillTextEditor ref={textEditor} theme={theme} documentTitle={`Untitled ${config.title} document`} state={doc.state} apply={doc.apply} reload={doc.reload} /> : undefined}
    </ForgeWorkspace>
  </SafeAreaView>;
}
