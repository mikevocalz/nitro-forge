import { ownedJson } from "./owned-json";
import type { DocumentHandle } from "./document";
import type { Command, CommandResult } from "./types";

export type TransactionInput = "pointer" | "touch" | "pen" | "keyboard" | "accessibility" | "controller";
export interface TransactionState<T> {
  readonly phase: "idle" | "preview" | "committing" | "error" | "closed";
  readonly gestureId: number | null;
  readonly input: TransactionInput | null;
  readonly preview: Readonly<T> | null;
  readonly error: string | null;
}
export interface TransactionResult {
  readonly committed: boolean;
  readonly result: CommandResult<{ results: unknown[] }> | null;
}


function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

/** One coordinator per document, retained in a ref. Updates are local previews;
 * commit sends one real Rust batch. Cancelling a preview changes no
 * document/history. An accepted commit cannot be retrospectively cancelled. */
export class UndoTransactionCoordinator<T> {
  private nextId = 1;
  private closed = false;
  private active: { id: number; input: TransactionInput; initial: Readonly<T>; preview: Readonly<T> } | undefined;
  private pending: { id: number; promise: Promise<TransactionResult> } | undefined;
  private historyPending: Promise<boolean> | undefined;
  private completed: { id: number; promise: Promise<TransactionResult> } | undefined;
  private closing: Promise<void> | undefined;
  private listeners = new Set<(state: TransactionState<T>) => void>();
  private current: TransactionState<T> = Object.freeze({ phase: "idle", gestureId: null, input: null, preview: null, error: null });

  constructor(private readonly document: Pick<DocumentHandle, "applyBatch" | "undo" | "redo">,
    private readonly commands: (initial: Readonly<T>, preview: Readonly<T>) => readonly Command[]) {}

  get state(): TransactionState<T> { return this.current; }
  subscribe(listener: (state: TransactionState<T>) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private publish(state: TransactionState<T>) {
    this.current = Object.freeze(state);
    for (const listener of this.listeners) { try { listener(this.current); } catch { /* Observers cannot invalidate engine work. */ } }
  }
  private idle(error: string | null = null) {
    this.publish({ phase: this.closed ? "closed" : error ? "error" : "idle", gestureId: null, input: null, preview: null, error });
  }

  begin(initial: T, input: TransactionInput = "pointer"): number {
    if (this.closed || this.active || this.pending || this.historyPending) throw new Error("Transaction coordinator is closed or busy");
    if (!["pointer", "touch", "pen", "keyboard", "accessibility", "controller"].includes(input)) throw new RangeError("Unknown transaction input");
    if (!Number.isSafeInteger(this.nextId)) throw new RangeError("Transaction identifiers exhausted");
    const value = ownedJson(initial);
    const id = this.nextId++;
    this.active = { id, input, initial: value, preview: value };
    this.publish({ phase: "preview", gestureId: id, input, preview: value, error: null });
    return id;
  }
  update(id: number, preview: T): boolean {
    if (this.closed || this.active?.id !== id) return false;
    const value = ownedJson(preview);
    this.active.preview = value;
    this.publish({ phase: "preview", gestureId: id, input: this.active.input, preview: value, error: null });
    return true;
  }
  cancel(id: number): boolean {
    if (this.active?.id !== id) return false;
    this.active = undefined; this.idle(); return true;
  }
  commit(id: number): Promise<TransactionResult> {
    if (this.closed) return Promise.reject(new Error("Transaction coordinator is closed"));
    if (this.completed?.id === id) return this.completed.promise;
    if (this.closed || this.active?.id !== id) return Promise.reject(new Error("Stale or closed transaction"));
    const active = this.active; this.active = undefined;
    const operation = Promise.resolve().then(async (): Promise<TransactionResult> => {
      if (equal(active.initial, active.preview)) return { committed: false, result: null };
      const commands = this.commands(active.initial, active.preview);
      if (!commands.length) return { committed: false, result: null };
      const result = await this.document.applyBatch(commands);
      return { committed: result.events.some(event => event.kind === "document:changed"), result };
    }).finally(() => { this.pending = undefined; });
    const promise = operation.then(result => { this.idle(); return result; }, error => {
      this.idle(error instanceof Error ? error.message : String(error)); throw error;
    });
    this.pending = this.completed = { id, promise };
    this.publish({ phase: "committing", gestureId: id, input: active.input, preview: active.preview, error: null });
    return promise;
  }
  private history(direction: "undo" | "redo"): Promise<boolean> {
    if (this.closed || this.pending || this.historyPending) return Promise.reject(new Error("Transaction coordinator is closed or committing"));
    if (this.active) this.cancel(this.active.id);
    const operation = Promise.resolve().then(() => this.document[direction]())
      .finally(() => { this.historyPending = undefined; });
    this.historyPending = operation.then(changed => { this.idle(); return changed; }, error => {
      this.idle(error instanceof Error ? error.message : String(error)); throw error;
    });
    this.publish({ phase: "committing", gestureId: null, input: null, preview: null, error: null });
    return this.historyPending;
  }
  undo(): Promise<boolean> { return this.history("undo"); }
  redo(): Promise<boolean> { return this.history("redo"); }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.active = undefined; this.idle();
    this.closing = (this.pending?.promise.then(() => undefined) ?? this.historyPending?.then(() => undefined) ?? Promise.resolve())
      .finally(() => { this.listeners.clear(); });
    return this.closing;
  }
}
