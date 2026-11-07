import { verifyNativeCheckpoints } from "./verify-checkpoints";
import { AcceptanceScreen } from "./AcceptanceScreen";

export default function CheckpointAcceptance() {
  return <AcceptanceScreen run={verifyNativeCheckpoints}/>;
}
