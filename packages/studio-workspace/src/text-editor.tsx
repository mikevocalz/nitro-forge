import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Platform } from 'react-native';
import { Button, Banner, ScrollView, Text, TextInput, View } from './ui';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { workspaceThemes, workspaceScale as scale } from './theme';
import { ForgeIcon } from '@nitro-forge/icons/native';
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
  documentTitle?: string;
}
type Draft = { width: number; base: string; text: string; busy: boolean; conflict: boolean; error: string | null; status: string };
const errorMessage = (e: unknown) => e instanceof Error ? e.message : String(e);

/** A local essay draft; only Apply text (or a host flush) writes to Quill. */
export const QuillTextEditor = forwardRef<QuillTextEditorHandle, QuillTextEditorProps>(function QuillTextEditor(props, ref) {
  const storeRef = useRef<StoreApi<Draft> | null>(null);
  if (!storeRef.current) {
    const initial = plainText(props.state);
    storeRef.current = createStore<Draft>(() => ({ width: 800, base: initial, text: initial, busy: false, conflict: false, error: null, status: 'Write your essay here.' }));
  }
  const store = storeRef.current;
  const width = useStore(store, s => s.width);
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

  const loadLatest = async () => {
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
  };
  const manuscriptFont = Platform.OS === 'android' ? 'serif' : scale.font.serif;
  const colors = workspaceThemes[props.theme ?? 'dark'];
  const wordCount = text.trim() ? text.trim().split(/\s+/u).length : 0;
  const compact = width < 600;
  return <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled"
    onLayout={event => { const next = event.nativeEvent.layout.width; if (next > 0 && next !== store.getState().width) store.setState({ width: next }); }}
    contentContainerStyle={{ paddingHorizontal: compact ? 16 : 40, paddingTop: compact ? 18 : 32, paddingBottom: 48, gap: 16 }}>
    <View style={{ width: '100%', maxWidth: 792, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ForgeIcon name="file" size={14} color={colors.muted} reducedMotion />
        <Text style={{ color: colors.muted, fontSize: 11 }}>{wordCount} {wordCount === 1 ? 'word' : 'words'}{dirty ? ' · Draft changes' : ' · Up to date'}</Text>
      </View>
      <Button aria-label="Apply essay text" title={busy ? 'Applying…' : 'Apply text'} disabled={busy || !dirty || conflict} loading={busy}
        onPress={() => { void flush().catch(() => {}); }} variant={dirty ? 'primary' : 'ghost'} tone="carolina" size="sm" cornerRadius={scale.radius.control} className="rounded-[4px]"
        icon={<ForgeIcon name="check" size={16} color={colors.accent} reducedMotion />} />
    </View>
    <View style={{ width: '100%', maxWidth: 792, alignSelf: 'center', minHeight: 760, backgroundColor: colors.paper,
      borderRadius: scale.radius.paper, paddingHorizontal: compact ? 24 : 64, paddingTop: compact ? 36 : 56, paddingBottom: 64,
      boxShadow: '0 8px 40px rgba(0,0,0,0.12)' }}>
      <TextInput accessibilityLabel="Essay text" multiline editable={!busy && !!props.state} value={text}
        onChangeText={value => store.setState({ text: value, error: null, status: 'Draft changes · Apply text to update your document.' })}
        placeholder="Begin writing…" placeholderTextColor={colors.paperMuted} textAlignVertical="top"
        style={{ minHeight: 480, padding: 0, backgroundColor: 'transparent', color: colors.paperInk, fontFamily: manuscriptFont,
          fontSize: compact ? 17 : 19, lineHeight: compact ? 29 : 34, borderWidth: 0 }} />
    </View>
    {(error || conflict || dirty) && <View style={{ maxWidth: 792, width: '100%', alignSelf: 'center' }}><Banner tone={error || conflict ? 'danger' : 'info'} title={error ?? (conflict ? 'Your draft conflicts with the latest document.' : status)} live={error || conflict ? 'alert' : 'status'} className="rounded-[4px]" /></View>}
    {conflict && <Button title="Discard draft and load latest document" aria-label="Discard draft and load latest document" disabled={busy} onPress={() => { void loadLatest(); }} variant="ghost" tone="carolina" size="sm" cornerRadius={scale.radius.control} className="rounded-[4px]" />}
  </ScrollView>;
});
