import { useColorScheme } from 'react-native';
import { ScrollView, Text, View } from '@nitro-forge/studio-workspace/ui';
import { workspaceThemes, workspaceScale as scale } from '@nitro-forge/studio-workspace/theme';
import { surfaces } from '../src/brand';

/** About: product name, version and identifiers, all from the brand manifest. */
export default function About() {
  const theme = useColorScheme() === 'light' ? 'light' : 'dark';
  const colors = workspaceThemes[theme];
  const { about } = surfaces;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.base }} contentInsetAdjustmentBehavior="automatic"
    contentContainerStyle={{ padding: scale.space.group, gap: scale.space.group }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: '600' }}>{about.heading}</Text>
    <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: scale.radius.panel }}>
      {about.rows.map((row, i) => <View key={row.label} accessible accessibilityLabel={`${row.label}: ${row.value}`}
        style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16, minHeight: 44, alignItems: 'center', paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{row.label}</Text>
        <Text selectable style={{ color: colors.text, fontSize: 13, flexShrink: 1, textAlign: 'right' }}>{row.value}</Text>
      </View>)}
    </View>
  </ScrollView>;
}
