import { Link, Redirect, Stack } from 'expo-router';
import { useColorScheme, useWindowDimensions } from 'react-native';
import { Pressable, ScrollView, Text, View, Card } from '@nitro-forge/studio-workspace/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ForgeIcon } from '@nitro-forge/icons/native';
import { workspaceThemes, workspaceScale as scale } from '@nitro-forge/studio-workspace/theme';
import { APP_MANIFESTS } from '@nitro-forge/studio-workspace/apps';
import type { Studio } from '@nitro-forge/studio-layout';
import { brand, surfaces } from '../src/brand';

const APPS = (Object.keys(APP_MANIFESTS) as Studio[]).map(id => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), ...APP_MANIFESTS[id],
}));

export default function Home() {
  // A single-studio build opens its studio directly; only the suite lists apps.
  if (brand.engine) return <Redirect href={`/editor/${brand.engine}`} />;
  return <Suite />;
}

function Suite() {
  const theme = useColorScheme() === 'light' ? 'light' : 'dark';
  const colors = workspaceThemes[theme];
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const columns = width >= 760;
  const compact = width < 440;
  return <>
    <Stack.Screen options={{ title: surfaces.homeTitle, headerStyle: { backgroundColor: colors.raised }, headerTintColor: colors.text, headerShadowVisible: false }} />
    <ScrollView style={{ flex: 1, backgroundColor: colors.base }} contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingLeft: Math.max(compact ? 16 : 24, insets.left), paddingRight: Math.max(compact ? 16 : 24, insets.right), paddingTop: 26, paddingBottom: Math.max(32, insets.bottom + 20), alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: 1040 }}>
        <View style={{ gap: 10, marginBottom: 28 }}>
          <Text style={{ color: colors.muted, fontSize: 11 }}>{surfaces.homeTitle} / Your collection</Text>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 28, lineHeight: 34, letterSpacing: -.8, fontWeight: '600' }}>Apps</Text>
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 21 }}>A dedicated space for everything you create.</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12 }}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>All applications</Text>
          {!compact && <Text style={{ color: colors.muted, fontSize: 11 }}>Choose where to work</Text>}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
          {APPS.map(app => <Link key={app.id} href={`/editor/${app.id}`} asChild>
            <Pressable accessibilityRole="link" accessibilityLabel={`Open ${app.name}: ${app.task}`}
              style={{ width: columns ? '48.8%' : '100%', minHeight: scale.size.target }}>
              {({ pressed }) => <Card surface="page" padded={false} style={{ width: '100%', borderRadius: scale.radius.panel, borderColor: pressed ? colors.accent : colors.line, backgroundColor: pressed ? colors.soft : colors.raised }}>
              <View style={{ padding: compact ? 17 : 22, flexDirection: 'row', alignItems: 'flex-start', gap: compact ? 14 : 18 }}>
              <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: compact ? 48 : 54, height: compact ? 48 : 54, borderRadius: scale.radius.control, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.soft }}>
                <ForgeIcon name={app.glyph} size={29} color={colors.accent} appearance={theme} surfaceColor={colors.soft} reducedMotion />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <Text style={{ color: colors.text, fontSize: 19, lineHeight: 25, letterSpacing: -.4, fontWeight: '600' }}>{app.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 10 }}>{app.category}</Text>
                </View>
                <Text style={{ color: colors.text, fontSize: 12, lineHeight: 19 }}>{app.task}</Text>
                <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '500', marginTop: 10 }}>Open app →</Text>
              </View>
              </View></Card>}
            </Pressable>
          </Link>)}
        </View>
        <Link href="/persona-capture" asChild>
          <Pressable accessibilityRole="link" accessibilityLabel="Open persona capture"
            style={{ marginTop: 24, alignSelf: 'flex-start' }}>
            {({ pressed }) => <Text style={{ color: pressed ? colors.accent : colors.accent, fontSize: 12, fontWeight: '500' }}>Persona capture (camera) →</Text>}
          </Pressable>
        </Link>
        <Text style={{ color: colors.muted, fontSize: 11, lineHeight: 18, marginTop: 24 }}>Your apps, separate workspaces.</Text>
        <Link href="/about" asChild>
          <Pressable accessibilityRole="link" accessibilityLabel={surfaces.about.title} style={{ marginTop: 12, alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '500' }}>{surfaces.about.title}</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  </>;
}
