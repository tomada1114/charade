import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEED,
  fnv1a32,
  mulberry32At,
  type RandomKey,
  randomSource,
} from "../src/timeline/random.js";
import { TimelineRangeError } from "../src/timeline/time.js";

const hero: RandomKey = { seed: 0, row: 0, kind: "actor", name: "hero", occurrence: 0 };

/** The error `run` throws, when it is a {@link TimelineRangeError}. */
function rangeErrorOf(run: () => unknown): TimelineRangeError | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof TimelineRangeError ? error : undefined;
  }
  return undefined;
}

describe("fnv1a32", () => {
  // The published FNV-1a 32-bit test vectors.
  it.each([
    ["the empty string", "", 0x811c9dc5],
    ['"a"', "a", 0xe40c292c],
    ['"foobar"', "foobar", 0xbf9cf968],
  ])("hashes %s to the published value", (_label, text, hash) => {
    expect(fnv1a32(text)).toBe(hash);
  });

  it("hashes a two-byte UTF-8 character as the Python reference does", () => {
    expect(fnv1a32("café")).toBe(0xa82b5049);
  });

  it("hashes two different lone surrogates differently", () => {
    expect(fnv1a32("\ud800")).not.toBe(fnv1a32("\ud801"));
  });
});

describe("mulberry32At", () => {
  // The first three outputs of the canonical sequential mulberry32 closure seeded
  // with 0, run separately in Node.
  it.each([
    [0, 1_144_304_738],
    [1, 1_416_247],
    [2, 958_946_056],
  ])("returns output %i of the reference generator seeded with 0", (draw, value) => {
    expect(mulberry32At(0, draw)).toBe(value);
  });

  it.each([
    ["a negative draw", -1],
    ["a fractional draw", 0.5],
    ["NaN", Number.NaN],
  ])("rejects %s", (_label, draw) => {
    expect(rangeErrorOf(() => mulberry32At(0, draw))).toMatchObject({
      code: "ERR_SCENE_OUT_OF_RANGE",
      path: "draw",
    });
  });
});

describe("randomSource", () => {
  it("defaults the seed to 0", () => {
    expect(DEFAULT_SEED).toBe(0);
  });

  // Computed by an independent Python implementation of FNV-1a over the UTF-8 of the
  // JSON key array, seeding mulberry32.
  it.each([
    ["hero in row 0", hero, [4_128_254_272, 3_961_891_807, 3_708_029_329]],
    [
      "hero in row 1",
      { ...hero, row: 1 },
      [3_622_984_511, 3_719_269_766, 3_483_086_608],
    ],
    [
      "hero with seed 1",
      { ...hero, seed: 1 },
      [533_293_205, 1_334_721_867, 3_624_956_655],
    ],
    [
      "an emoji name",
      { ...hero, name: "😀" },
      [766_353_251, 4_200_949_863, 545_243_218],
    ],
    [
      "the third ball prop",
      { ...hero, kind: "prop", name: "ball", occurrence: 2 },
      [2_174_878_025, 2_233_667_181, 3_448_965_966],
    ],
  ])("pins the first draws for %s", (_label, key, values) => {
    const source = randomSource(key);
    expect([source.uint32(0), source.uint32(1), source.uint32(2)]).toEqual(values);
  });

  it("returns a float in [0, 1) for the same draw", () => {
    expect(randomSource(hero).float(0)).toBe(0.961184099316597);
  });

  it("returns the same value for the same key regardless of call order", () => {
    const forward = randomSource(hero);
    const backward = randomSource(hero);
    const ascending = [0, 1, 2, 3].map((draw) => forward.uint32(draw));
    const descending = [3, 2, 1, 0].map((draw) => backward.uint32(draw)).reverse();
    expect(descending).toEqual(ascending);
  });

  it("returns the same value regardless of other keys drawn", () => {
    const alone = randomSource(hero).uint32(5);
    const other = randomSource({ ...hero, name: "villain" });
    other.uint32(5);
    other.float(0);
    const source = randomSource(hero);
    source.uint32(0);
    expect(source.uint32(5)).toBe(alone);
    expect(randomSource(hero).uint32(5)).toBe(alone);
  });

  it("returns the same value on every repeat of a draw", () => {
    const source = randomSource(hero);
    expect(source.uint32(7)).toBe(source.uint32(7));
  });

  it("treats an absent draw and an explicit undefined as draw 0", () => {
    const source = randomSource(hero);
    expect(source.uint32()).toBe(4_128_254_272);
    expect(source.uint32(undefined)).toBe(4_128_254_272);
    expect(source.float()).toBe(source.float(0));
  });

  it("draws at the largest safe index", () => {
    expect(randomSource(hero).uint32(Number.MAX_SAFE_INTEGER)).toBe(3_737_742_683);
  });

  it.each([
    [
      "row and occurrence",
      { ...hero, row: 1, occurrence: 12 },
      { ...hero, row: 11, occurrence: 2 },
    ],
    [
      "kind and name",
      { ...hero, kind: "ab", name: "c" },
      { ...hero, kind: "a", name: "bc" },
    ],
  ])("keeps keys that differ only in how %s split apart", (_label, left, right) => {
    expect(randomSource(left).uint32()).not.toBe(randomSource(right).uint32());
  });

  it.each([
    ["a fractional seed", { ...hero, seed: 0.5 }, "seed"],
    ["a negative row", { ...hero, row: -1 }, "row"],
    ["a fractional row", { ...hero, row: 1.5 }, "row"],
    ["a negative occurrence", { ...hero, occurrence: -1 }, "occurrence"],
    [
      "an unsafe occurrence",
      { ...hero, occurrence: Number.MAX_SAFE_INTEGER + 1 },
      "occurrence",
    ],
  ])("rejects %s", (_label, key, path) => {
    expect(rangeErrorOf(() => randomSource(key))).toMatchObject({
      code: "ERR_SCENE_OUT_OF_RANGE",
      path: path,
    });
  });

  it("accepts a negative seed", () => {
    expect(randomSource({ ...hero, seed: -1 }).uint32()).toBeTypeOf("number");
  });
});
