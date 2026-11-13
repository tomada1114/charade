import type { TimelineObject } from "./timeline.js";
import { type Micros, TimelineRangeError } from "./time.js";

/** The fixed step stateful motion is sampled at: 4 ms, 250 samples a second. */
export const BAKE_STEP_MICROS = 4_000;

/**
 * Stateful motion stored as data. Sample `i` of every channel is the value at
 * `start + i × step`; the last sample is at or past the end of the motion.
 */
export interface BakedMotion extends TimelineObject {
  readonly kind: "baked";
  readonly start: Micros;
  readonly step: Micros;
  readonly channels: Readonly<Record<string, readonly number[]>>;
}

/**
 * Stores motion over `[start, end]` by calling `sample` once per step, in time order,
 * so a simulator may carry state between calls. Every call must return the same
 * channel names.
 */
export function bakeMotion(
  start: Micros,
  end: Micros,
  sample: (time: Micros) => Readonly<Record<string, number>>,
): BakedMotion {
  if (!Number.isSafeInteger(start) || start < 0) {
    throw new TimelineRangeError("start");
  }
  if (!Number.isSafeInteger(end) || end < start) {
    throw new TimelineRangeError("end");
  }
  const count = Math.ceil((end - start) / BAKE_STEP_MICROS) + 1;
  const channels: Record<string, number[]> = {};
  let channelCount = 0;
  for (let index = 0; index < count; index += 1) {
    const values = sample(start + index * BAKE_STEP_MICROS);
    const names = Object.keys(values);
    if (index === 0) {
      channelCount = names.length;
    } else if (names.length !== channelCount) {
      throw new TimelineRangeError("sample");
    }
    for (const name of names) {
      const value = values[name];
      const series = index === 0 ? (channels[name] = []) : channels[name];
      if (series === undefined || value === undefined || !Number.isFinite(value)) {
        throw new TimelineRangeError("sample");
      }
      series.push(value + 0);
    }
  }
  return { kind: "baked", start, step: BAKE_STEP_MICROS, channels };
}
