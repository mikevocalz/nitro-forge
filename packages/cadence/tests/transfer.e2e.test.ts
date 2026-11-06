import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliHost } from "@nitro-forge/ignition/cli";
import { runExport, runImport, importFormatFor, describeFormat } from "@nitro-forge/ignition/transfer";

let host: CliHost;
beforeAll(() => {
  host = new CliHost();
});
afterAll(async () => {
  await host.dispose();
});

import { CadenceDocument } from "../src/index";
import { CADENCE_EXPORT_FORMATS, CADENCE_IMPORT_FORMATS, songEndTicks } from "../src/transfer";

describe("cadence WAV export (real Rust via nf-cli)", () => {
  it("renders the whole song into a valid float WAV, continuously", async () => {
    const song = await CadenceDocument.open(host, 120);
    const t = (await song.addTrack("midi")).data.track_id;
    // 30 s at 120 bpm, ppq 960 = 60 beats = 57,600 ticks; crosses the former 10-second chunk boundary.
    const c = (await song.addClip(t, 0, 57_600)).data.clip_id;
    await song.addNote(c, 69, 0, 960);
    const out = await runExport(song.handle, CADENCE_EXPORT_FORMATS, { formatId: "wav", filename: "Mix" });
    expect(out.filename).toBe("Mix.wav");
    expect(out.mime).toBe("audio/wav");
    const v = new DataView(out.bytes.buffer, out.bytes.byteOffset);
    expect(String.fromCharCode(...out.bytes.slice(0, 4))).toBe("RIFF");
    expect(v.getUint16(20, true)).toBe(3);
    expect(v.getUint32(24, true)).toBe(48_000);
    const dataBytes = v.getUint32(40, true);
    expect(dataBytes).toBe(30 * 48_000 * 2 * 4);
    // first note is audible, tail is silent
    const samples = new Float32Array(out.bytes.slice(44).buffer);
    expect(Math.max(...samples.slice(0, 48_000).map(Math.abs))).toBeGreaterThan(0.01);
    expect(Math.max(...samples.slice(samples.length - 1000).map(Math.abs))).toBe(0);
    await song.close();
  });

  it("rejects pre-cancelled renders and exports an empty song as a header-only WAV", async () => {
    const song = await CadenceDocument.open(host, 120);
    const ac = new AbortController();
    ac.abort();
    const t = (await song.addTrack("midi")).data.track_id;
    await song.addClip(t, 0, 57_600);
    await expect(
      runExport(song.handle, CADENCE_EXPORT_FORMATS, { formatId: "wav", filename: "a" }, ac.signal),
    ).rejects.toMatchObject({ code: "aborted" });
    const empty = await CadenceDocument.open(host, 120);
    const out = await runExport(empty.handle, CADENCE_EXPORT_FORMATS, { formatId: "wav", filename: "e" });
    expect(out.bytes.length).toBe(44);
    expect(songEndTicks({ tempo_bpm: 120, ppq: 960, tracks: [] })).toBe(0);
    expect(CADENCE_EXPORT_FORMATS.map(describeFormat).map((f) => f.id)).toEqual(["nfd", "wav"]);
    await song.close();
    await empty.close();
  });

  it("round-trips the native .nfd document", async () => {
    const song = await CadenceDocument.open(host, 90);
    const out = await runExport(song.handle, CADENCE_EXPORT_FORMATS, { formatId: "nfd", filename: "s.nfd" });
    const other = await CadenceDocument.open(host, 120);
    const fmt = importFormatFor("s.NFD", CADENCE_IMPORT_FORMATS);
    expect(fmt?.id).toBe("nfd");
    await runImport(other.handle, CADENCE_IMPORT_FORMATS, "nfd", out.bytes);
    const d = await other.handle.apply<{ tempo_bpm: number }>("describe");
    expect(d.data.tempo_bpm).toBe(90);
    await song.close();
    await other.close();
  });
});

it('WAV keeps stateful insert output continuous across ten seconds',async()=>{
 const song=await CadenceDocument.open(host,120);try{
 const t=(await song.addTrack('midi')).data.track_id;const c=(await song.addClip(t,0,21120)).data.clip_id;await song.addNote(c,69,0,21120);await song.addInsert(t,'eq',{params:{bands:[{type:'low_pass',freq_hz:40,q:1}]}});
 const out=await runExport(song.handle,CADENCE_EXPORT_FORMATS,{formatId:'wav',filename:'continuous'});const expected=await song.render(0,21120,48000);
 expect(Buffer.from(out.bytes.subarray(44)).equals(Buffer.from(expected.samples.buffer))).toBe(true);
 }finally{await song.close();}
});
