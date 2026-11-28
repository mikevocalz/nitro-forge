/**
 * Props for components whose optional props don't accept `undefined`.
 *
 * Forge compiles with `exactOptionalPropertyTypes`, so `message?: string`
 * accepts a string or no `message` key, never `message={undefined}`.
 * NYC-Tron UI declares its optional props that way. This drops every key
 * whose value is `undefined`, which React already treats as not set, so the
 * call site keeps the same behavior and type-checks.
 *
 * Only use it where nothing earlier in the same props sets the key: unlike
 * `key={undefined}`, a dropped key doesn't override an earlier spread.
 */
export type ExactOptional<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

export function exact<T extends object>(props: T): ExactOptional<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) if (value !== undefined) out[key] = value;
  return out as ExactOptional<T>;
}
