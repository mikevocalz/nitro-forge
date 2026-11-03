import { useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { ForgeWorkspace } from '@nitro-forge/studio-workspace';
import { STUDIOS, type Studio } from '@nitro-forge/studio-layout';
import { getEditorConfig } from '../../example/src/editors';
import { useEditorDoc } from './useDocument';
import './style.css';

function StudioEditor({ studio, theme }: { studio: Studio; theme: 'dark' | 'light' }) {
  const config = getEditorConfig(studio);
  const editor = useEditorDoc(config.open);
  const store = useMemo(() => createStore(() => ({ busy: false, error: null as string | null, notice: '' })), []);
  const loadPreset = useCallback(async () => localStorage.getItem(`nitroforge.workspace.v1.${studio}`), [studio]);
  const persistPreset = useCallback(async (raw: string) => { localStorage.setItem(`nitroforge.workspace.v1.${studio}`, raw); }, [studio]);
  const busy = useStore(store, s => s.busy);
  const error = useStore(store, s => s.error);
  const notice = useStore(store, s => s.notice);
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
    const bytes = await editor.save();
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url; link.download = `${studio}-untitled.nfd`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    store.setState({ notice: `Saved ${bytes.length.toLocaleString()} bytes from the Rust engine` });
  };
  return <>
    <ForgeWorkspace studioId={studio} title={config.title} documentTitle="Untitled study"
      theme={theme} loadPreset={loadPreset} persistPreset={persistPreset}
      state={editor.state} rows={config.rows(editor.state)}
      actions={config.actions.map(action => ({ title: action.title, run: () => run(() => action.run(editor)) }))}
      onUndo={() => run(editor.undo)} onRedo={() => run(editor.redo)}
      onSave={() => run(save)} onRefresh={() => run(editor.reload)}
      busy={busy || !editor.doc} error={error ?? editor.error} />
    <div className="engine-notice" role="status">{notice}</div>
  </>;
}

function App() {
  const store = useMemo(() => createStore(() => ({ studio: 'prism' as Studio, theme: 'dark' as 'dark' | 'light', hostWidth: 'desktop' as 'desktop' | 'tablet' | 'phone' })), []);
  const studio = useStore(store, s => s.studio);
  const theme = useStore(store, s => s.theme);
  const hostWidth = useStore(store, s => s.hostWidth);
  return <main data-theme={theme}>
    <nav className="studio-switcher" aria-label="Choose a studio">
      <span className="suite-label">NITROFORGE <span>STUDIO</span></span>
      <div className="studio-tabs">{STUDIOS.map(id => <button key={id} type="button"
        aria-pressed={id === studio} onClick={() => store.setState({ studio: id })}>
        {id.charAt(0).toUpperCase() + id.slice(1)}
      </button>)}</div>
      <span className="engine-badge"><i /> Rust engine · local</span>
      <label className="width-control">Host width
        <select aria-label="Host width" value={hostWidth} onChange={event => {
          const value = event.target.value;
          if (value === 'desktop' || value === 'tablet' || value === 'phone') store.setState({ hostWidth: value });
        }}>
          <option value="desktop">Desktop · full</option>
          <option value="tablet">Tablet · 768px</option>
          <option value="phone">Phone · 390px</option>
        </select>
      </label>
      <button className="theme-toggle" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        onClick={() => store.setState({ theme: theme === 'dark' ? 'light' : 'dark' })}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
    </nav>
    <div className="workspace-container" data-host-width={hostWidth}
      style={{ width: hostWidth === 'desktop' ? '100%' : hostWidth === 'tablet' ? 768 : 390 }}>
      <StudioEditor key={studio} studio={studio} theme={theme} />
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
