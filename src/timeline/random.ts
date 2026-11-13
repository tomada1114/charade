import { TimelineRangeError } from "./time.js";

/** The seed a scene gets when it sets none. */
export const DEFAULT_SEED = 0;

/** What a random value is keyed on: the scene seed and the item's id parts. */
export interface RandomKey {
  readonly seed: number;
  readonly row: number;
  readonly kind: string;
  readonly name: string;
  readonly occurrence: number;
}

/**
 * The keyed random source handed to an item. Each value is a pure function of the key
 * and the draw index; there is no stream to advance, so draws can be made in any order.
 */
export interface RandomSource {
  /** An unsigned 32-bit integer for draw `draw` (default 0). */
  uint32(draw?: number): number;
  /** A float in `[0, 1)` for draw `draw` (default 0). */
  float(draw?: number): number;
}

const MULBERRY_INCREMENT = 0x6d2b79f5;
const TWO_TO_32 = 4_294_967_296;

/** Builds the random source for one item. */
export function randomSource(key: RandomKey): RandomSource {
  const hash = hashKey(key);
  const uint32 = (draw = 0): number => mulberry32At(hash, draw);
  return {
    uint32,
    float: (draw = 0) => uint32(draw) / TWO_TO_32,
  };
}

/**
 * 32-bit FNV-1a over the UTF-8 bytes of `text`. `JSON.stringify` output is always
 * well-formed (it escapes lone surrogates), which is what keeps the encoding lossless.
 */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of utf8(text)) {
    hash = Math.imul(hash ^ byte, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Output `draw` of mulberry32 seeded with `seed`, computed directly: mulberry32's
 * state after `n` steps is `seed + n × 0x6D2B79F5`, so no earlier output is needed.
 */
export function mulberry32At(seed: number, draw: number): number {
  if (!Number.isSafeInteger(draw) || draw < 0) {
    throw new TimelineRangeError("draw");
  }
  // Math.imul reduces `draw + 1` modulo 2^32 exactly for any safe integer.
  const state = (seed + Math.imul(draw + 1, MULBERRY_INCREMENT)) | 0;
  let t = Math.imul(state ^ (state >>> 15), state | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

function hashKey(key: RandomKey): number {
  if (!Number.isSafeInteger(key.seed)) {
    throw new TimelineRangeError("seed");
  }
  if (!Number.isSafeInteger(key.row) || key.row < 0) {
    throw new TimelineRangeError("row");
  }
  if (!Number.isSafeInteger(key.occurrence) || key.occurrence < 0) {
    throw new TimelineRangeError("occurrence");
  }
  // A JSON array keeps the parts apart: ("ab", "c") and ("a", "bc") hash differently.
  return fnv1a32(
    JSON.stringify([key.seed, key.row, key.kind, key.name, key.occurrence]),
  );
}

function* utf8(text: string): Generator<number> {
  for (const character of text) {
    // `for…of` yields whole code points, so `codePointAt(0)` is always defined.
    const point = character.codePointAt(0) ?? 0;
    if (point < 0x80) {
      yield point;
    } else if (point < 0x800) {
      yield 0xc0 | (point >> 6);
      yield 0x80 | (point & 0x3f);
    } else if (point < 0x10000) {
      yield 0xe0 | (point >> 12);
      yield 0x80 | ((point >> 6) & 0x3f);
      yield 0x80 | (point & 0x3f);
    } else {
      yield 0xf0 | (point >> 18);
      yield 0x80 | ((point >> 12) & 0x3f);
      yield 0x80 | ((point >> 6) & 0x3f);
      yield 0x80 | (point & 0x3f);
    }
  }
}
