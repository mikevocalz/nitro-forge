/**
 * Pure helpers for tooling/check-skia-v3.mjs, kept separate so the policy
 * rules have unit tests (tooling/skia-v3-policy.test.mjs).
 */

/**
 * Compare dotted numeric versions ("16.4", "16.10", "26") component by
 * component. Number("16.10") is 16.1, so a plain numeric compare would reject
 * iOS 16.10 against a 16.4 floor.
 */
export function versionAtLeast(actual, floor) {
  const parts = (v) => {
    const text = String(v);
    if (!/^\d+(\.\d+)*$/.test(text)) {
      throw new Error(`Expected a dotted numeric version, got ${JSON.stringify(v)}`);
    }
    return text.split(".").map(Number);
  };
  const a = parts(actual);
  const f = parts(floor);
  for (let i = 0; i < Math.max(a.length, f.length); i += 1) {
    const x = a[i] ?? 0;
    const y = f[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** Distinct versions of `name` declared in a pnpm v9 lockfile. */
export function lockfileVersions(lockText, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^ {2}'?${escaped}@([^:'(\\s]+)`, "gm");
  return new Set([...lockText.matchAll(pattern)].map((m) => m[1]));
}

/**
 * Distinct versions of `name` laid out in node_modules/.pnpm. pnpm names a
 * package directory `<name>@<version>` and appends `_<peer hash>` when peers
 * differ, so one version can own several directories. Count versions, not
 * directories.
 */
export function storeVersions(entries, name) {
  const prefix = `${name.replace("/", "+")}@`;
  return new Set(
    entries
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => entry.slice(prefix.length).split("_")[0]),
  );
}
