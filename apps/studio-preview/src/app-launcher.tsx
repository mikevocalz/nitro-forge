import { ForgeIcon } from '@nitro-forge/icons/native';
import type { Studio } from '@nitro-forge/studio-layout';

import { APP_MANIFESTS as APPS } from '@nitro-forge/studio-workspace/apps';

// Decorative artwork describes each tool, never a saved file or document state.
function AppArtwork({ app }: { app: Studio }) {
  return <div className={`app-art app-art-${app}`} aria-hidden="true">
    {app === 'quill' && <div className="manuscript"><div className="manuscript-heading" /><div className="manuscript-rule" />{Array.from({ length: 7 }, (_, i) => <i key={i} />)}<div className="manuscript-paragraph" />{Array.from({ length: 4 }, (_, i) => <i key={i} />)}</div>}
    {app === 'prism' && <><div className="prism-outline" /><div className="prism-circle" /><div className="prism-plane" /><div className="prism-handle" /></>}
    {app === 'tally' && <div className="mini-sheet">{Array.from({ length: 25 }, (_, i) => <i key={i} className={i === 12 ? 'selected-cell' : ''} />)}</div>}
    {app === 'pitch' && <div className="mini-slide"><i /><b /><span /><span /></div>}
    {app === 'folio' && <><div className="pdf-sheet pdf-back" /><div className="pdf-sheet"><i /><i /><i /><b /><i /><i /></div></>}
    {app === 'splice' && <div className="mini-timeline"><i /><div><b /><b /><b /></div><div><b /><b /></div><div><b /><b /><b /></div></div>}
    {app === 'cadence' && <div className="mini-wave">{[18,30,46,24,56,74,40,24,48,66,80,52,30,18,40,60,34,20].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>}
  </div>;
}

export function AppLauncher({ opened, theme }: { opened: readonly Studio[]; theme: 'dark' | 'light' }) {
  return <section className="app-launcher">
    <header className="launcher-heading">
      <p className="eyebrow">YOUR WORKSPACE</p>
      <h1>What would you like<br className="desktop-break" /> to work on?</h1>
      <p className="launcher-intro">Open the app you need. Your document lives in its own editing space.</p>
    </header>
    <div className="app-list">{Object.entries(APPS).map(([id, info]) => {
      const app = id as Studio;
      return <a className={`app-card app-card-${id}`} key={id} href={`#/apps/${id}`}>
        <div className="app-card-copy">
          <div className="app-card-identity"><span className="app-glyph"><ForgeIcon name={info.glyph} size={25} color="currentColor" appearance={theme} reducedMotion /></span><span className="app-name">{id[0]!.toUpperCase() + id.slice(1)}</span><span className="app-category">{info.category}</span></div>
          <h2>{info.task}</h2>
          <p>{info.detail}</p>
          <div className="app-card-footer"><span>{opened.includes(app) ? 'Continue in app' : 'Open app'}</span>{opened.includes(app) && <span className="open-indicator">Open in this session</span>}<span className="app-arrow" aria-hidden="true">↗</span></div>
        </div>
        <AppArtwork app={app} />
      </a>;
    })}</div>
    <p className="launcher-footnote">One collection. A separate space for every kind of work.</p>
  </section>;
}
