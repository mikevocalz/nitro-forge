import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ForgeWorkspace } from '@nitro-forge/studio-workspace';
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
  const config = useMemo(() => getEditorConfig(studioId), [studioId]);
  const open = useCallback(config.open, [config]);
  const doc = useEditorDoc(open);
  return <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1 }}>
    <Stack.Screen options={{ title: `${config.title} Studio`, headerBackTitle: 'Studios' }} />
    <ForgeWorkspace studioId={studioId} title={config.title} documentTitle={`Untitled ${config.title} document`}
      state={doc.state} rows={doc.state ? config.rows(doc.state) : []}
      actions={config.actions.map(action => ({ title: action.title, run: () => action.run(doc) }))}
      onUndo={doc.undo} onRedo={doc.redo} onSave={doc.save} onRefresh={doc.reload}
      busy={!doc.state} error={doc.error} />
  </SafeAreaView>;
}
