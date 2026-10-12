import { useCallback, useEffect, useRef, useState } from "react";
import {
  DocumentHandle,
  createNitroHost,
  type EngineHost,
  type ForgeEvent,
} from "@nitro-forge/ignition";

let sharedHost: EngineHost | undefined;

/** Lazily create the app-wide Nitro host (one Forge HybridObject per app). */
export function getHost(): EngineHost {
  sharedHost ??= createNitroHost();
  return sharedHost;
}

export interface EditorDoc {
  /** The typed product document (any of the seven). */
  doc: unknown;
  /** Latest describe() snapshot after each change; null until first load. */
  state: unknown;
  error: string | null;
  apply: (op: string, payload?: unknown) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  save: () => Promise<Uint8Array>;
  reload: () => Promise<void>;
}

/**
 * Binds a product document to React state: opens it, subscribes to engine
 * events, and re-reads `describe` after every document:changed.
 */
export function useEditorDoc(
  open: (host: EngineHost) => Promise<{ handle: DocumentHandle }>,
): EditorDoc {
  const [doc, setDoc] = useState<{ handle: DocumentHandle } | null>(null);
  const [state, setState] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<{ handle: DocumentHandle } | null>(null);

  const reload = useCallback(async () => {
    const d = docRef.current;
    if (!d) return;
    const res = await d.handle.apply("describe");
    setState(res.data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | undefined;
    open(getHost())
      .then((d) => {
        if (cancelled) {
          void d.handle.close();
          return;
        }
        docRef.current = d;
        setDoc(d);
        off = d.handle.on((e: ForgeEvent) => {
          if (e.kind === "document:changed" || e.kind === "document:restored") {
            void reload();
          }
        });
        void reload();
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      off?.();
      void docRef.current?.handle.close();
      docRef.current = null;
    };
  }, [open, reload]);

  const apply = useCallback(async (op: string, payload?: unknown) => {
    const d = docRef.current;
    if (!d) return;
    try {
      await d.handle.apply(op, payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return {
    doc,
    state,
    error,
    apply,
    undo: async () => {
      await docRef.current?.handle.undo();
      await reload();
    },
    redo: async () => {
      await docRef.current?.handle.redo();
      await reload();
    },
    save: async () => {
      const d = docRef.current;
      if (!d) throw new Error("no document");
      return d.handle.snapshot();
    },
    reload,
  };
}
