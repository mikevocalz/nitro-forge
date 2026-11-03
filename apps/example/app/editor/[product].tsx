import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ForgeWorkspace, QuillTextEditor, type QuillTextEditorHandle } from '@nitro-forge/studio-workspace';
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
  const theme = useColorScheme() === 'light' ? 'light' : 'dark';
  const config = useMemo(() => getEditorConfig(studioId), [studioId]);
  const open = useCallback(config.open, [config]);
  const doc = useEditorDoc(open);
  const textEditor = useRef<QuillTextEditorHandle>(null);
  const save = async () => { await textEditor.current?.flush(); return doc.save(); };
  return <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1 }}>
    <Stack.Screen options={{ title: `${config.title} Studio`, headerBackTitle: 'Studios' }} />
    <ForgeWorkspace studioId={studioId} title={config.title} documentTitle={`Untitled ${config.title} document`}
      theme={theme} state={doc.state} rows={doc.state ? config.rows(doc.state) : []}
      actions={config.actions.map(action => ({ title: action.title, run: () => action.run(doc) }))}
      onUndo={doc.undo} onRedo={doc.redo} onSave={save} onRefresh={doc.reload}
      busy={!doc.state} error={doc.error}>
      {studioId === 'quill' ? <QuillTextEditor ref={textEditor} theme={theme} state={doc.state} apply={doc.apply} reload={doc.reload} /> : undefined}
    </ForgeWorkspace>
  </SafeAreaView>;
}
