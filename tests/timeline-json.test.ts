import { describe, expect, it } from "vitest";

import { bakeMotion } from "../src/timeline/baked.js";
import {
  FUNCTION_PLACEHOLDER,
  parseTimeline,
  serializeDocument,
  serializeTimeline,
  TIMELINE_JSON_VERSION,
} from "../src/timeline/json.js";
import { TimelineRangeError } from "../src/timeline/time.js";
import type { Timeline, TimelineValue } from "../src/timeline/timeline.js";

function withData(data: TimelineValue, end: number | null = 300_000): Timeline {
  return {
    fps: 30,
    seed: 0,
    duration: null,
    rows: [
      {
        tracks: [
          {
            kind: "actor",
            name: "hero",
            occurrence: 0,
            segments: [{ start: 100_000, end, data }],
          },
        ],
      },
    ],
  };
}

const empty: Timeline = { fps: 30, seed: 0, duration: null, rows: [] };

describe("serializeTimeline", () => {
  it("writes version 1, an unmarked document and compact canonical JSON", () => {
    expect(TIMELINE_JSON_VERSION).toBe(1);
    expect(serializeTimeline(withData({ name: "wave", amount: 0.5 }))).toBe(
      '{"version":1,"lossy":false,"timeline":{"duration":null,"fps":30,"rows":[{"tracks":' +
        '[{"kind":"actor","name":"hero","occurrence":0,"segments":[{"data":{"amount":0.5,' +
        '"name":"wave"},"end":300000,"start":100000}]}]}],"seed":0}}',
    );
  });

  it("writes the same text whatever order the keys were inserted in", () => {
    const one = withData({ b: 1, a: { d: 2, c: 3 } });
    const other = withData({ a: { c: 3, d: 2 }, b: 1 });
    expect(serializeTimeline(one)).toBe(serializeTimeline(other));
  });

  it("sorts integer-like keys by code unit, not numerically", () => {
    expect(serializeTimeline(withData({ "9": 0, a: 0, "10": 0 }))).toContain(
      '"data":{"10":0,"9":0,"a":0}',
    );
  });

  it("writes a function as the placeholder and marks the document lossy", () => {
    const text = serializeTimeline(withData({ drive: (t: number) => t * 2 }));
    expect(text).toContain('"data":{"drive":{"$omitted":"function"}}');
    expect(text.startsWith('{"version":1,"lossy":true,')).toBe(true);
  });

  it("writes a function nested in an array as the placeholder", () => {
    const text = serializeTimeline(withData([1, () => 0]));
    expect(text).toContain('"data":[1,{"$omitted":"function"}]');
  });

  it("writes negative zero as zero", () => {
    expect(serializeTimeline(withData(-0))).toContain('"data":0,');
  });

  it("keeps unicode and emoji text", () => {
    const text = serializeTimeline(withData({ say: "こんにちは 😀" }));
    expect(parseTimeline(text)).toEqual({
      ok: true,
      document: {
        version: 1,
        lossy: false,
        timeline: withData({ say: "こんにちは 😀" }),
      },
    });
  });

  it.each([
    ["NaN", Number.NaN, "timeline.rows[0].tracks[0].segments[0].data.x"],
    [
      "an infinity",
      Number.NEGATIVE_INFINITY,
      "timeline.rows[0].tracks[0].segments[0].data.x",
    ],
    ["undefined", undefined, "timeline.rows[0].tracks[0].segments[0].data.x"],
    [
      "an array hole",
      new Array<number>(1),
      "timeline.rows[0].tracks[0].segments[0].data.x[0]",
    ],
    ["a Map", new Map([["a", 1]]), "timeline.rows[0].tracks[0].segments[0].data.x"],
    ["a Date", new Date(0), "timeline.rows[0].tracks[0].segments[0].data.x"],
    [
      "a typed array",
      new Float64Array([1]),
      "timeline.rows[0].tracks[0].segments[0].data.x",
    ],
  ])("rejects %s, which JSON would change", (_label, value, path) => {
    const data = { x: value } as unknown as TimelineValue;
    try {
      serializeTimeline(withData(data));
    } catch (error) {
      expect(error).toBeInstanceOf(TimelineRangeError);
      expect((error as TimelineRangeError).code).toBe("ERR_SCENE_OUT_OF_RANGE");
      expect((error as TimelineRangeError).path).toBe(path);
      return;
    }
    expect.unreachable("expected a TimelineRangeError");
  });
});

describe("round trip", () => {
  it.each([
    ["an empty timeline", empty],
    ["an explicit duration", { ...empty, duration: 4_100_000 }],
    ["an open-ended segment", withData(null, null)],
    [
      "nested data",
      withData({ list: [true, false, "x", 1.25, null], nested: { deep: [[]] } }),
    ],
    [
      "baked motion",
      withData(bakeMotion(0, 8_000, () => ({ kneeR: 0.25, pelvisY: -0.5 }))),
    ],
    ["data shaped like the placeholder", withData({ $omitted: "function" })],
  ])("reads back %s losslessly with version 1", (_label, timeline) => {
    const result = parseTimeline(serializeTimeline(timeline));
    expect(result).toEqual({
      ok: true,
      document: { version: 1, lossy: false, timeline },
    });
  });

  it("reads back a lossy document with the placeholder in place of the function", () => {
    const result = parseTimeline(
      serializeTimeline(withData({ drive: () => 0, amount: 1 })),
    );
    expect(result).toEqual({
      ok: true,
      document: {
        version: 1,
        lossy: true,
        timeline: withData({ drive: FUNCTION_PLACEHOLDER, amount: 1 }),
      },
    });
  });

  it("writes a read lossy document back to the same text", () => {
    const text = serializeTimeline(withData({ drive: () => 0 }));
    const result = parseTimeline(text);
    expect(result.ok && serializeDocument(result.document)).toBe(text);
  });
});

describe("parseTimeline", () => {
  const valid = serializeTimeline(empty);

  it("reports text that is not JSON", () => {
    expect(parseTimeline("{")).toEqual({ ok: false, reason: "invalid-json" });
  });

  it.each([
    ["version 2", valid.replace('"version":1', '"version":2')],
    ["a string version", valid.replace('"version":1', '"version":"1"')],
    ["version 2 with another envelope", '{"version":2,"meta":{},"timeline":{}}'],
    ["a missing version", '{"lossy":false,"timeline":{}}'],
  ])("reports %s as unsupported", (_label, text) => {
    expect(parseTimeline(text)).toEqual({ ok: false, reason: "unsupported-version" });
  });

  it.each([
    ["an array", "[]"],
    ["null", "null"],
    ["an extra envelope key", valid.replace('"lossy":false', '"lossy":false,"x":1')],
    ["a string lossy marker", valid.replace('"lossy":false', '"lossy":"no"')],
    ["a zero fps", valid.replace('"fps":30', '"fps":0')],
    ["a fractional fps", valid.replace('"fps":30', '"fps":29.97')],
    ["a fractional seed", valid.replace('"seed":0', '"seed":0.5')],
    ["a negative duration", valid.replace('"duration":null', '"duration":-1')],
    ["rows that are not an array", valid.replace('"rows":[]', '"rows":{}')],
    ["a row without tracks", valid.replace('"rows":[]', '"rows":[{}]')],
    [
      "a track with a numeric name",
      valid.replace(
        '"rows":[]',
        '"rows":[{"tracks":[{"kind":"actor","name":1,"occurrence":0,"segments":[]}]}]',
      ),
    ],
    [
      "a fractional segment start",
      valid.replace(
        '"rows":[]',
        '"rows":[{"tracks":[{"kind":"actor","name":"hero","occurrence":0,' +
          '"segments":[{"data":null,"end":null,"start":0.5}]}]}]',
      ),
    ],
    [
      "a segment that ends before it starts",
      valid.replace(
        '"rows":[]',
        '"rows":[{"tracks":[{"kind":"actor","name":"hero","occurrence":0,' +
          '"segments":[{"data":null,"end":1,"start":2}]}]}]',
      ),
    ],
    [
      "segment data with a number JSON reads as an infinity",
      valid.replace(
        '"rows":[]',
        '"rows":[{"tracks":[{"kind":"actor","name":"hero","occurrence":0,' +
          '"segments":[{"data":{"x":[1e400]},"end":null,"start":0}]}]}]',
      ),
    ],
    [
      "a segment without data",
      valid.replace(
        '"rows":[]',
        '"rows":[{"tracks":[{"kind":"actor","name":"hero","occurrence":0,' +
          '"segments":[{"end":null,"start":0}]}]}]',
      ),
    ],
  ])("rejects %s as an invalid shape", (_label, text) => {
    expect(parseTimeline(text)).toEqual({ ok: false, reason: "invalid-shape" });
  });
});
