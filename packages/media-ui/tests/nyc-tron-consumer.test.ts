// Consumer contract: media-ui re-exports NYC-Tron's implementation (no copy),
// and that implementation still produces the transport labels Forge's seek
// bar and timeline depend on. NYC-Tron's own unit tests live in its repo.
import { describe, expect, it } from "vitest";
import * as tron from "@nyc-tron/ui/components/forge/timebase";
import * as tronWaveform from "@nyc-tron/ui/components/forge/waveform";
import * as local from "../src/timebase";

describe("media-ui consumes NYC-Tron timebase", () => {
  it("re-exports the NYC-Tron functions themselves", () => {
    expect(local.FRAME_RATES).toBe(tron.FRAME_RATES);
    expect(local.formatTimecode).toBe(tron.formatTimecode);
    expect(local.clampFrame).toBe(tron.clampFrame);
    expect(local.frameToPosition).toBe(tron.frameToPosition);
    expect(local.positionToFrame).toBe(tron.positionToFrame);
    expect(local.assertFrameRate).toBe(tron.assertFrameRate);
  });
  it("keeps the SMPTE drop-frame labels Forge displays", () => {
    const { FRAME_RATES, formatTimecode } = local;
    expect(formatTimecode(1799, FRAME_RATES.VIDEO_30)).toBe("00:00:59:29");
    expect(formatTimecode(1800, FRAME_RATES.NTSC_2997, { dropFrame: true })).toBe("00:01:00;02");
    expect(formatTimecode(17982, FRAME_RATES.NTSC_2997, { dropFrame: true })).toBe("00:10:00;00");
    expect(formatTimecode(35964, FRAME_RATES.NTSC_5994, { dropFrame: true })).toBe("00:10:00;00");
    expect(() => formatTimecode(0, FRAME_RATES.FILM_24, { dropFrame: true })).toThrow();
  });
  it("maps long media onto a normalized slider without giant step counts", () => {
    expect(local.positionToFrame(0.5, 1_000_000)).toBe(500_000);
    expect(local.frameToPosition(0, 0)).toBe(0);
    expect(() => local.positionToFrame(2, 1)).toThrow();
  });
  it("keeps waveform extrema for recorded peaks", () => {
    const peaks = [{ min: -1, max: 1 }, { min: -0.25, max: 0.4 }];
    expect(tronWaveform.resamplePeaks(peaks, 1)).toEqual([{ min: -1, max: 1 }]);
    expect(tronWaveform.peaksToBars(tronWaveform.resamplePeaks(peaks, 2), 64)[0]).toEqual({ top: 0, height: 64 });
  });
});
