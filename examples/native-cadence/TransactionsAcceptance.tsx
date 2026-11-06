import { AcceptanceScreen } from "./AcceptanceScreen";
import { verifyNativeTransactions } from "./verify-transactions";
export default function TransactionsAcceptance() {
  return <AcceptanceScreen run={verifyNativeTransactions}/>;
}
