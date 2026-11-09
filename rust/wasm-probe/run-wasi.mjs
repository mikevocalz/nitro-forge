// Runs the nf-wasm-probe WASI command module under Node's built-in WASI.
// Usage: node rust/wasm-probe/run-wasi.mjs
import { WASI } from "node:wasi";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, "../../target/wasm32-wasip1/debug/nf-wasm-probe.wasm");
const wasi = new WASI({ version: "preview1", args: [], env: {} });
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {
  wasi_snapshot_preview1: wasi.wasiImport,
});
wasi.start(instance);
