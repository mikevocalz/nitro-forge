/** Internal RNW transport. Rust session IDs never cross this boundary. */
export interface NativeForgeWindows {
  openEngine(kind: string): Promise<string>;
  apply(request: {
    documentId: string;
    operation: string;
    /** Empty means absent; every present payload is valid JSON, including null. */
    payloadJson: string;
    version: number;
  }): Promise<{
    dataJson: string;
    events: Array<{ kind: string; detailJson: string }>;
  }>;
  snapshotB64(documentId: string): Promise<string>;
  restoreB64(documentId: string, bytesB64: string): Promise<void>;
  undo(documentId: string): Promise<boolean>;
  redo(documentId: string): Promise<boolean>;
  closeEngine(documentId: string): Promise<boolean>;
}
