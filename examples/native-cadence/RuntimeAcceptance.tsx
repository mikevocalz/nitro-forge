import { AcceptanceScreen } from "./AcceptanceScreen";
import { verifyNativeRuntime } from "./verify-native-runtime";
import { Platform } from "react-native";

let task: Promise<string> | undefined;
async function deliver(message: string) {
  const endpoint = process.env.EXPO_PUBLIC_FORGE_ACCEPTANCE_URL;
  if (!endpoint) return;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, platform: Platform.OS,
        revision: process.env.EXPO_PUBLIC_FORGE_REVISION ?? "local",
        runId: process.env.EXPO_PUBLIC_FORGE_ACCEPTANCE_RUN ?? "manual" }), signal: controller.signal });
    if (!response.ok) throw new Error(`Native acceptance receiver returned ${response.status}`);
  } finally { clearTimeout(timeout); }
}
async function execute() {
  let result: string;
  try { result = await verifyNativeRuntime(); }
  catch (error) {
    const failure = new Error(`FORGE_NATIVE_RUNTIME_FAIL ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    console.error(failure.message);
    try { await deliver(failure.message); } catch (transport) { console.error("Native acceptance receipt failed", transport); }
    throw failure;
  }
  await deliver(result);
  return result;
}
const run = () => task ??= execute();
export default function RuntimeAcceptance() {
  return <AcceptanceScreen run={run}/>;
}
