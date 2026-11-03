import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { ForgeWorkspace, QuillTextEditor, type QuillTextEditorHandle } from '@nitro-forge/studio-workspace';
import { bytesToBase64, base64ToBytes, type DocumentHandle } from '@nitro-forge/ignition';
import { STUDIOS, type Studio } from '@nitro-forge/studio-layout';
import { getEditorConfig } from '../../example/src/editors';
import { useEditorDoc } from './useDocument';
import './style.css';

function StudioEditor({ studio, theme }: { studio: Studio; theme: 'dark' | 'light' }) {
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
  return <>
    <div className="document-open">
      {studio === 'quill' && <button className="theme-toggle" type="button" disabled={busy || !editor.doc} onClick={() => {
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

      <label>Open {studio === 'quill' ? 'Word document or saved document' : 'saved document'}
        <input aria-label="Open document" type="file" disabled={busy || !editor.doc} accept={studio === 'quill' ? '.docx,.nfd' : '.nfd'}
          onChange={event => { const file = event.target.files?.[0]; if (file) void openFile(file).catch(() => {}); event.target.value = ''; }} />
      </label>
    </div>
    <ForgeWorkspace studioId={studio} title={config.title} documentTitle={documentTitle}
      theme={theme} loadPreset={loadPreset} persistPreset={persistPreset}
      state={editor.state} rows={config.rows(editor.state)}
      actions={config.actions.map(action => ({ title: action.title, run: () => run(() => action.run(editor)) }))}
      onUndo={() => run(editor.undo)} onRedo={() => run(editor.redo)}
      onSave={() => run(save)} onRefresh={() => run(editor.reload)}
      busy={busy || !editor.doc} error={error ?? editor.error}>
      {studio === 'quill' ? <QuillTextEditor ref={textEditor} state={editor.state} theme={theme} apply={editor.apply} reload={editor.reload} /> : undefined}
    </ForgeWorkspace>
    <div className="engine-notice" role="status">{notice}</div>
  </>;
}

const APPS: Record<Studio, { task: string; detail: string }> = {
  quill: { task: 'Write a document', detail: 'Type an essay, work on a draft, or open a Word document.' },
  prism: { task: 'Create an image', detail: 'Work with image layers, shapes and artwork.' },
  tally: { task: 'Open a spreadsheet', detail: 'Organize figures, formulas and sheets.' },
  pitch: { task: 'Build a presentation', detail: 'Arrange slides, text and visual elements.' },
  folio: { task: 'Work with a PDF', detail: 'Inspect pages, rotate and annotate a document.' },
  splice: { task: 'Edit a video timeline', detail: 'Arrange sources, clips and timing.' },
  cadence: { task: 'Make an audio project', detail: 'Work with tracks, notes and arrangements.' },
};
function currentApp(): Studio | null {
  const id = window.location.hash.replace(/^#\/apps\//, '');
  return STUDIOS.find(studio => studio === id) ?? null;
}
function App() {
  const store = useMemo(() => createStore(() => ({ app: currentApp(), opened: currentApp() ? [currentApp()!] : [] as Studio[], theme: 'dark' as 'dark' | 'light', hostWidth: 'desktop' as 'desktop' | 'tablet' | 'phone' })), []);
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
  return <main data-theme={theme}>
    <nav className="studio-switcher" aria-label="App navigation">
      <a className="suite-label" href="#/">NITROFORGE <span>APPS</span></a>
      {app && <a className="back-link" href="#/">← All apps</a>}
      <span className="app-context">{app ? getEditorConfig(app).title : 'Choose what you need'}</span>
      {app && <label className="width-control">Preview width
        <select aria-label="Host width" value={hostWidth} onChange={event => {
          const value = event.target.value;
          if (value === 'desktop' || value === 'tablet' || value === 'phone') store.setState({ hostWidth: value });
        }}>
          <option value="desktop">Desktop · full</option>
          <option value="tablet">Tablet · 768px</option>
          <option value="phone">Phone · 390px</option>
        </select>
      </label>}
      <button className="theme-toggle" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        onClick={() => store.setState({ theme: theme === 'dark' ? 'light' : 'dark' })}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
    </nav>
    {opened.map(id => <div key={id} className="workspace-container" data-host-width={hostWidth} hidden={app !== id}
      style={{ display: app === id ? 'flex' : 'none', width: hostWidth === 'desktop' ? '100%' : hostWidth === 'tablet' ? 768 : 390 }}>
      <StudioEditor studio={id} theme={theme} />
    </div>)}
    {!app && <section className="app-launcher">
      <p className="eyebrow">YOUR WORKSPACE</p>
      <h1>What would you like to work on?</h1>
      <p className="launcher-intro">Open the app you need. Your document lives in its own editing space.</p>
      <div className="app-list">{Object.entries(APPS).map(([id, info], index) => <a className="app-row" key={id} href={`#/apps/${id}`}>
        <span className="app-number">{String(index + 1).padStart(2, '0')}</span>
        <span className="app-copy"><strong>{info.task}</strong><span>{info.detail}</span></span>
        <span className="app-name">{getEditorConfig(id).title}</span><span aria-hidden="true">↗</span>
      </a>)}</div>
    </section>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
