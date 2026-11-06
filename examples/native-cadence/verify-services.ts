import { createNativeForgeFactory, normalizeNativeEngineError } from "@nitro-forge/ignition";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function rejects(run: () => unknown | Promise<unknown>, message: string) {
  let rejected = false;
  try { await run(); } catch { rejected = true; }
  check(rejected, message);
}

/** Real JSI acceptance for N-13/N-14/N-16; never run through a CLI substitute. */
export async function verifyNativeServices(): Promise<string> {
  const factory = createNativeForgeFactory();
  await rejects(() => factory.createMediaCache(0), "Cache accepted zero capacity");
  const cache = factory.createMediaCache(8);
  try {
    const input = new Uint8Array([1, 2, 3, 4]);
    const put = cache.put("source:r1:waveform:4", input.buffer);
    input.fill(99);
    await put;
    const copy = await cache.get("source:r1:waveform:4");
    check(copy && new Uint8Array(copy)[0] === 1, "Cache retained mutable caller bytes");
    new Uint8Array(copy).fill(88);
    check(new Uint8Array((await cache.get("source:r1:waveform:4"))!)[0] === 1,
      "Cache returned mutable shared storage");
    await cache.put("source:r2:waveform:4", new Uint8Array([5, 6, 7, 8]).buffer);
    await cache.get("source:r1:waveform:4"); // Touch r1; r2 must be evicted first.
    await cache.put("source:r3:waveform:4", new Uint8Array([9, 10, 11, 12]).buffer);
    check(await cache.get("source:r2:waveform:4") === undefined, "Cache did not evict least-recently-used bytes");
    check(cache.byteSize === 8, "Cache accounting exceeded capacity");
    await rejects(() => cache.put("oversize", new ArrayBuffer(9)), "Cache accepted oversized bytes");
    check(await cache.remove("source:r1:waveform:4"), "Cache did not remove an entry");
    await cache.clear();
    check(Number(cache.byteSize) === 0, "Cache clear retained bytes");
  } finally { await cache.close(); }
  await rejects(() => cache.get("closed"), "Closed cache accepted reads");

  const prism = await factory.open("prism");
  try {
    await prism.apply({ op: "new", payloadJson: '{"width":2,"height":2}' });
    const layer = JSON.parse((await prism.apply({ op: "addRasterLayer" })).dataJson).layer_id;
    const pixels = new Uint8Array(Array.from({ length: 4 }, () => [5, 10, 15, 255]).flat());
    const command = { op: "drawPixels", payloadJson: JSON.stringify({ id: layer, x: 0, y: 0, w: 2, h: 2 }) };
    const drawing = prism.applyBinary(command, pixels.buffer);
    pixels.fill(0);
    await drawing;
    const rendered = await prism.applyBinary({ op: "flatten" });
    check(rendered.output?.byteLength === 16, "Binary flatten returned wrong byte length");
    check(new Uint8Array(rendered.output)[0] === 5 && new Uint8Array(rendered.output)[3] === 255,
      "Binary input changed after dispatch");
    const snapshot = await prism.snapshot();
    await rejects(() => prism.applyBinary({ op: "describe" }, new ArrayBuffer(1)),
      "Unrelated operation accepted a binary sidecar");
    check(new Uint8Array(await prism.snapshot()).every((byte, i) => byte === new Uint8Array(snapshot)[i]),
      "Rejected binary operation changed the document");
    const task = prism.startTask({ op: "__snapshot" });
    const initialProgress = task.progress;
    const result = await task.result();
    check(initialProgress >= 0 && initialProgress <= task.progress && task.progress === 1,
      "Task progress was not monotonic or complete");
    check(result.output && String.fromCharCode(...new Uint8Array(result.output).subarray(0, 4)) === "NFD1",
      "Task did not return raw snapshot bytes");
    check((await task.result()).dataJson === result.dataJson, "Task result changed after settling");
  } finally { await prism.close(); }

  const cadence = await factory.open("cadence");
  try {
    await cadence.apply({ op: "new" });
    const before = (await cadence.apply({ op: "describe" })).dataJson;
    const task = cadence.startTask({ op: "render", payloadJson: JSON.stringify({
      from_ticks: 0, to_ticks: 115200, sample_rate: 48000, include_metronome: true,
    }) });
    task.cancel();
    let cancelled = false;
    try { await task.result(); }
    catch (error) { const native = normalizeNativeEngineError(error); cancelled = native.code === "cancelled" && native.recoverable; }
    check(cancelled, "Long native render did not report cancellation");
    check((await cadence.apply({ op: "describe" })).dataJson === before,
      "Cancelled read-only render changed document state");
  } finally { await cadence.close(); }
  return "Native services passed: bounded LRU, owned binary buffers, task progress/results, cancellation and cleanup.";
}
