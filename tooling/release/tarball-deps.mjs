/**
 * Pack-time dependency rewrite for Forge's GitHub Release tarballs.
 *
 * Forge never publishes to npm and nobody owns the `@nitro-forge` scope there,
 * so a packed manifest that names `@nitro-forge/ignition@0.1.0` would make an
 * outside install 404, or fetch whatever a stranger publishes under that name.
 * `pnpm pack` turns `workspace:*` into the bare workspace version; this module
 * then points every `@nitro-forge/*` dependency, peer and optional dependency
 * at the release tarball for that version, the way `@nyc-tron/ui` is consumed:
 *
 *   https://github.com/mikevocalz/nitro-forge/releases/download/v<version>/<file>.tgz
 *
 * Source package.json files keep `workspace:*`. Only the package.json inside
 * the tarball changes, edited in place so every other tar member keeps its
 * bytes. `@nitro-forge/*` devDependencies are dropped from the packed manifest:
 * consumers never install them, and several name private workspace packages
 * that have no tarball.
 *
 * No process spawning and no network here; pack-tarballs.mjs drives `pnpm pack`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

export const RELEASE_REPO = "mikevocalz/nitro-forge";
export const FORGE_SCOPE = "@nitro-forge/";

/**
 * Ignition plus the seven headless engines (RELEASE_TRAIN.md invariants). The
 * same list as RELEASE_PACKAGES in PR #94's package-verify.mjs; keep one copy
 * when the two land together.
 */
export const RELEASE_PACKAGES = Object.freeze([
  "ignition", "prism", "cadence", "splice", "folio", "pitch", "tally", "quill",
]);

/** Fields a consumer's installer reads. */
export const INSTALL_FIELDS = Object.freeze(["dependencies", "peerDependencies", "optionalDependencies"]);
const ALL_FIELDS = [...INSTALL_FIELDS, "devDependencies"];
const LOCAL_PROTOCOL = /^(workspace|link|portal|catalog):/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SCOPED_NAME = /^@nitro-forge\/[a-z0-9][a-z0-9._-]*$/;

/** The file name `pnpm pack` writes for a package: `@nitro-forge/prism` 0.1.0 -> nitro-forge-prism-0.1.0.tgz. */
export function tarballFileName(name, version) {
  if (!SCOPED_NAME.test(name)) throw new Error(`Not a @nitro-forge package name: ${name}`);
  if (!VERSION.test(version)) throw new Error(`Not a release version for ${name}: ${version}`);
  return `${name.slice(1).replace("/", "-")}-${version}.tgz`;
}

/** The GitHub Release asset URL for one package version. */
export function releaseTarballUrl(name, version) {
  return `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${tarballFileName(name, version)}`;
}

/**
 * Map of workspace package name to `{ version, private }`, from parsed
 * package.json files.
 */
export function workspaceIndex(manifests) {
  const index = new Map();
  for (const pkg of manifests) {
    if (typeof pkg?.name === "string") index.set(pkg.name, { version: pkg.version, private: pkg.private === true });
  }
  return index;
}

function releaseTarget(dep, workspace) {
  const entry = workspace.get(dep);
  if (!entry) return { error: "is not a workspace package" };
  if (entry.private) return { error: "is private and has no release tarball" };
  try {
    return { url: releaseTarballUrl(dep, entry.version) };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Rewrite the manifest `pnpm pack` produced.
 * @param {object} packed parsed package.json from the tarball (not mutated)
 * @param {object} options
 * @param {object} options.source the workspace package.json it was packed from
 * @param {Map<string, {version: string, private: boolean}>} options.workspace see workspaceIndex
 * @returns {{ manifest: object, errors: string[] }}
 */
export function rewriteForgeDependencies(packed, { source, workspace }) {
  const manifest = structuredClone(packed);
  const errors = [];
  const label = source.name ?? "(unnamed)";
  for (const field of INSTALL_FIELDS) {
    for (const [dep, spec] of Object.entries(source[field] ?? {})) {
      // Any other spec is left as packed for checkPackedManifest to judge.
      if (!String(spec).startsWith("workspace:")) continue;
      const target = releaseTarget(dep, workspace);
      if (target.error) {
        errors.push(`${label}: ${field}.${dep} ${target.error}`);
        continue;
      }
      manifest[field] = { ...manifest[field], [dep]: target.url };
    }
  }
  if (manifest.devDependencies) {
    const kept = Object.fromEntries(Object.entries(manifest.devDependencies).filter(([dep]) =>
      !dep.startsWith(FORGE_SCOPE) && !String(source.devDependencies?.[dep] ?? "").startsWith("workspace:")));
    if (Object.keys(kept).length) manifest.devDependencies = kept;
    else delete manifest.devDependencies;
  }
  return { manifest, errors };
}

/**
 * Fail-closed check of a packed manifest: no workspace-only protocol in any
 * dependency field, no `@nitro-forge/*` devDependency, and every
 * `@nitro-forge/*` install-time spec is exactly the release tarball URL of
 * that workspace package's version (a registry range such as "0.1.0" or
 * "^0.1.0", or any other URL, fails).
 */
export function checkPackedManifest(manifest, { workspace }) {
  const errors = [];
  const label = manifest.name ?? "(unnamed)";
  for (const field of ALL_FIELDS) {
    for (const [dep, spec] of Object.entries(manifest[field] ?? {})) {
      if (LOCAL_PROTOCOL.test(String(spec))) errors.push(`${label}: ${field}.${dep} still uses ${spec}`);
      else if (field !== "devDependencies" && String(spec).startsWith("file:")) errors.push(`${label}: ${field}.${dep} is a local path, ${spec}`);
      if (!dep.startsWith(FORGE_SCOPE)) continue;
      if (field === "devDependencies") {
        errors.push(`${label}: devDependencies.${dep} must not ship in a release tarball`);
        continue;
      }
      const target = releaseTarget(dep, workspace);
      if (target.error) errors.push(`${label}: ${field}.${dep} ${target.error}`);
      else if (spec !== target.url) {
        errors.push(`${label}: ${field}.${dep} is ${JSON.stringify(spec)}, expected the release tarball ${target.url}`);
      }
    }
  }
  for (const dep of [manifest.bundleDependencies, manifest.bundledDependencies].flat()) {
    if (typeof dep === "string" && dep.startsWith(FORGE_SCOPE)) errors.push(`${label}: bundles ${dep}`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// In-place tar edit. `pnpm pack` writes ustar members with short names; the
// one member replaced here is `package/package.json`. A pax or GNU long-name
// header in front of it would carry its own size or path, so that case throws
// rather than guess.

const BLOCK = 512;
const PACKAGE_JSON = "package/package.json";

function field(header, start, length) {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString("utf8");
}

function headerChecksum(header) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i];
  return sum;
}

/** Members of an uncompressed tar: `{ name, type, offset, size }`, in order. */
export function tarMembers(tar) {
  const members = [];
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break;
    if (headerChecksum(header) !== parseInt(field(header, 148, 8).trim(), 8)) {
      throw new Error(`Bad tar header checksum at byte ${offset}`);
    }
    const name = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const size = parseInt(field(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 0x30);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Unsupported tar size field for ${name} at byte ${offset}`);
    members.push({ name: prefix ? `${prefix}/${name}` : name, type, offset, size });
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return members;
}

/** Read one regular member's bytes from a .tgz buffer. */
export function readTarEntry(tgz, entryName) {
  const tar = gunzipSync(tgz);
  const hits = tarMembers(tar).filter((m) => m.name === entryName && (m.type === "0" || m.type === "\0"));
  if (hits.length !== 1) throw new Error(`Expected one ${entryName} in the tarball, found ${hits.length}`);
  const start = hits[0].offset + BLOCK;
  return tar.subarray(start, start + hits[0].size);
}

/** Return a new .tgz with one regular member's content replaced; every other byte of the tar is kept. */
export function replaceTarEntry(tgz, entryName, content) {
  const tar = gunzipSync(tgz);
  const members = tarMembers(tar);
  const index = members.findIndex((m) => m.name === entryName);
  if (index === -1) throw new Error(`${entryName} is not in the tarball`);
  if (members.filter((m) => m.name === entryName).length > 1) throw new Error(`${entryName} appears twice in the tarball`);
  const member = members[index];
  if (member.type !== "0" && member.type !== "\0") throw new Error(`${entryName} is not a regular file (type ${member.type})`);
  if (index > 0 && ["x", "g", "L", "K"].includes(members[index - 1].type)) {
    throw new Error(`${entryName} has a ${members[index - 1].type} extension header; refusing to edit it in place`);
  }
  const body = Buffer.from(content);
  if (body.length > 0o77777777777) throw new Error(`${entryName} is too large for a ustar header`);
  const header = Buffer.from(tar.subarray(member.offset, member.offset + BLOCK));
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write(headerChecksum(header).toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
  body.copy(padded);
  const end = member.offset + BLOCK + Math.ceil(member.size / BLOCK) * BLOCK;
  return gzipSync(Buffer.concat([tar.subarray(0, member.offset), header, padded, tar.subarray(end)]), { level: 9 });
}

/**
 * Rewrite and check `package/package.json` inside a packed tarball. The file
 * is rewritten only when there are no errors; on errors it is left as packed
 * and the caller should discard it.
 * @returns {{ manifest: object, errors: string[] }}
 */
export function rewritePackedTarball(tarballPath, { source, workspace }) {
  const tgz = readFileSync(tarballPath);
  const text = readTarEntry(tgz, PACKAGE_JSON).toString("utf8");
  const { manifest, errors } = rewriteForgeDependencies(JSON.parse(text), { source, workspace });
  errors.push(...checkPackedManifest(manifest, { workspace }));
  if (errors.length) return { manifest, errors: [...new Set(errors)] };
  const json = JSON.stringify(manifest, null, 2) + (text.endsWith("\n") ? "\n" : "");
  writeFileSync(tarballPath, replaceTarEntry(tgz, PACKAGE_JSON, json));
  // Read the written file back so a broken edit cannot pass silently.
  const written = JSON.parse(readTarEntry(readFileSync(tarballPath), PACKAGE_JSON).toString("utf8"));
  return { manifest: written, errors: checkPackedManifest(written, { workspace }) };
}
