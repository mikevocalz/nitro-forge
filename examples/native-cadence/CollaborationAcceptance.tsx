import { AcceptanceScreen } from "./AcceptanceScreen";
import { verifyNativeCollaboration } from "./verify-collaboration";
export default function CollaborationAcceptance() {
  return <AcceptanceScreen run={verifyNativeCollaboration}/>;
}
