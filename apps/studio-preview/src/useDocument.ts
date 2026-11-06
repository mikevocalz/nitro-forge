import { useCallback, useEffect, useRef } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  DocumentHandle,
  type CommandResult,
  type EngineHost,
  type ForgeEvent,
} from "@nitro-forge/ignition";

import { browserHost } from "./host";
const getHost = () => browserHost;

export interface EditorDoc {
  /** The typed product document (any of the seven). */
  doc: unknown;
  /** Latest describe() snapshot after each change; null until first load. */
  state: unknown;
  error: string | null;
  apply: <T = unknown>(op: string, payload?: unknown) => Promise<CommandResult<T>>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  save: () => Promise<Uint8Array>;
  reload: () => Promise<void>;
}

interface EditorState {
  ready: boolean;
  state: unknown;
  error: string | null;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Opens a document and keeps a serializable view of its latest engine state. */
export function useEditorDoc(
  open: (host: EngineHost) => Promise<{ handle: DocumentHandle }>,
): EditorDoc {
  const storeRef = useRef<StoreApi<EditorState> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createStore<EditorState>(() => ({ ready: false, state: null, error: null }));
  }
  const store = storeRef.current;
  const ready = useStore(store, (s) => s.ready);
  const state = useStore(store, (s) => s.state);
  const error = useStore(store, (s) => s.error);
  const docRef = useRef<{ handle: DocumentHandle } | null>(null);
  const generationRef = useRef(0);
  const reloadRef = useRef(0);

  const reload = useCallback(async () => {
    const d = docRef.current;
    if (!d) return;
    const generation = generationRef.current;
    const request = ++reloadRef.current;
    const current = () => generation === generationRef.current && d === docRef.current && request === reloadRef.current;
    try {
      const res = await d.handle.apply("describe");
      if (current()) store.setState({ state: res.data, error: null });
    } catch (e) {
      if (current()) store.setState({ error: message(e) });
    }
  }, [store]);

  useEffect(() => {
    const generation = ++generationRef.current;
    let owned: { handle: DocumentHandle } | null = null;
    let off: (() => void) | undefined;
    store.setState({ ready: false, state: null, error: null });
    void (async () => {
      try {
        const d = await open(getHost());
        if (generation !== generationRef.current) {
          await d.handle.close();
          return;
        }
        owned = d;
        docRef.current = d;
        off = d.handle.on((e: ForgeEvent) => {
          if (e.kind === "document:changed" || e.kind === "document:restored") void reload();
        });
        store.setState({ ready: true });
        await reload();
      } catch (e) {
        if (generation === generationRef.current) store.setState({ error: message(e) });
      }
    })();
    return () => {
      ++generationRef.current;
      ++reloadRef.current;
      off?.();
      if (docRef.current === owned) docRef.current = null;
      // Closing is best-effort during teardown; never reject an unobserved promise.
      if (owned) void owned.handle.close().catch(() => {});
    };
  }, [open, reload, store]);

  const apply = useCallback(
    async <T,>(op: string, payload?: unknown): Promise<CommandResult<T>> => {
      const d = docRef.current;
      if (!d) throw new Error("no document");
      const generation = generationRef.current;
      try {
        return await d.handle.apply<T>(op, payload);
      } catch (e) {
        if (generation === generationRef.current && d === docRef.current) store.setState({ error: message(e) });
        throw e;
      }
    },
    [store],
  );

  const history = useCallback(async (op: "undo" | "redo") => {
    const d = docRef.current;
    if (!d) return;
    const generation = generationRef.current;
    try {
      await d.handle[op]();
      if (generation === generationRef.current && d === docRef.current) await reload();
    } catch (e) {
      if (generation === generationRef.current && d === docRef.current) store.setState({ error: message(e) });
      throw e;
    }
  }, [reload, store]);
  const undo = useCallback(() => history("undo"), [history]);
  const redo = useCallback(() => history("redo"), [history]);
  const save = useCallback(async () => {
    const d = docRef.current;
    if (!d) throw new Error("no document");
    return d.handle.snapshot();
  }, []);

  return { doc: ready ? docRef.current : null, state, error, apply, undo, redo, save, reload };
}
