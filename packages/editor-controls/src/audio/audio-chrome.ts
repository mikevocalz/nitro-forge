/** App-owned interaction geometry shared by compound audio controls. */
export function audioTargetSize(value = 44): number {
  if (!Number.isFinite(value) || value < 44) throw new RangeError('Audio target must be at least 44 points');
  return value;
}
/** Undefined translations retain defaults; blank static labels cannot erase names. */
export function audioCopy<T extends object>(defaults: T, overrides?: Partial<T>): T {
  const supplied = Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined);
  if (supplied.some(([, value]) => typeof value === 'string' && !value.trim())) throw new RangeError('Audio labels must be nonempty');
  return { ...defaults, ...Object.fromEntries(supplied) };
}
