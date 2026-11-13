import { describe, expect, it } from "vitest";

import { CharadeError } from "../src/index.js";
import { BAKE_STEP_MICROS, bakeMotion } from "../src/timeline/baked.js";
import {
  assertFps,
  DEFAULT_FPS,
  firstFrameAtOrAfter,
  frameCount,
  frameInSegment,
  frameSeconds,
  segmentFrames,
  TimelineRangeError,
  toMicros,
  toSeconds,
} from "../src/timeline/time.js";
import {
  computeDuration,
  type Segment,
  type Timeline,
} from "../src/timeline/timeline.js";

/** The error `run` throws, when it is a {@link TimelineRangeError}. */
function rangeErrorOf(run: () => unknown): TimelineRangeError | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof TimelineRangeError ? error : undefined;
  }
  return undefined;
}

function segment(start: number, end: number | null): Segment {
  return { start, end, data: null };
}

function timeline(
  segments: readonly Segment[][],
  duration: number | null = null,
  fps = 30,
): Timeline {
  return {
    fps,
    seed: 0,
    duration,
    rows: segments.map((row) => ({
      tracks: row.map((item, occurrence) => ({
        kind: "actor",
        name: "hero",
        occurrence,
        segments: [item],
      })),
    })),
  };
}

describe("toMicros", () => {
  it.each([
    ["zero", 0, 0],
    ["one second", 1, 1_000_000],
    ["0.1 s", 0.1, 100_000],
    ["0.2 s", 0.2, 200_000],
    ["4.1 s", 4.1, 4_100_000],
    ["0.1 + 0.2 as a float sum", 0.1 + 0.2, 300_000],
    ["one microsecond", 0.000001, 1],
    ["half a microsecond rounds up", 0.0000005, 1],
    ["just under half a microsecond rounds down", 0.0000004, 0],
    ["1.0000015 s rounds to the nearest", 1.0000015, 1_000_002],
    ["negative zero", -0, 0],
  ])("quantises %s", (_label, seconds, micros) => {
    expect(toMicros(seconds)).toBe(micros);
  });

  it("stores negative zero as positive zero", () => {
    expect(Object.is(toMicros(-0), 0)).toBe(true);
  });

  it("ends 0.1 s then 0.2 s at 300 000 µs when each is quantised and then added", () => {
    expect(toMicros(0.1) + toMicros(0.2)).toBe(300_000);
  });

  it.each([
    ["a negative time", -0.5],
    ["NaN", Number.NaN],
    ["an infinity", Number.POSITIVE_INFINITY],
    ["a time past the safe integer range", Number.MAX_SAFE_INTEGER],
  ])("rejects %s", (_label, seconds) => {
    expect(rangeErrorOf(() => toMicros(seconds))).toMatchObject({
      code: "ERR_SCENE_OUT_OF_RANGE",
      path: "seconds",
    });
  });

  it("names the argument it was given in the error", () => {
    expect(rangeErrorOf(() => toMicros(-1, "options.at"))).toMatchObject({
      code: "ERR_SCENE_OUT_OF_RANGE",
      path: "options.at",
    });
  });

  it("converts microseconds back to seconds", () => {
    expect(toSeconds(4_100_000)).toBe(4.1);
  });
});

describe("frames", () => {
  it("defaults to 30 fps", () => {
    expect(DEFAULT_FPS).toBe(30);
  });

  it.each([
    ["frame 0", 0, 0],
    ["frame 9", 9, 0.3],
    ["frame 123", 123, 4.1],
  ])("draws %s at n / fps", (_label, frame, seconds) => {
    expect(frameSeconds(frame, 30)).toBe(seconds);
  });

  it.each([
    ["a negative frame", -1],
    ["a fractional frame", 1.5],
  ])("rejects %s", (_label, frame) => {
    expect(rangeErrorOf(() => frameSeconds(frame, 30))).toMatchObject({
      code: "ERR_SCENE_OUT_OF_RANGE",
      path: "frame",
    });
  });

  it.each([
    ["zero", 0],
    ["a negative rate", -30],
    ["a fractional rate", 29.97],
    ["NaN", Number.NaN],
  ])("rejects an fps of %s", (_label, fps) => {
    expect(
      rangeErrorOf(() => {
        assertFps(fps);
      }),
    ).toMatchObject({ code: "ERR_SCENE_OUT_OF_RANGE", path: "fps" });
  });

  it.each([
    ["0 µs", 0, 0],
    ["100 000 µs", 100_000, 3],
    ["one microsecond past a frame", 100_001, 4],
    ["300 000 µs", 300_000, 9],
    ["33 333 µs, just before frame 1", 33_333, 1],
    ["33 334 µs, just after frame 1", 33_334, 2],
  ])("finds the first frame at or after %s at 30 fps", (_label, micros, frame) => {
    expect(firstFrameAtOrAfter(micros, 30)).toBe(frame);
  });

  it.each([
    ["a negative time", -1],
    ["a fractional time", 1.5],
    ["a time whose product with fps leaves the safe range", Number.MAX_SAFE_INTEGER],
  ])("rejects %s", (_label, micros) => {
    expect(rangeErrorOf(() => firstFrameAtOrAfter(micros, 30))).toMatchObject({
      code: "ERR_SCENE_OUT_OF_RANGE",
      path: "micros",
    });
  });
});

describe("segments", () => {
  it("covers frames 3 to 8 for 0.1 s lasting 0.2 s at 30 fps", () => {
    const start = toMicros(0.1);
    expect(segmentFrames(start, start + toMicros(0.2), 30)).toEqual({
      first: 3,
      last: 8,
    });
  });

  it.each([
    ["frame 2, before the start", 2, false],
    ["frame 3, at the start", 3, true],
    ["frame 8, the last inside", 8, true],
    ["frame 9, at the end", 9, false],
  ])("treats %s of [100 000, 300 000) as %s", (_label, frame, inside) => {
    expect(frameInSegment(frame, 100_000, 300_000, 30)).toBe(inside);
  });

  it("covers no frame when a segment falls between two frames", () => {
    expect(segmentFrames(10_000, 20_000, 30)).toBeUndefined();
  });

  it("covers no frame when a segment is empty", () => {
    expect(segmentFrames(100_000, 100_000, 30)).toBeUndefined();
  });

  it("runs an open-ended segment from its first frame without a last one", () => {
    expect(segmentFrames(100_000, null, 30)).toEqual({ first: 3, last: null });
  });

  it("puts every later frame inside an open-ended segment", () => {
    expect(frameInSegment(1_000_000, 100_000, null, 30)).toBe(true);
    expect(frameInSegment(2, 100_000, null, 30)).toBe(false);
  });

  it("rejects a frame too large to compare exactly", () => {
    expect(
      rangeErrorOf(() => frameInSegment(Number.MAX_SAFE_INTEGER, 0, null, 30)),
    ).toMatchObject({ code: "ERR_SCENE_OUT_OF_RANGE", path: "frame" });
  });
});

describe("frameCount", () => {
  it.each([
    ["0 s", 0, 1],
    ["0.3 s", 300_000, 10],
    ["1 s", 1_000_000, 31],
    ["4.1 s, where Math.floor(4.1 * 30) would give 122", 4_100_000, 124],
    ["0.25 s, rounded up to frame 8", 250_000, 9],
  ])("has d × fps + 1 frames for %s at 30 fps", (_label, micros, frames) => {
    expect(frameCount(micros, 30)).toBe(frames);
  });

  it("counts 4.1 s quantised from seconds as 124 frames", () => {
    expect(frameCount(toMicros(4.1), 30)).toBe(124);
  });
});

describe("computeDuration", () => {
  it("ends at the last bounded segment in any row", () => {
    const result = computeDuration(
      timeline([
        [segment(0, 1_000_000)],
        [segment(500_000, 4_100_000), segment(0, 2_000_000)],
      ]),
    );
    expect(result).toEqual({
      ok: true,
      micros: 4_100_000,
      lastFrame: 123,
      frameCount: 124,
    });
  });

  it("rounds a duration that falls between frames up to a frame", () => {
    expect(computeDuration(timeline([[segment(0, 250_000)]]))).toEqual({
      ok: true,
      micros: 250_000,
      lastFrame: 8,
      frameCount: 9,
    });
  });

  it("is not extended by an open-ended track", () => {
    const result = computeDuration(
      timeline([[segment(0, 300_000), segment(5_000_000, null)]]),
    );
    expect(result).toEqual({ ok: true, micros: 300_000, lastFrame: 9, frameCount: 10 });
  });

  it("uses an explicit duration over the segments", () => {
    const result = computeDuration(timeline([[segment(0, 4_100_000)]], 1_000_000));
    expect(result).toEqual({
      ok: true,
      micros: 1_000_000,
      lastFrame: 30,
      frameCount: 31,
    });
  });

  it("uses an explicit duration when only open-ended tracks exist", () => {
    const result = computeDuration(timeline([[segment(0, null)]], 2_000_000, 24));
    expect(result).toEqual({
      ok: true,
      micros: 2_000_000,
      lastFrame: 48,
      frameCount: 49,
    });
  });

  it("accepts an explicit duration of zero as a single frame", () => {
    expect(computeDuration(timeline([[segment(0, null)]], 0))).toEqual({
      ok: true,
      micros: 0,
      lastFrame: 0,
      frameCount: 1,
    });
  });

  it("reports an error when only open-ended tracks exist and no duration is given", () => {
    expect(
      computeDuration(timeline([[segment(0, null)], [segment(100_000, null)]])),
    ).toEqual({
      ok: false,
      reason: "no-bounded-segment",
    });
  });

  it("reports the same error for a timeline with no tracks", () => {
    expect(computeDuration(timeline([]))).toEqual({
      ok: false,
      reason: "no-bounded-segment",
    });
  });
});

describe("bakeMotion", () => {
  it("samples at a 4 ms step", () => {
    expect(BAKE_STEP_MICROS).toBe(4_000);
  });

  it("stores a sample at the start and every step until one reaches the end", () => {
    const times: number[] = [];
    const baked = bakeMotion(100_000, 110_000, (time) => {
      times.push(time);
      return { kneeR: times.length, pelvisY: 0 };
    });
    expect(times).toEqual([100_000, 104_000, 108_000, 112_000]);
    expect(baked).toEqual({
      kind: "baked",
      start: 100_000,
      step: 4_000,
      channels: { kneeR: [1, 2, 3, 4], pelvisY: [0, 0, 0, 0] },
    });
  });

  it("ends on the last step when the length is a whole number of steps", () => {
    const baked = bakeMotion(0, 8_000, () => ({ x: 1 }));
    expect(baked.channels).toEqual({ x: [1, 1, 1] });
  });

  it("stores one sample for a motion of zero length", () => {
    expect(bakeMotion(0, 0, () => ({ x: 0.5 })).channels).toEqual({ x: [0.5] });
  });

  it("lets the sampler carry state from one step to the next", () => {
    let velocity = 0;
    let position = 0;
    const baked = bakeMotion(0, 12_000, () => {
      const sample = { x: position };
      velocity += 1;
      position += velocity;
      return sample;
    });
    expect(baked.channels).toEqual({ x: [0, 1, 3, 6] });
  });

  it("stores negative zero as positive zero", () => {
    const series = bakeMotion(0, 0, () => ({ x: -0 })).channels["x"];
    expect(Object.is(series?.[0], 0)).toBe(true);
  });

  it.each([
    ["a negative start", -1, 0, "start"],
    ["an end before the start", 8_000, 4_000, "end"],
    ["a fractional end", 0, 1.5, "end"],
  ])("rejects %s", (_label, start, end, path) => {
    expect(rangeErrorOf(() => bakeMotion(start, end, () => ({})))).toMatchObject({
      code: "ERR_SCENE_OUT_OF_RANGE",
      path: path,
    });
  });

  it.each([
    ["a non-finite sample", () => ({ x: Number.NaN })],
    [
      "a channel that disappears",
      (time: number) => (time === 0 ? { x: 0, y: 0 } : { x: 0 }),
    ],
    ["a channel that is renamed", (time: number) => (time === 0 ? { x: 0 } : { y: 0 })],
  ])("rejects %s", (_label, sample) => {
    expect(rangeErrorOf(() => bakeMotion(0, 4_000, sample))).toMatchObject({
      code: "ERR_SCENE_OUT_OF_RANGE",
      path: "sample",
    });
  });
});

describe("TimelineRangeError", () => {
  it("is a CharadeError with its own code", () => {
    const error = rangeErrorOf(() => toMicros(-1));
    expect(error).toBeInstanceOf(CharadeError);
    expect(error?.code).toBe("ERR_SCENE_OUT_OF_RANGE");
  });
});
