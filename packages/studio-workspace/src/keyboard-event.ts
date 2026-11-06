/** RNWeb exposes key directly; native RN keyboard events carry it in nativeEvent. */
export type StudioKeyboardEvent = {
  readonly key?: string;
  readonly nativeEvent?: { readonly key?: string };
};
export function keyboardKey(event: StudioKeyboardEvent): string | undefined {
  return event.key ?? event.nativeEvent?.key;
}
