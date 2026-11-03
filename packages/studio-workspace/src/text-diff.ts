/** Quill offsets count Unicode codepoints and use newlines between blocks. */
export type TextPosition = { block: number; offset: number };
export function textPosition(text: string, offset: number): TextPosition {
  let block = 0;
  let column = 0;
  const points = Array.from(text);
  if (!Number.isInteger(offset) || offset < 0 || offset > points.length) throw new Error('Invalid text offset');
  for (let i = 0; i < offset; i++) {
    if (points[i] === '\n') { block++; column = 0; } else column++;
  }
  return { block, offset: column };
}
export function plainText(state: unknown): string {
  const blocks = (state as { blocks?: { inlines?: { text?: string }[] }[] } | null)?.blocks;
  return Array.isArray(blocks) ? blocks.map(b => b.inlines?.map(i => i.text ?? '').join('') ?? '').join('\n') : '';
}
export function textEdit(before: string, after: string) {
  const a = Array.from(before), b = Array.from(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  return { from: textPosition(before, start), to: textPosition(before, endA),
    remove: endA > start, insert: b.slice(start, endB).join('') };
}
