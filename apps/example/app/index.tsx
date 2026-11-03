import { Link, Stack } from 'expo-router';
import { Pressable, ScrollView, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { ForgeIcon } from '@nitro-forge/icons/native';
import { workspaceThemes, workspaceScale } from '@nitro-forge/studio-workspace/theme';
import { APP_MANIFESTS } from '@nitro-forge/studio-workspace/apps';
import type { Studio } from '@nitro-forge/studio-layout';

// Palette belongs to the decorative artwork; semantic controls use shared tokens.
const ART: Record<Studio, { art: string; ink: string }> = {
  quill: { art: '#B6B9A5', ink: '#505951' },
  prism: { art: '#B5A3CA', ink: '#67557A' },
  tally: { art: '#ACBBA6', ink: '#657A5E' },
  pitch: { art: '#CBA898', ink: '#BD775A' },
  folio: { art: '#C4B29C', ink: '#998167' },
  splice: { art: '#9AAFBA', ink: '#5D7681' },
  cadence: { art: '#A4A7C1', ink: '#4D526F' },
};
const APPS = (Object.keys(APP_MANIFESTS) as Studio[]).map(id => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), ...APP_MANIFESTS[id], ...ART[id],
}));
type App = typeof APPS[number];

/** Decorative tool motifs; these do not represent a user's files or document state. */
function AppArtwork({ app }: { app: App }) {
  const paper = '#F5F1E5';
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: app.id === 'quill' ? '32%' : '26%', alignSelf: 'stretch', overflow: 'hidden', backgroundColor: app.art, justifyContent: 'center', alignItems: 'center' }}>
    {(app.id === 'quill' || app.id === 'folio') && <View style={{ width: app.id === 'quill' ? 150 : 100, height: app.id === 'quill' ? 235 : 145, backgroundColor: paper, paddingHorizontal: app.id === 'quill' ? 20 : 14, paddingTop: 27, transform: [{ translateX: 12 }, { rotate: '-6deg' }], gap: 8, borderWidth: app.id === 'folio' ? 1 : 0, borderColor: app.ink }}>
      <View style={{ width: '68%', height: 6, backgroundColor: app.ink, marginBottom: 12 }} />
      {Array.from({ length: app.id === 'quill' ? 12 : 7 }, (_, i) => <View key={i} style={{ width: i % 4 === 3 ? '73%' : '100%', height: app.id === 'folio' && i === 3 ? 7 : 2, backgroundColor: app.id === 'folio' && i === 3 ? '#DFC87E' : '#B7B9AB' }} />)}
    </View>}
    {app.id === 'prism' && <>
      <View style={{ position: 'absolute', width: 105, height: 105, top: 28, left: -15, borderWidth: 1, borderColor: app.ink, transform: [{ rotate: '-15deg' }] }} />
      <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: paper, transform: [{ translateX: 12 }] }} />
      <View style={{ position: 'absolute', width: 160, height: 85, bottom: -16, left: -15, backgroundColor: app.ink, transform: [{ rotate: '-24deg' }] }} />
    </>}
    {app.id === 'tally' && <View style={{ width: 150, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: paper, transform: [{ translateX: 15 }, { rotate: '-5deg' }] }}>
      {Array.from({ length: 25 }, (_, i) => <View key={i} style={{ width: 30, height: 26, borderWidth: .5, borderColor: '#CCD0C0', backgroundColor: i < 5 ? '#DBE0CC' : i === 12 ? '#B8CBA8' : paper }} />)}
    </View>}
    {app.id === 'pitch' && <View style={{ width: 150, height: 112, padding: 18, backgroundColor: paper, transform: [{ translateX: 15 }, { rotate: '6deg' }], justifyContent: 'center', gap: 8 }}>
      <View style={{ position: 'absolute', right: 15, top: 25, width: 38, height: 62, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: app.ink }} />
      <View style={{ width: 57, height: 6, backgroundColor: '#4E5144', marginBottom: 4 }} /><View style={{ width: 48, height: 2, backgroundColor: '#B8B8A6' }} /><View style={{ width: 40, height: 2, backgroundColor: '#B8B8A6' }} />
    </View>}
    {app.id === 'splice' && <View style={{ width: 160, gap: 6, transform: [{ translateX: 20 }] }}>
      {[0, 1, 2].map(row => <View key={row} style={{ flexDirection: 'row', gap: 3, paddingLeft: row === 1 ? 18 : 0 }}>{[0, 1, 2].map(col => <View key={col} style={{ height: 26, width: 39, backgroundColor: paper, borderLeftWidth: 4, borderColor: app.ink }} />)}</View>)}
      <View style={{ position: 'absolute', top: -8, bottom: -8, left: 52, width: 1, backgroundColor: app.ink }} />
    </View>}
    {app.id === 'cadence' && <View style={{ height: 110, flexDirection: 'row', alignItems: 'center', gap: 4, transform: [{ translateX: 12 }] }}>
      {[18, 30, 46, 24, 56, 74, 40, 24, 48, 66, 80, 52, 30, 18].map((height, i) => <View key={i} style={{ height, width: 4, borderRadius: 3, backgroundColor: app.ink }} />)}
    </View>}
  </View>;
}

export default function Home() {
  const theme = useColorScheme() === 'light' ? 'light' : 'dark';
  const colors = workspaceThemes[theme];
  const { width } = useWindowDimensions();
  const columns = width >= 760;
  return <>
    <Stack.Screen options={{ title: 'NitroForge', headerStyle: { backgroundColor: colors.base }, headerTintColor: colors.text, headerShadowVisible: false }} />
    <ScrollView style={{ flex: 1, backgroundColor: colors.base }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: width < 440 ? 16 : 24, paddingTop: 28, paddingBottom: 40, alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: 1120 }}>
        <Text style={{ color: colors.accent, fontSize: workspaceScale.type.micro, letterSpacing: 2, fontWeight: '600', marginBottom: 16 }}>THE CREATIVE COLLECTION</Text>
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: columns ? 46 : 34, lineHeight: columns ? 51 : 39, letterSpacing: -1.5, fontWeight: '500', maxWidth: 600 }}>What would you like to work on?</Text>
        <Text style={{ color: colors.muted, fontSize: workspaceScale.type.body, lineHeight: 23, marginTop: 16, marginBottom: 30, maxWidth: 380 }}>Open the app you need. Your document lives in its own editing space.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between' }}>
          {APPS.map(app => <Link key={app.id} href={`/editor/${app.id}`} asChild>
            <Pressable accessibilityRole="link" accessibilityLabel={`${app.name}: ${app.task}`} style={({ pressed }) => ({ width: app.id === 'quill' || !columns ? '100%' : '48.8%', minHeight: app.id === 'quill' ? 265 : 235, flexDirection: 'row', overflow: 'hidden', backgroundColor: colors.raised, borderWidth: 1, borderColor: pressed ? colors.accent : colors.line, opacity: pressed ? .85 : 1 })}>
              <View style={{ flex: 1, minWidth: 0, padding: columns ? 26 : 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 24 }}><ForgeIcon name={app.glyph} size={25} color={colors.accent} appearance={theme} reducedMotion /><Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{app.name}</Text></View>
                <Text style={{ color: colors.text, fontSize: app.id === 'quill' ? 29 : 23, letterSpacing: -.7, fontWeight: '500', marginBottom: 10 }}>{app.task}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20, maxWidth: 285 }}>{app.detail}</Text>
                <View style={{ flex: 1, minHeight: 22 }} /><View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8 }}><Text style={{ color: colors.text, fontSize: 11, flex: 1 }}>Open app</Text><Text style={{ color: colors.text, fontSize: 21 }} accessibilityElementsHidden>↗</Text></View>
              </View>
              <AppArtwork app={app} />
            </Pressable>
          </Link>)}
        </View>
      </View>
    </ScrollView>
  </>;
}
