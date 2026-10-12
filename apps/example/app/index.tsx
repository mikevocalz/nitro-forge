import { Link } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

const PRODUCTS = [
  { id: "prism", name: "Prism", tagline: "Image & vector" },
  { id: "cadence", name: "Cadence", tagline: "Audio workstation" },
  { id: "splice", name: "Splice", tagline: "Video timeline" },
  { id: "folio", name: "Folio", tagline: "PDF documents" },
  { id: "pitch", name: "Pitch", tagline: "Presentations" },
  { id: "tally", name: "Tally", tagline: "Spreadsheets" },
  { id: "quill", name: "Quill", tagline: "Rich text" },
] as const;

export default function Home() {
  return (
    <FlatList
      data={PRODUCTS}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Link href={`/editor/${item.id}`} asChild>
          <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.tagline}>{item.tagline}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </Link>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#fff",
    marginBottom: 8,
  },
  pressed: { opacity: 0.6 },
  name: { fontSize: 17, fontWeight: "600" },
  tagline: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  chevron: { fontSize: 22, color: "#9ca3af" },
});
