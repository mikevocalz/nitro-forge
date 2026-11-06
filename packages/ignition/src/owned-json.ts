/** Owned values are bounded JSON data, never native resources or handles. */
export function ownedJson<T>(value: T): Readonly<T> {
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  let text = 0;
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > 100_000 || depth > 64) throw new RangeError("JSON data exceeds bounds");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      text += value.length;
      if (text > 1024 * 1024) throw new RangeError("JSON data text exceeds bounds");
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object" || ancestors.has(value))
      throw new TypeError("JSON data must be finite, acyclic JSON data");
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw new TypeError("Native resources and class instances cannot be owned JSON data");
    if (Array.isArray(value) && value.length > 100_000) throw new RangeError("JSON data exceeds bounds");
    ancestors.add(value);
    const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : Object.create(null);
    const keys = Array.isArray(value) ? Array.from({ length: value.length }, (_, i) => String(i)) : Object.keys(value);
    if (keys.length > 100_000) throw new RangeError("JSON data exceeds bounds");
    for (const key of keys) {
      text += key.length;
      if (text > 1024 * 1024) throw new RangeError("JSON data text exceeds bounds");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new TypeError("JSON accessors and sparse arrays are unsupported");
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true });
    }
    ancestors.delete(value);
    return Object.freeze(result);
  }
  return copy(value, 0) as Readonly<T>;
}

