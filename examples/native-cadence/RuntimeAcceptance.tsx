import { AcceptanceScreen } from "./AcceptanceScreen";
import { verifyNativeRuntime } from "./verify-native-runtime";

async function run() {
  try { return await verifyNativeRuntime(); }
  catch (error) {
    const failure = new Error(`FORGE_NATIVE_RUNTIME_FAIL ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    console.error(failure.message); throw failure;
  }
}
export default function RuntimeAcceptance() {
  return <AcceptanceScreen run={run}/>;
}
