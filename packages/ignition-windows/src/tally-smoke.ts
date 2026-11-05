import { DocumentHandle } from "@nitro-forge/ignition";
import { createWindowsHost } from "./create-windows-host";

function require(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Windows Tally acceptance: ${message}`);
}

async function expectValue(document: DocumentHandle, expected: number): Promise<void> {
  const result = await document.apply<{ value: number }>("evaluate", { formula: "=B1" });
  require(result.data.value === expected, `expected ${expected}, received ${result.data.value}`);
}

/**
 * Run the write phase through the registered Windows native module.
 * Supply the application's byte persistence function, then terminate/relaunch
 * the app and call {@link readWindowsTallyFixture} with its matching reader.
 * A successful return is evidence only for the environment that executed it.
 */
export async function writeWindowsTallyFixture(
  save: (bytes: Uint8Array) => Promise<void>,
): Promise<{ bytes: number; value: number }> {
  const host = createWindowsHost();
  try {
    const document = await DocumentHandle.open(host, "tally");
    await document.apply("setCell", { addr: "A1", value: "10" });
    await document.apply("setCell", { addr: "A2", value: "20" });
    await document.apply("setCell", { addr: "B1", value: "=SUM(A1:A2)" });
    await expectValue(document, 30);
    await document.apply("setCell", { addr: "A1", value: "22" });
    await expectValue(document, 42);
    require(await document.undo(), "undo did not change the document");
    await expectValue(document, 30);
    require(await document.redo(), "redo did not change the document");
    await expectValue(document, 42);
    const bytes = await document.snapshot();
    require(bytes.length >= 9 && bytes[0] === 78 && bytes[1] === 70 && bytes[2] === 68 && bytes[3] === 49,
      "snapshot is not an NFD1 envelope");
    await save(bytes);
    await document.close();
    return { bytes: bytes.length, value: 42 };
  } finally {
    await host.dispose();
  }
}

/**
 * Reopen the bytes saved by {@link writeWindowsTallyFixture}, recompute the
 * formula, edit it again, and undo through a fresh native Rust session.
 * Run after a real app relaunch to establish persistence across process life.
 */
export async function readWindowsTallyFixture(
  load: () => Promise<Uint8Array>,
): Promise<{ bytes: number; value: number }> {
  const bytes = await load();
  const host = createWindowsHost();
  try {
    const document = await DocumentHandle.open(host, "tally");
    await document.restore(bytes);
    await expectValue(document, 42);
    require(!(await document.undo()), "restore retained an old undo journal");
    const restored = await document.snapshot();
    require(restored.length === bytes.length && restored.every((byte, index) => byte === bytes[index]),
      "restored document differs from the saved bytes");
    await document.apply("setCell", { addr: "A2", value: "21" });
    await expectValue(document, 43);
    require(await document.undo(), "reopened document cannot undo a new edit");
    await expectValue(document, 42);
    const corrupt = bytes.slice();
    corrupt[0] = 0;
    let rejected = false;
    try { await document.restore(corrupt); } catch { rejected = true; }
    require(rejected, "corrupt NFD1 was accepted");
    await expectValue(document, 42);
    await document.close();
    return { bytes: bytes.length, value: 42 };
  } finally {
    await host.dispose();
  }
}
