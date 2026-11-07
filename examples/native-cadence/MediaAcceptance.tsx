import { AcceptanceScreen } from "./AcceptanceScreen";
import { verifyNativeMedia } from "./verify-media";
export default function MediaAcceptance() {
  return <AcceptanceScreen run={verifyNativeMedia}/>;
}
