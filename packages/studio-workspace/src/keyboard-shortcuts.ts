/**
 * The pro keyboard layer for hardware keyboards (web, iPad, desktop): Undo,
 * Redo, Save and Open on the platform's command key. Pure, so the workspace
 * and tests share one definition; index.tsx wires it to the document.
 *
 * Mac, iPhone and iPad use ⌘ (iPadOS Safari reports a Mac platform, which is
 * what an iPad keyboard sends); everything else uses Ctrl. Redo is ⇧⌘Z, and
 * Ctrl+Y as well off Apple platforms. A shortcut typed into a text field is
 * left to the field, so ⌘Z there undoes typing rather than the document.
 */
export type StudioShortcut = 'undo' | 'redo' | 'save' | 'open' | 'help';

type KeyFields = {
  readonly key?: string | undefined;
  readonly metaKey?: boolean | undefined;
  readonly ctrlKey?: boolean | undefined;
  readonly shiftKey?: boolean | undefined;
  readonly altKey?: boolean | undefined;
  readonly repeat?: boolean | undefined;
  readonly target?: unknown;
};
/** A DOM KeyboardEvent, a React synthetic event or a React Native key event. */
export type ShortcutKeyEvent = KeyFields & {
  readonly nativeEvent?: KeyFields | undefined;
  preventDefault?: (() => void) | undefined;
};

/** True for Apple platforms, where the command key is ⌘. */
export function isApplePlatform(os: string, platform = ''): boolean {
  return os === 'ios' || os === 'macos' || /Mac|iPhone|iPad|iPod/.test(platform);
}

const field = <K extends keyof KeyFields>(event: ShortcutKeyEvent, name: K): KeyFields[K] | undefined =>
  event[name] ?? event.nativeEvent?.[name];

/** The shortcut an event asks for, or null. */
export function studioShortcut(event: ShortcutKeyEvent, apple: boolean): StudioShortcut | null {
  const key = field(event, 'key')?.toLowerCase();
  const meta = !!field(event, 'metaKey'), ctrl = !!field(event, 'ctrlKey');
  if (!key || field(event, 'altKey')) return null;
  // Only the platform's command key: Ctrl+Z on a Mac is not undo.
  if (apple ? !meta || ctrl : !ctrl || meta) return null;
  const shift = !!field(event, 'shiftKey');
  const repeat = !!field(event, 'repeat');
  if (key === 'z') return shift ? 'redo' : 'undo';
  if (key === 'y' && !apple && !shift) return 'redo';
  // Holding S or O must not save or open again and again.
  if (repeat) return null;
  if (key === 's' && !shift) return 'save';
  if (key === 'o' && !shift) return 'open';
  if (key === '/' || key === '?') return 'help';
  return null;
}

const appleLabels: Record<StudioShortcut, string> = { undo: '⌘Z', redo: '⇧⌘Z', save: '⌘S', open: '⌘O', help: '⌘/' };
const otherLabels: Record<StudioShortcut, string> = { undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z', save: 'Ctrl+S', open: 'Ctrl+O', help: 'Ctrl+/' };

/** The keys as people read them: "⇧⌘Z" or "Ctrl+Shift+Z". */
export function shortcutLabel(shortcut: StudioShortcut, apple: boolean): string {
  return (apple ? appleLabels : otherLabels)[shortcut];
}

/** "Undo (⌘Z)": the accessible name of a control that has a shortcut. */
export function withShortcut(label: string, shortcut: StudioShortcut, apple: boolean): string {
  return `${label} (${shortcutLabel(shortcut, apple)})`;
}

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** True when the key went to a place people type: a text input, text area, select or editable region. */
export function isTextEntryTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const node = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown; getAttribute?: (name: string) => string | null };
  const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(String(node.type ?? 'text').toLowerCase());
  if (node.isContentEditable === true) return true;
  return node.getAttribute?.('role') === 'textbox';
}

export type ShortcutHandlers = {
  undo: () => void; redo: () => void; save: () => void;
  /** Absent when the host has no way to open a document; ⌘O is then left to the browser. */
  open?: (() => void) | undefined;
  help?: (() => void) | undefined;
};

/** Run the shortcut an event asks for. Returns true and stops the browser's own action when it ran one. */
export function dispatchStudioShortcut(event: ShortcutKeyEvent, apple: boolean, handlers: ShortcutHandlers): boolean {
  const shortcut = studioShortcut(event, apple);
  if (!shortcut || isTextEntryTarget(field(event, 'target'))) return false;
  const run = handlers[shortcut];
  if (!run) return false;
  event.preventDefault?.();
  run();
  return true;
}

/** Every shortcut, in the order the help sheet lists them. */
export const STUDIO_SHORTCUTS: readonly { shortcut: StudioShortcut; label: string }[] = [
  { shortcut: 'undo', label: 'Undo' },
  { shortcut: 'redo', label: 'Redo' },
  { shortcut: 'save', label: 'Save' },
  { shortcut: 'open', label: 'Open a document' },
  { shortcut: 'help', label: 'Show keyboard shortcuts' },
];
