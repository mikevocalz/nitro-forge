export const MAESTRO = Object.freeze({
  version: "2.12.1",
  revision: "67d8a677029261fa424a45a10d08eacd6aa0deed",
  archiveSha256: "54dbb0716425626604973cbb374c585ca30272375d9ce15177a1152765ddd9d7",
  url: "https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.12.1/maestro.zip",
});

/** A successful process exit must still contain an executed, passing JUnit case. */
export function requirePassedFlow(xml) {
  const cases = [...xml.matchAll(/<testcase\b[^>]*>/g)];
  if (cases.length !== 1 || !/\bstatus=["']SUCCESS["']/.test(cases[0]?.[0] ?? "") || /<(?:failure|error|skipped)\b/.test(xml) ||
      /\b(?:failures|errors|skipped)=["'][1-9][0-9]*["']/.test(xml) || !/<testsuite\b/.test(xml) ||
      !/<\/testsuite>/.test(xml) || !/<\/testsuites>\s*$/.test(xml)) {
    throw new Error("Native UI acceptance requires one executed passing flow, without errors or skips");
  }
  return { executed: 1, failures: 0, skipped: 0 };
}

export function parseHierarchy(text) {
  // The pinned CLI prints a JSON TreeNode after any startup diagnostics.
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Native UI accessibility hierarchy is missing");
  const root = JSON.parse(text.slice(start, end + 1));
  hierarchyNodes(root);
  return root;
}

export function hierarchyNodes(root) {
  const nodes = [], pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object" || !node.attributes || typeof node.attributes !== "object" ||
        !Array.isArray(node.children) || nodes.length >= 100000) throw new Error("Invalid native accessibility tree");
    nodes.push(node); pending.push(...node.children);
  }
  return nodes;
}

export function requireSemanticLabels(tree, labels) {
  const attributes = hierarchyNodes(tree).flatMap(node => Object.values(node.attributes)).filter(value => typeof value === "string");
  for (const label of labels) {
    if (!attributes.some(value => value.includes(label))) throw new Error("Native accessibility tree lacks " + label);
  }
}

/** Verify safe-area composition from native screen geometry, not JS layout calculations. */
export function requireReferenceHostBounds(tree) {
  const nodes = hierarchyNodes(tree);
  const observed = id => {
    const matches = nodes.filter(node => {
      const value = node.attributes["resource-id"];
      return value === id || typeof value === "string" && value.endsWith(":id/" + id);
    });
    if (matches.length !== 1) throw new Error("Native geometry needs one observed " + id);
    const value = matches[0].attributes.bounds;
    const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value ?? "");
    if (!match) throw new Error("Native geometry lacks valid bounds for " + id);
    const [left, top, right, bottom] = match.slice(1).map(Number);
    if (![left, top, right, bottom].every(Number.isSafeInteger) || left < 0 || top < 0 || right <= left || bottom <= top) {
      throw new Error("Native geometry has invalid bounds for " + id);
    }
    return { left, top, right, bottom };
  };
  const host = observed("reference-safe-content");
  const header = observed("reference-header"), tabs = observed("reference-bottom-tabs");
  for (const [name, bounds] of [["reference-header", header], ["reference-bottom-tabs", tabs]]) {
    if (bounds.left < host.left || bounds.top < host.top || bounds.right > host.right || bounds.bottom > host.bottom) {
      throw new Error(name + " escapes the observed native safe content: " + JSON.stringify({ host, bounds }));
    }
  }
  return { host, header, tabs };
}

/** Coordinates come from the actual OS accessibility tree, never a guessed screen position. */
export function nativeElementCenter(tree, label) {
  const node = hierarchyNodes(tree).find(node => Object.values(node.attributes).some(value => value === label));
  const bounds = node?.attributes?.bounds;
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(bounds ?? "");
  if (!match) throw new Error("Native input surface has no observed screen bounds");
  const [left, top, right, bottom] = match.slice(1).map(Number);
  if (right <= left || bottom <= top || left < 0 || top < 0) throw new Error("Native input surface bounds are invalid");
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}
