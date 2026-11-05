/**
 * Smallest app that links the Nitro v1 Forge factory and the Rust
 * xcframework. It exists so CI can compile and link the generated SwiftPM
 * package; it is not a product screen.
 */
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ForgeFactory } from "@nitro-forge/ignition-v1-lab";

type Status = "opening" | "ready" | "failed";

export default function App() {
  const [status, setStatus] = useState<Status>("opening");

  useEffect(() => {
    let closed = false;
    const factory = new ForgeFactory();
    const pending = factory.open("tally");
    pending.then(
      () => {
        if (!closed) setStatus("ready");
      },
      () => {
        if (!closed) setStatus("failed");
      },
    );
    return () => {
      closed = true;
      pending.then((document) => document.close(), () => undefined);
    };
  }, []);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>Rust tally document: {status}</Text>
    </View>
  );
}
