import { AcceptanceScreen } from "./AcceptanceScreen";
import { verifyNativeTelemetry } from "./verify-telemetry";
export default function TelemetryAcceptance() {
  return <AcceptanceScreen run={verifyNativeTelemetry}/>;
}
