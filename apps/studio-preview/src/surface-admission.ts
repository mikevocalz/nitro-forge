/** Identity and readiness gate. Resource references stay in the host's ref, never serialized state. */
export interface SurfaceReadToken {
  readonly generation: number;
  readonly document: unknown;
  readonly source: unknown;
  readonly scope: unknown;
}
export class SurfaceAdmission {
  private generation = 0;
  private document: unknown;
  private source: unknown;
  private scope: unknown;
  private disabled = true;
  private writable = false;
  private lease: symbol | null = null;
  get writing() { return this.lease !== null; }
  get ready() { return this.writable && !this.disabled && !this.writing; }
  update(document: unknown, source: unknown, scope: unknown, disabled = false) {
    if (document !== this.document || source !== this.source || scope !== this.scope || disabled !== this.disabled) {
      ++this.generation;
      this.writable = false;
    }
    this.document = document;
    this.source = source;
    this.scope = scope;
    this.disabled = disabled;
  }
  capture(): SurfaceReadToken { return { generation: this.generation, document: this.document, source: this.source, scope: this.scope }; }
  current(token: SurfaceReadToken) {
    return token.generation === this.generation && token.document === this.document && token.source === this.source && token.scope === this.scope;
  }
  invalidate() { ++this.generation; this.writable = false; }
  beginRead(): SurfaceReadToken | null {
    this.invalidate();
    return this.document && !this.disabled && !this.writing ? this.capture() : null;
  }
  acceptRead(token: SurfaceReadToken) {
    if (!this.current(token) || this.disabled || this.writing) return false;
    this.writable = true;
    return true;
  }
  admitWrite(token: SurfaceReadToken): symbol {
    if (!this.ready || !this.current(token)) throw new Error('Wait for the current document to finish loading before editing.');
    const lease = Symbol('surface-write');
    this.lease = lease;
    this.invalidate();
    return lease;
  }
  finishWrite(lease: symbol) {
    if (this.lease !== lease) throw new Error('Unknown document write lease');
    this.lease = null;
    // Only a new successful read may reopen admission, even after a rejected write.
    this.writable = false;
  }
}

/** Preserve the host's rejection while releasing only this admitted write. */
export async function performSurfaceWrite<T>(gate: SurfaceAdmission, token: SurfaceReadToken, action: () => Promise<T>): Promise<T> {
  const lease = gate.admitWrite(token);
  try { return await action(); }
  finally { gate.finishWrite(lease); }
}
