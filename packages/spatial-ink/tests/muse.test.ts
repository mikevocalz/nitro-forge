import { describe, expect, it } from "vitest";
import {
  subscribeMuseSpatialInk,
  type MuseNativeSample,
  type SpatialPenEvent,
} from "../src/index";

const base = (): MuseNativeSample => ({
  tracked: true, position: [0, 1, 2], headPosition: [0, 1.5, 0],
  tipPressed: false, primaryPressed: false, secondaryPressed: false,
  pressure: 0.3,
});

function setup(sideButtonsDraw = false, clock?: () => number) {
  let subscriber: ((s: MuseNativeSample) => void) | undefined;
  let disconnected = 0;
  let tick = 0;
  const events: SpatialPenEvent[] = [];
  const dispose = subscribeMuseSpatialInk({
    subscribe: (callback) => {
      subscriber = callback;
      return () => { disconnected++; subscriber = undefined; };
    },
    onEvent: (event) => events.push(event),
    sideButtonsDraw,
    now: clock ?? (() => tick++),
  });
  return {
    send: (sample: MuseNativeSample) => subscriber?.(sample),
    events, dispose,
    disconnected: () => disconnected,
  };
}

describe("native Logitech Muse input adapter", () => {
  it("emits hover/down/move/up and passes valid pressure including zero", () => {
    const s = setup();
    s.send(base());
    s.send({ ...base(), tipPressed: true, pressure: 0 });
    s.send({ ...base(), tipPressed: true, pressure: Number.NaN });
    s.send(base());
    expect(s.events.map((e) => e.phase)).toEqual(["hover", "down", "move", "up"]);
    expect(s.events[1]?.normalizedPressure).toBe(0);
    expect(s.events[2]?.normalizedPressure).toBeUndefined();
    expect(s.events[1]?.position).toEqual([0, 1, 2]);
    expect(s.events.map((e) => e.timestampMs)).toEqual([0, 1, 2, 3]);
    s.dispose();
  });

  it("cancels only once on lost tracking and requires release before resuming", () => {
    const s = setup();
    s.send({ ...base(), tipPressed: true });
    s.send({ ...base(), tracked: false, position: null, tipPressed: true });
    s.send({ ...base(), tracked: false, position: null, tipPressed: true });
    s.send({ ...base(), tipPressed: true });
    s.send(base());
    s.send({ ...base(), tipPressed: true });
    expect(s.events.map((e) => e.phase))
      .toEqual(["down", "cancel", "hover", "hover", "down"]);
    s.dispose();
  });

  it("side button ray drawing is an opt-in, not a synthetic tip press", () => {
    const tipOnly = setup();
    tipOnly.send({ ...base(), primaryPressed: true });
    expect(tipOnly.events[0]?.phase).toBe("hover");
    expect(tipOnly.events[0]?.primaryPressed).toBe(true);
    tipOnly.dispose();

    const ray = setup(true);
    ray.send({ ...base(), primaryPressed: true });
    expect(ray.events[0]?.phase).toBe("down");
    ray.dispose();
  });

  it("rejects invalid spatial poses and cancels on cleanup exactly once", () => {
    const s = setup();
    s.send({ ...base(), position: [NaN, 0, 0] });
    expect(s.events).toHaveLength(0);
    s.send({ ...base(), tipPressed: true });
    s.dispose();
    s.dispose();
    s.send({ ...base(), tipPressed: true });
    expect(s.events.map((e) => e.phase)).toEqual(["down", "cancel"]);
    expect(s.disconnected()).toBe(1);
  });

  it("rejects malformed runtime poses from a native provider without crashing", () => {
    const s = setup();
    s.send({ ...base(), position: {} as MuseNativeSample["position"], tipPressed: true });
    s.send({ ...base(), position: [0, 2] as unknown as MuseNativeSample["position"], tipPressed: true });
    s.send({ ...base(), position: ["x", 1, 2] as unknown as MuseNativeSample["position"], tipPressed: true });
    expect(s.events).toHaveLength(0);
    s.send({ ...base(), tipPressed: true });
    // A malformed press blocks the stroke until a real release; never resume
    // a drawing mid-stroke after lost spatial tracking.
    s.send(base());
    s.send({ ...base(), tipPressed: true });
    expect(s.events.map(e => e.phase)).toEqual(["hover", "hover", "down"]);
    s.dispose();
  });

  it("never moves timestamps backwards when the host clock jitters", () => {
    let idx = 0;
    const t = [20, 19, 22];
    const s = setup(false, () => t[idx++] ?? 25);
    s.send(base());
    s.send({ ...base(), tipPressed: true });
    s.send(base());
    expect(s.events.map((e) => e.timestampMs)).toEqual([20, 20, 22]);
    s.dispose();
  });
});
