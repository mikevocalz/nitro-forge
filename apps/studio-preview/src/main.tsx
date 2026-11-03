import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { ForgeWorkspace, QuillTextEditor, type QuillTextEditorHandle } from '@nitro-forge/studio-workspace';
import { bytesToBase64, base64ToBytes, type DocumentHandle } from '@nitro-forge/ignition';
import { STUDIOS, type Studio } from '@nitro-forge/studio-layout';
import { getEditorConfig } from '../../example/src/editors';
import { useEditorDoc } from './useDocument';
import { AppLauncher } from './app-launcher';
import './style.css';

function StudioEditor({ studio, theme, headerTrailing }: { studio: Studio; theme: 'dark' | 'light'; headerTrailing: ReactNode }) {
  const fileInput = useRef<HTMLInputElement>(null);
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
  const leadingActions = <div className="document-actions">
    <button className="document-action" type="button" disabled={busy || !editor.doc} onClick={() => fileInput.current?.click()}>Open document</button>
    <input ref={fileInput} hidden aria-label="Open document" type="file" disabled={busy || !editor.doc} accept={studio === 'quill' ? '.docx,.nfd' : '.nfd'}
      onChange={event => { const file = event.target.files?.[0]; if (file) void openFile(file).catch(() => {}); event.target.value = ''; }} />
      {studio === 'quill' && <button className="document-action" type="button" disabled={busy || !editor.doc} onClick={() => {
        void run(async () => {
          await textEditor.current?.flush();
          const result = await editor.apply<{ bytes_b64: string }>('exportDocx');
          const bytes = base64ToBytes(result.data.bytes_b64);
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
          const link = document.createElement('a'); link.href = url; link.download = 'essay.docx'; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          store.setState({ notice: 'Word document exported' });
        }).catch(() => {});
      }}>Export Word document</button>}

  </div>;
  return <>
    <ForgeWorkspace headerLeading={<a className="back-link" href="#/">← All apps</a>} headerTrailing={headerTrailing} leadingActions={leadingActions} studioId={studio} title={config.title} documentTitle={documentTitle}
      theme={theme} loadPreset={loadPreset} persistPreset={persistPreset}
      state={editor.state} rows={config.rows(editor.state)}
      actions={config.actions.map(action => ({ title: action.title, run: () => run(() => action.run(editor)) }))}
      onUndo={() => run(editor.undo)} onRedo={() => run(editor.redo)}
      onSave={() => run(save)} onRefresh={() => run(editor.reload)}
      busy={busy || !editor.doc} error={error ?? editor.error}>
      {studio === 'quill' ? <QuillTextEditor ref={textEditor} state={editor.state} documentTitle={documentTitle} theme={theme} apply={editor.apply} reload={editor.reload} /> : undefined}
    </ForgeWorkspace>
    <div className="engine-notice" role="status">{notice}</div>
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
  const themeToggle = <button className="theme-toggle" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    onClick={() => store.setState({ theme: theme === 'dark' ? 'light' : 'dark' })}>{theme === 'dark' ? 'Light' : 'Dark'}</button>;
  const editorControls = <div className="editor-host-controls">
    <details className="preview-controls"><summary aria-label="Preview controls">Preview</summary>
      <label>Preview width<select aria-label="Host width" value={hostWidth} onChange={event => {
        const value = event.target.value;
        if (value === 'desktop' || value === 'tablet' || value === 'split' || value === 'phone') store.setState({ hostWidth: value });
      }}><option value="desktop">Desktop · full</option><option value="tablet">Tablet · 768px</option><option value="split">Split view · 724px</option><option value="phone">Phone · 390px</option></select></label>
    </details>{themeToggle}
  </div>;
  return <main data-theme={theme}>
    {!app && <nav className="launcher-nav" aria-label="App navigation">
      <a className="suite-label" href="#/"><span className="suite-mark" aria-hidden="true">N</span>NitroForge <span className="suite-caption">The creative collection</span></a>
      {themeToggle}
    </nav>}
    {opened.map(id => <div key={id} className="workspace-container" data-host-width={hostWidth} hidden={app !== id}
      style={{ display: app === id ? 'flex' : 'none', width: hostWidth === 'desktop' ? '100%' : hostWidth === 'tablet' ? 768 : hostWidth === 'split' ? 724 : 390 }}>
      <StudioEditor studio={id} theme={theme} headerTrailing={editorControls} />
    </div>)}
    {!app && <AppLauncher opened={opened} theme={theme} />}
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
