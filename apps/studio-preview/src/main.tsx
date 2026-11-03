import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { ForgeWorkspace, QuillTextEditor, type QuillTextEditorHandle } from '@nitro-forge/studio-workspace';
import { bytesToBase64, base64ToBytes, type DocumentHandle } from '@nitro-forge/ignition';
import { STUDIOS, type Studio } from '@nitro-forge/studio-layout';
import { getEditorConfig } from '../../example/src/editors';
import { useEditorDoc } from './useDocument';
import { PrismEditor } from '@nitro-forge/studio-workspace/prism';
import { AppLauncher } from './app-launcher';
import { Page, Main, Nav, Link, Text as SemanticText } from '@acme/ui/html';
import { Pressable, Text, View, Menu, StudioUIProvider } from '@nitro-forge/studio-workspace/ui';
import { studioControls, FilePicker } from '@acme/ui/studio-controls/web';
import './style.css';

function StudioEditor({ studio, theme, headerTrailing }: { studio: Studio; theme: 'dark' | 'light'; headerTrailing: ReactNode }) {
  const textEditor = useRef<QuillTextEditorHandle>(null);
  const config = getEditorConfig(studio);
  const editor = useEditorDoc(config.open);
  const store = useMemo(() => createStore(() => ({ busy: false, error: null as string | null, notice: '', documentTitle: 'Untitled document' })), []);
  const loadPreset = useCallback(async () => localStorage.getItem(`nitroforge.workspace.v1.${studio}`), [studio]);
  const persistPreset = useCallback(async (raw: string) => { localStorage.setItem(`nitroforge.workspace.v1.${studio}`, raw); }, [studio]);
  const busy = useStore(store, s => s.busy);
  const error = useStore(store, s => s.error);
  const notice = useStore(store, s => s.notice);
  const documentTitle = useStore(store, s => s.documentTitle);
  const run = async (action: () => Promise<unknown> | unknown) => {
    if (store.getState().busy) return;
    store.setState({ busy: true, error: null, notice: '' });
    try { await action(); await editor.reload(); }
    catch (cause) {
      store.setState({ error: cause instanceof Error ? cause.message : String(cause) });
      throw cause;
    }
    finally { store.setState({ busy: false }); }
  };
  const save = async () => {
    await textEditor.current?.flush();
    const bytes = await editor.save();
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url; link.download = `${studio}-untitled.nfd`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    store.setState({ notice: `Saved ${bytes.length.toLocaleString()} bytes from the Rust engine` });
  };
  const openFile = async (file: File) => {
    await run(async () => {
      if (textEditor.current?.isDirty()) throw new Error('Apply your text changes before opening another document.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (studio === 'quill' && file.name.toLowerCase().endsWith('.docx')) {
        await editor.apply('importDocx', { bytes_b64: bytesToBase64(bytes) });
      } else if (file.name.toLowerCase().endsWith('.nfd')) {
        const document = editor.doc as { handle: DocumentHandle } | null;
        if (!document) throw new Error('The document is still opening.');
        await document.handle.restore(bytes);
      } else throw new Error(studio === 'quill' ? 'Choose a DOCX or NFD document.' : 'Choose an NFD document.');
      store.setState({ notice: `Opened ${file.name}`, documentTitle: file.name });
    });
  };
  const leadingActions = <Page className="document-actions">
    <FilePicker className="document-action" label="Open" disabled={busy || !editor.doc}
      accept={studio === 'quill' ? '.docx,.nfd' : '.nfd'}
      onFiles={files => { const file = files[0]; if (file) void openFile(file).catch(() => {}); }} />
      {studio === 'quill' && <Pressable accessibilityLabel="Export Word document" style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' }} disabled={busy || !editor.doc} onPress={() => {
        void run(async () => {
          await textEditor.current?.flush();
          const result = await editor.apply<{ bytes_b64: string }>('exportDocx');
          const bytes = base64ToBytes(result.data.bytes_b64);
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
          const link = document.createElement('a'); link.href = url; link.download = 'essay.docx'; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          store.setState({ notice: 'Word document exported' });
        }).catch(() => {});
      }}><Text style={{ color: 'inherit', fontSize: 12 }}>Export Word</Text></Pressable>}

  </Page>;
  return <>
    <ForgeWorkspace headerLeading={<Link className="back-link" href="#/">← All apps</Link>} headerTrailing={headerTrailing} leadingActions={leadingActions} studioId={studio} title={config.title} documentTitle={documentTitle}
      theme={theme} loadPreset={loadPreset} persistPreset={persistPreset}
      state={editor.state} rows={config.rows(editor.state)}
      actions={config.actions.map(action => ({ title: action.title, run: () => run(() => action.run(editor)) }))}
      onUndo={() => run(editor.undo)} onRedo={() => run(editor.redo)}
      onSave={() => run(save)} onRefresh={() => run(editor.reload)}
      busy={busy || !editor.doc} error={error ?? editor.error}>
      {studio === 'quill' ? <QuillTextEditor ref={textEditor} state={editor.state} documentTitle={documentTitle} theme={theme} apply={editor.apply} reload={editor.reload} /> : studio === 'prism' ? <PrismEditor state={editor.state} theme={theme} apply={editor.apply} reload={editor.reload} busy={busy || !editor.doc} /> : undefined}
    </ForgeWorkspace>
    <Page className="engine-notice" role="status">{notice ? <SemanticText>{notice}</SemanticText> : null}</Page>
  </>;
}

function currentApp(): Studio | null {
  const id = window.location.hash.replace(/^#\/apps\//, '');
  return STUDIOS.find(studio => studio === id) ?? null;
}
function App() {
  const store = useMemo(() => createStore(() => ({ app: currentApp(), opened: currentApp() ? [currentApp()!] : [] as Studio[], theme: 'dark' as 'dark' | 'light', hostWidth: 'desktop' as 'desktop' | 'tablet' | 'split' | 'phone' })), []);
  const app = useStore(store, s => s.app);
  const opened = useStore(store, s => s.opened);
  const theme = useStore(store, s => s.theme);
  const hostWidth = useStore(store, s => s.hostWidth);
  useEffect(() => {
    const navigate = () => {
      const next = currentApp();
      store.setState(current => ({ app: next, opened: next && !current.opened.includes(next) ? [...current.opened, next] : current.opened }));
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, [store]);
  const themeToggle = <Pressable accessibilityLabel={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 10, justifyContent: 'center' }}
    onPress={() => store.setState({ theme: theme === 'dark' ? 'light' : 'dark' })}><Text style={{ color: theme === 'dark' ? '#F0F1F7' : '#252A3A', fontSize: 12 }}>{theme === 'dark' ? 'Light' : 'Dark'}</Text></Pressable>;
  const editorControls = <Page className="editor-host-controls">
    <Menu title="Preview width" triggerLabel="Preview controls" actions={[
      { id: 'desktop', title: 'Desktop · full' }, { id: 'tablet', title: 'Tablet · 768px' },
      { id: 'split', title: 'Split view · 724px' }, { id: 'phone', title: 'Phone · 390px' },
    ]} onAction={value => { if (value === 'desktop' || value === 'tablet' || value === 'split' || value === 'phone') store.setState({ hostWidth: value }); }}>
      <View style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' }}><Text style={{ color: theme === 'dark' ? '#ADB3C4' : '#687287', fontSize: 11 }}>Preview</Text></View>
    </Menu>{themeToggle}
  </Page>;
  return <Main data-theme={theme}>
    {!app && <Nav className="launcher-nav" aria-label="App navigation">
      <Link className="suite-label" href="#/"><SemanticText className="suite-mark" aria-hidden="true">N</SemanticText>NitroForge <SemanticText className="suite-caption">The creative collection</SemanticText></Link>
      {themeToggle}
    </Nav>}
    {opened.map(id => <Page key={id} className="workspace-container" data-host-width={hostWidth} hidden={app !== id}
      style={{ display: app === id ? 'flex' : 'none', width: hostWidth === 'desktop' ? '100%' : hostWidth === 'tablet' ? 768 : hostWidth === 'split' ? 724 : 390 }}>
      <StudioEditor studio={id} theme={theme} headerTrailing={editorControls} />
    </Page>)}
    {!app && <AppLauncher opened={opened} theme={theme} />}
  </Main>;
}

createRoot(document.getElementById('root')!).render(<StudioUIProvider components={studioControls}><App /></StudioUIProvider>);
