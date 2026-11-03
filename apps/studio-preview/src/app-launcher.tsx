import { ForgeIcon } from '@nitro-forge/icons/native';
import type { Studio } from '@nitro-forge/studio-layout';
import { APP_MANIFESTS as APPS } from '@nitro-forge/studio-workspace/apps';

/** Independent applications; session badges reflect apps actually opened here. */
export function AppLauncher({ opened, theme }: { opened: readonly Studio[]; theme: 'dark' | 'light' }) {
  return <section className="app-launcher" aria-labelledby="apps-heading">
    <header className="launcher-heading">
      <div>
        <p className="launcher-location">NitroForge / Your collection</p>
        <h1 id="apps-heading">Apps</h1>
        <p className="launcher-intro">A dedicated space for everything you create.</p>
      </div>
      <p className="launcher-session-note"><span aria-hidden="true"><ForgeIcon name="layers" size={17} color="currentColor" reducedMotion /></span>Switch apps without closing your work.</p>
    </header>
    <div className="directory-heading"><h2>All applications</h2><span>Choose where to work</span></div>
    <div className="app-list">{Object.entries(APPS).map(([id, info]) => {
      const app = id as Studio;
      const isOpen = opened.includes(app);
      const name = id[0]!.toUpperCase() + id.slice(1);
      return <a className={`app-card app-card-${id}${isOpen ? ' app-card-open' : ''}`} key={id} href={`#/apps/${id}`} title={info.detail} aria-label={`${isOpen ? 'Continue in' : 'Open'} ${name} — ${info.task}`}>
        <span className="app-glyph" aria-hidden="true"><ForgeIcon name={info.glyph} size={29} color="currentColor" appearance={theme} surfaceColor={theme === 'dark' ? '#29253c' : '#eeebfc'} reducedMotion /></span>
        <div className="app-card-copy">
          <div className="app-card-identity"><h3 className="app-name">{name}</h3><span className="app-category">{info.category}</span></div>
          <p className="app-task">{info.task}</p>
          <div className="app-card-footer"><span className="app-open-label">{isOpen ? `Continue in ${name}` : `Open ${name}`}<span aria-hidden="true"> →</span></span>{isOpen && <span className="open-indicator">Open in this session</span>}</div>
        </div>
      </a>;
    })}</div>
    <footer className="launcher-footnote"><span>Your apps, separate workspaces.</span><span>Save your document before closing this browser session.</span></footer>
  </section>;
}
