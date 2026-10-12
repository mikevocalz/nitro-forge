import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useEditorDoc, type EditorDoc } from "../../src/useDocument";
import { getEditorConfig, type EditorConfig } from "../../src/editors";

export default function EditorScreen() {
  const { product } = useLocalSearchParams<{ product: string }>();
  const config = useMemo<EditorConfig>(
    () => getEditorConfig(product ?? ""),
    [product],
  );
  const open = useCallback(config.open, [config]);
  const doc = useEditorDoc(open);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: config.title }} />
      {doc.error && <Text style={styles.error}>{doc.error}</Text>}
      {!doc.state && !doc.error && (
        <ActivityIndicator style={styles.spinner} />
      )}
      {!!doc.state && <DocBody doc={doc} config={config} />}
      <Toolbar doc={doc} />
    </View>
  );
}

function DocBody({ doc, config }: { doc: EditorDoc; config: EditorConfig }) {
  const rows = config.rows(doc.state);
  return (
    <ScrollView style={styles.body} contentContainerStyle={{ padding: 16 }}>
      {rows.map((r, i) => (
        <View key={i} style={styles.row}>
          <Text style={styles.rowLabel}>{r.label}</Text>
          <Text style={styles.rowValue}>{r.value}</Text>
        </View>
      ))}
      {config.actions.map((a) => (
        <Pressable
          key={a.title}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          onPress={() => void a.run(doc)}
        >
          <Text style={styles.actionText}>{a.title}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Toolbar({ doc }: { doc: EditorDoc }) {
  return (
    <View style={styles.toolbar}>
      <Tb title="Undo" onPress={doc.undo} />
      <Tb title="Redo" onPress={doc.redo} />
      <Tb title="Save" onPress={async () => void (await doc.save())} />
      <Tb title="Refresh" onPress={doc.reload} />
    </View>
  );
}

function Tb({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tbBtn, pressed && styles.pressed]}
    >
      <Text style={styles.tbText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f3f4f6" },
  spinner: { marginTop: 48 },
  error: { color: "#b91c1c", margin: 16 },
  body: { flex: 1 },
  row: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  rowLabel: { fontSize: 14, color: "#374151", flexShrink: 1 },
  rowValue: { fontSize: 14, color: "#6b7280", flexShrink: 1, textAlign: "right" },
  action: {
    backgroundColor: "#111827",
    borderRadius: 10,
    padding: 14,
    marginTop: 10,
    alignItems: "center",
  },
  actionText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  pressed: { opacity: 0.7 },
  toolbar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#d1d5db",
    backgroundColor: "#fff",
  },
  tbBtn: { flex: 1, paddingVertical: 14, alignItems: "center" },
  tbText: { fontSize: 15, fontWeight: "500", color: "#111827" },
});
