/** Where a JSON text stops parsing, as a 0-based UTF-16 offset. Equal to the
 * text's trimmed length when the text ends early. `-1` when it parses. */
export function jsonFaultOffset(text: string): number {
  let i = 0;
  const fail = (): never => { throw i; };
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++; };
  const word = (w: string) => { for (const ch of w) { if (text[i] !== ch) fail(); i++; } };
  const string = () => {
    i++;
    for (;;) {
      if (i >= text.length) fail();
      const ch = text[i]!;
      if (ch === '"') { i++; return; }
      if (ch < ' ') fail();
      if (ch === '\\') {
        i++;
        if (text[i] === 'u') { for (let k = 0; k < 4; k++) { i++; if (!/[0-9a-fA-F]/.test(text[i] ?? '')) fail(); } }
        else if (!'"\\/bfnrt'.includes(text[i] ?? '\0')) fail();
      }
      i++;
    }
  };
  const value = (): void => {
    ws();
    const ch = text[i];
    if (ch === '{') {
      i++; ws();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        ws(); if (text[i] !== '"') fail(); string(); ws();
        if (text[i] !== ':') fail(); i++; value(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return; }
        fail();
      }
    }
    if (ch === '[') {
      i++; ws();
      if (text[i] === ']') { i++; return; }
      for (;;) {
        value(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return; }
        fail();
      }
    }
    if (ch === '"') return string();
    if (ch === 't') return word('true');
    if (ch === 'f') return word('false');
    if (ch === 'n') return word('null');
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!number) fail();
    i += number![0].length;
  };
  try { value(); ws(); if (i < text.length) fail(); return -1; }
  catch (at) { return typeof at === 'number' ? at : 0; }
}

/** The offset an engine's `JSON.parse` error names, when it names one (V8:
 * "… in JSON at position 31 (line 1 column 32)"). */
function reportedOffset(error: unknown): number | undefined {
  const text = error instanceof Error ? error.message : String(error ?? '');
  const at = /position (\d+)/.exec(text);
  return at ? Number(at[1]) : undefined;
}

/** Recovery copy for JSON that failed to parse: where it stops and what to do.
 * Uses the position the engine reported; engines that report none (Safari,
 * Hermes, V8 on an unexpected token) get the same offset from a scan. */
export function jsonProblem(text: string, error?: unknown): string {
  const offset = reportedOffset(error) ?? jsonFaultOffset(text);
  const end = text.trimEnd().length;
  if (end === 0) return 'The text is empty. Paste the whole file and try again.';
  if (offset < 0 || offset >= end) return `Ends early at character ${end}. Paste the whole file and try again.`;
  const line = text.slice(0, offset).split('\n').length;
  const where = line > 1 ? `line ${line}, character ${offset - text.lastIndexOf('\n', offset - 1)}` : `character ${offset + 1}`;
  return `Stops at ${where}, at “${text[offset]}”. Paste the file exactly as exported and try again.`;
}
