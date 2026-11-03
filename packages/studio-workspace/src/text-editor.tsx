import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { plainText, textEdit } from './text-diff';

export interface QuillTextEditorHandle {
  flush(): Promise<void>;
  isDirty(): boolean;
}
export interface QuillTextEditorProps {
  state: unknown;
  theme?: 'dark' | 'light';
  apply: (op: string, payload?: unknown) => Promise<unknown>;
  reload: () => Promise<void>;
}
type Draft = { base: string; text: string; busy: boolean; conflict: boolean; error: string | null; status: string };
const errorMessage = (e: unknown) => e instanceof Error ? e.message : String(e);

/** A local essay draft; only Apply text (or a host flush) writes to Quill. */
export const QuillTextEditor = forwardRef<QuillTextEditorHandle, QuillTextEditorProps>(function QuillTextEditor(props, ref) {
  const storeRef = useRef<StoreApi<Draft> | null>(null);
  if (!storeRef.current) {
    const initial = plainText(props.state);
    storeRef.current = createStore<Draft>(() => ({ base: initial, text: initial, busy: false, conflict: false, error: null, status: 'Write your essay here.' }));
  }
  const store = storeRef.current;
  const text = useStore(store, s => s.text);
  const busy = useStore(store, s => s.busy);
  const conflict = useStore(store, s => s.conflict);
  const error = useStore(store, s => s.error);
  const status = useStore(store, s => s.status);
  const dirty = useStore(store, s => s.text !== s.base);
  const current = useRef(props);
  current.current = props;
  const baseline = useRef(JSON.stringify(props.state));
  const pending = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (pending.current || !props.state) return;
    const source = plainText(props.state);
    const draft = store.getState();
    const signature = JSON.stringify(props.state);
    if (signature === baseline.current) return;
    if (draft.text === draft.base) { baseline.current = signature; store.setState({ base: source, text: source, conflict: false, error: null }); }
    else store.setState({ conflict: true, error: 'The document changed while you were writing. Your draft is preserved. Copy it before loading the latest document.' });
  }, [props.state, store]);

  const flush = (): Promise<void> => {
    if (pending.current) return pending.current;
    const work = async () => {
      const draft = store.getState();
      if (draft.busy) throw new Error('Wait for the document operation to finish');
      if (draft.text === draft.base) return;
      if (!current.current.state) throw new Error('The document is still opening');
      if (draft.conflict) throw new Error('Resolve the document conflict before applying your draft');
      store.setState({ busy: true, error: null, status: 'Applying text…' });
      const api = current.current;
      let mutated = false;
      try {
        // Check the engine itself, since a change event may still be in flight.
        const result = await api.apply('describe') as { data: unknown };
        if (!mounted.current) throw new Error('The editor was closed');
        if (JSON.stringify(result.data) !== baseline.current) {
          store.setState({ conflict: true });
          throw new Error('The document changed. Your draft is preserved; copy it before loading the latest document.');
        }
        const edit = textEdit(draft.base, draft.text);
        if (edit.remove) { await api.apply('deleteRange', { from: edit.from, to: edit.to }); mutated = true; }
        if (!mounted.current) throw new Error('The editor was closed');
        if (edit.insert) { await api.apply('insertText', { at: edit.from, text: edit.insert }); mutated = true; }
        const applied = await api.apply('describe') as { data: unknown };
        if (plainText(applied.data) !== draft.text) {
          if (mounted.current) store.setState({ conflict: true });
          throw new Error('The document changed during editing. Your draft is preserved; load the latest document after copying it.');
        }
        if (mounted.current) {
          baseline.current = JSON.stringify(applied.data);
          store.setState({ base: draft.text, conflict: false, status: 'Text applied to your document.' });
        }
        await api.reload();
      } catch (e) {
        if (mutated && mounted.current) {
          try { await api.reload(); } catch { /* Keep the original edit failure. */ }
        }
        if (mounted.current) {
          // A multi-command edit may have applied its deletion. Keep the draft
          // and report a conflict rather than retrying against stale offsets.
          store.setState({ error: errorMessage(e), conflict: store.getState().conflict || mutated, status: 'Text was not fully applied.' });
        }
        throw e;
      } finally {
        if (mounted.current) store.setState({ busy: false });
      }
    };
    pending.current = work().finally(() => { pending.current = null; });
    return pending.current;
  };
  useImperativeHandle(ref, () => ({ flush, isDirty: () => store.getState().text !== store.getState().base }));

  const light = props.theme === 'light';
  const headingColor = light ? '#283329' : '#e8ece5';
  const detailColor = light ? '#53634f' : '#b5bdb5';
  const warningColor = light ? '#a03024' : '#f1a39a';
  const linkColor = light ? '#80510a' : '#e8b66a';
  return <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 14 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={{ color: headingColor, fontSize: 18, flex: 1 }}>Your writing space</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Apply essay text" disabled={busy || !dirty || conflict} onPress={() => { void flush().catch(() => {}); }} style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 6, backgroundColor: '#e8b66a', justifyContent: 'center', opacity: busy || !dirty || conflict ? 0.5 : 1 }}>
        <Text style={{ color: '#202923', fontWeight: '700' }}>{busy ? 'Applying…' : 'Apply text'}</Text>
      </Pressable>
    </View>
    <TextInput accessibilityLabel="Essay text" multiline editable={!busy && !!props.state} value={text}
      onChangeText={value => store.setState({ text: value, error: null, status: 'Draft changes · Apply text to update your document.' })}
      placeholder="Start writing your essay…" placeholderTextColor="#8a9187" textAlignVertical="top"
      style={{ minHeight: 480, padding: 28, backgroundColor: '#f7f5ed', color: '#283329', fontSize: 17, lineHeight: 28, borderRadius: 3 }} />
    <Text accessibilityLiveRegion="polite" style={{ color: error || conflict ? warningColor : detailColor, fontSize: 12 }}>{error ?? (conflict ? 'Your draft conflicts with the latest document.' : status)}</Text>
    {conflict && <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void (async () => {
      store.setState({ busy: true });
      try {
        const api = current.current;
        const result = await api.apply('describe') as { data: unknown };
        if (!mounted.current) return;
        const source = plainText(result.data);
        baseline.current = JSON.stringify(result.data);
        store.setState({ base: source, text: source, conflict: false, error: null, status: 'Latest document loaded.' });
        await api.reload();
      } catch (e) {
        if (mounted.current) store.setState({ error: errorMessage(e) });
      } finally {
        if (mounted.current) store.setState({ busy: false });
      }
    })(); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: linkColor }}>Discard draft and load latest document</Text></Pressable>}
  </ScrollView>;
});
