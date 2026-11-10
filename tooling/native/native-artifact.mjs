import { createHash } from "node:crypto";
import { closeSync, constants, lstatSync, openSync, readSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { join, posix, resolve, win32 } from "node:path";

export const APP_PAYLOAD_ALGORITHM = "sha256-sorted-relative-app-manifest-v1";
export const APK_ALGORITHM = "sha256-raw-apk-v1";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function fileDigest(path) {
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count;
    while ((count = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest("hex");
  } finally { closeSync(descriptor); }
}

export function validateAppPayloadSymlinks(entries, filesystemPlatform = process.platform) {
  const indexed = new Map(entries.map(entry => [entry.path, entry]));
  for (const link of entries.filter(entry => entry.type === "symlink")) {
    // Resolve against the collected manifest, never by following a filesystem
    // link. This also detects an escape through an intermediate directory link.
    const parent = posix.dirname(link.path);
    const parts = parent === "." ? [] : parent.split("/");
    let remaining = [posix.basename(link.path)], expansions = 0;
    while (remaining.length) {
      const part = remaining.shift();
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) throw new Error("App symlink escapes its payload: " + link.path);
        parts.pop(); continue;
      }
      const current = indexed.get([...parts, part].join("/"));
      if (!current) throw new Error("App symlink has a missing internal target: " + link.path);
      if (current.type === "symlink") {
        const target = current.target;
        if (!target || posix.isAbsolute(target) || win32.isAbsolute(target)) {
          throw new Error("App symlink must use an internal relative target: " + current.path);
        }
        if (++expansions > 40) throw new Error("App symlink cycle or excessive link depth: " + link.path);
        // Windows readlink uses backslashes even for a link created from a
        // slash-separated target. Preserve the literal manifest entry, but
        // interpret separators according to the host that owns this payload.
        remaining = [...target.split(filesystemPlatform === "win32" ? /[\\/]/ : /\//), ...remaining];
      } else {
        if (remaining.some(part => part && part !== ".") && current.type !== "directory") {
          throw new Error("App symlink traverses a non-directory: " + link.path);
        }
        parts.push(part);
      }
    }
  }
}

/**
 * iOS: SHA-256 of the exact UTF-8 manifestText (two-space JSON plus LF).
 * The manifest contains sorted relative entries, file bytes/hashes and modes,
 * directories, and literal internal symlinks. No absolute path, mtime or inode
 * participates, so relocating an unchanged payload preserves its identity.
 * Android: SHA-256 of the raw APK bytes; its manifest records that same file.
 */
export function fingerprintNativeArtifact(platform, input) {
  if (!["ios", "android"].includes(platform)) throw new Error("Native artifact platform must be ios or android");
  const artifact = resolve(input), root = lstatSync(artifact), entries = [];
  if (root.isSymbolicLink()) throw new Error("Native artifact root must not be a symlink");
  if (platform === "android") {
    if (!root.isFile()) throw new Error("Android artifact must be a regular APK file");
    entries.push({ path: ".", type: "file", bytes: root.size, sha256: fileDigest(artifact) });
  } else {
    if (!root.isDirectory()) throw new Error("iOS artifact must be an app directory");
    const visit = (absolute, relative) => {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        entries.push({ path: relative, type: "symlink", target: readlinkSync(absolute) });
      } else if (stat.isDirectory()) {
        entries.push({ path: relative, type: "directory", mode: stat.mode & 0o777 });
        for (const name of readdirSync(absolute)) visit(join(absolute, name), relative === "." ? name : relative + "/" + name);
      } else if (stat.isFile()) {
        entries.push({ path: relative, type: "file", mode: stat.mode & 0o777, bytes: stat.size, sha256: fileDigest(absolute) });
      } else throw new Error("Unsupported special entry in native app: " + relative);
    };
    visit(artifact, ".");
    entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    validateAppPayloadSymlinks(entries);
  }
  const kind = platform === "ios" ? "ios-app" : "android-apk";
  const algorithm = platform === "ios" ? APP_PAYLOAD_ALGORITHM : APK_ALGORITHM;
  const manifestText = JSON.stringify({ schema: 1, kind, algorithm, entries }, null, 2) + "\n";
  const manifestSha256 = digest(manifestText);
  return { kind, algorithm, sha256: platform === "ios" ? manifestSha256 : entries[0].sha256, manifestSha256, manifestText };
}

/** Persist the full payload inventory before installation, including for failed runs. */
export function recordNativeArtifact(platform, artifact, output) {
  const { manifestText, manifestSha256, ...identity } = fingerprintNativeArtifact(platform, artifact);
  const file = "native-artifact.json";
  writeFileSync(join(output, file), manifestText);
  return { ...identity, manifest: { file, sha256: manifestSha256 } };
}
