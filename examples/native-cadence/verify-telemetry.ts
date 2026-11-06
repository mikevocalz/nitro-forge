import { createNitroHost, DocumentHandle, EngineError } from "@nitro-forge/ignition";
import { createTelemetry, instrumentHost, type TelemetryEvent } from "@nitro-forge/telemetry";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Native telemetry: ${message}`);
}
/** Explicit native lab check; captures diagnostic batches in memory only. */
export async function verifyNativeTelemetry(): Promise<string> {
  const sent: TelemetryEvent[] = [];
  const telemetry = createTelemetry({ consent: "off", maxEvents: 100,
    sink: batch => { sent.push(...batch); } });
  const host = instrumentHost(createNitroHost(), telemetry);
  try {
    const document = await DocumentHandle.openInitialized(host, "cadence", d => d.apply("new"));
    check(telemetry.exportTrace().events.length === 0, "off recorded events");
    telemetry.setConsent("local");
    await document.apply("addTrack", { name: "private-native-track" });
    await document.snapshot();
    try {
      await document.apply("notAnEngineOperation");
      throw new Error("Expected native rejection");
    } catch (error) {
      check(error instanceof EngineError && error.code === "invalid_command", "native error code changed");
    }
    const local = telemetry.exportTrace().events;
    check(local.some(e => e.type === "failure" && e.code === "invalid_command"), "native failure missing");
    check(local.some(e => e.type === "span" && e.name === "engine.snapshot"), "native timing missing");
    await telemetry.flush(); check(sent.length === 0, "local consent uploaded");
    check(!JSON.stringify(local).includes("private-native-track"), "payload leaked");
    telemetry.setConsent("diagnostics");
    await document.apply("describe");
    try { await document.apply("notAnEngineOperation"); }
    catch (error) { check(error instanceof EngineError, "diagnostic failure changed"); }
    await telemetry.flush();
    check(sent.length > 0, "diagnostic capture missing");
    check(sent.some(e => e.type === "failure" && e.code === "invalid_command"), "diagnostic failure code missing");
    check(sent.every(e => !(e.type === "failure" && e.message)), "failure message uploaded");
    const outstanding = telemetry.span("native.outstanding");
    telemetry.setConsent("off"); telemetry.setConsent("local"); outstanding.end();
    check(telemetry.exportTrace().events.length === 0, "revoked span resurrected");
    await document.close(); telemetry.setConsent("off");
    check(telemetry.exportTrace().events.length === 0, "off failed to clear");
    return "Native telemetry passed: real engine timings/errors, consent off/local/diagnostics, payload isolation and revoked-span cleanup. Diagnostic sink was memory only.";
  } finally { telemetry.setConsent("off"); await host.dispose(); }
}
