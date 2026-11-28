/** Restore app-owned transient previews without committing a cancelled gesture. */
export function cancelPreview<T>(
  value: T,
  restore: (value: T) => void,
  onPreview?: (value: T) => void,
): void {
  restore(value);
  onPreview?.(value);
}
