import { Card, Badge } from '@nitro-forge/studio-workspace/ui';
import { Page, Header, Footer, Section, Heading, Paragraph, Link, Text } from '@nyc-tron/ui/components/html';
import { ForgeIcon } from '@nitro-forge/icons/native';
import type { Studio } from '@nitro-forge/studio-layout';
import { APP_MANIFESTS as APPS } from '@nitro-forge/studio-workspace/apps';

/** Independent applications; session badges reflect apps actually opened here. */
export function AppLauncher({ opened, theme }: { opened: readonly Studio[]; theme: 'dark' | 'light' }) {
  return <Section className="app-launcher" aria-labelledby="apps-heading">
    <Header className="launcher-heading">
      <Page>
        <Paragraph className="launcher-location">NitroForge / Your collection</Paragraph>
        <Heading level={1} id="apps-heading">Apps</Heading>
        <Paragraph className="launcher-intro">A dedicated space for everything you create.</Paragraph>
      </Page>
      <Page className="launcher-session-note"><Text aria-hidden><ForgeIcon name="layers" size={17} color="currentColor" reducedMotion /></Text><Text>Switch apps without closing your work.</Text></Page>
    </Header>
    <Page className="directory-heading"><Heading level={2}>All applications</Heading><Text className="directory-hint">Choose where to work</Text></Page>
    <Page className="app-list">{Object.entries(APPS).map(([id, info]) => {
      const app = id as Studio;
      const isOpen = opened.includes(app);
      const name = id[0]!.toUpperCase() + id.slice(1);
      return <Link className="app-card-link w-full h-full self-stretch" key={id} href={`#/apps/${id}`} title={info.detail} aria-label={`${isOpen ? 'Continue in' : 'Open'} ${name} — ${info.task}`}><Card surface="page" padded={false} style={{ borderRadius: 4, width: '100%' }} className={`w-full h-full app-card app-card-${id}${isOpen ? ' app-card-open' : ''}`}>
        <Text className="app-glyph" aria-hidden><ForgeIcon name={info.glyph} size={29} color="currentColor" appearance={theme} reducedMotion /></Text>
        <Page className="app-card-copy">
          <Page className="app-card-identity"><Heading level={3} className="app-name">{name}</Heading><Text className="app-category">{info.category}</Text></Page>
          <Paragraph className="app-task">{info.task}</Paragraph>
          <Page className="app-card-footer"><Text className="app-open-label">{isOpen ? `Continue in ${name}` : `Open ${name}`}<Text aria-hidden> →</Text></Text>{isOpen && <Badge label="Open in this session" tone="neutral" size="xs" className="rounded-[4px] overflow-hidden" />}</Page>
        </Page>
      </Card></Link>;
    })}</Page>
    <Footer className="launcher-footnote"><Text className="launcher-footnote-text">Your apps, separate workspaces.</Text><Text className="launcher-footnote-text">Save your document before closing this browser session.</Text></Footer>
  </Section>;
}
