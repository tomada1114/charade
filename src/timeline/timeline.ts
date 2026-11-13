import { firstFrameAtOrAfter, frameCount, type Micros } from "./time.js";

/** A function a scene put on the timeline at depth 3 or 4. It does not serialise. */
export type TimelineFunction = (...args: never[]) => unknown;

/** A plain object of timeline values. */
export interface TimelineObject {
  readonly [key: string]: TimelineValue;
}

/**
 * Anything a segment can carry: JSON data, or a function. Numbers are finite; `-0` is
 * stored as `0` in the JSON form.
 */
export type TimelineValue =
  | null
  | boolean
  | number
  | string
  | readonly TimelineValue[]
  | TimelineObject
  | TimelineFunction;

/**
 * One recorded call, half-open `[start, end)` in microseconds. `end` is `null` for an
 * open-ended segment, which runs to the end of the scene.
 */
export interface Segment {
  readonly start: Micros;
  readonly end: Micros | null;
  readonly data: TimelineValue;
}

/**
 * The segments of one item. `kind`, `name` and `occurrence` are the item's key, the
 * same one its id and its random source are built from.
 */
export interface Track {
  readonly kind: string;
  readonly name: string;
  readonly occurrence: number;
  readonly segments: readonly Segment[];
}

export interface Row {
  readonly tracks: readonly Track[];
}

/** The data a scene yields. `duration` is the explicit option, `null` when not set. */
export interface Timeline {
  readonly fps: number;
  readonly seed: number;
  readonly duration: Micros | null;
  readonly rows: readonly Row[];
}

/** The scene's length, or why it has none. */
export type DurationResult =
  | {
      readonly ok: true;
      /** The explicit duration, or the end of the last bounded segment, before rounding. */
      readonly micros: Micros;
      /** Index of the last frame, the frame at `t = duration` rounded up to a frame. */
      readonly lastFrame: number;
      /** `lastFrame + 1`. */
      readonly frameCount: number;
    }
  | {
      readonly ok: false;
      /** No `duration` was set and no segment in any row has an end. */
      readonly reason: "no-bounded-segment";
    };

/**
 * Computes the scene's duration: the explicit `duration` when set, otherwise the end
 * of the last bounded segment in any row; either is rounded up to a frame. Open-ended
 * segments do not extend it.
 */
export function computeDuration(timeline: Timeline): DurationResult {
  const micros = timeline.duration ?? lastBoundedEnd(timeline.rows);
  if (micros === undefined) {
    return { ok: false, reason: "no-bounded-segment" };
  }
  return {
    ok: true,
    micros,
    lastFrame: firstFrameAtOrAfter(micros, timeline.fps),
    frameCount: frameCount(micros, timeline.fps),
  };
}

function lastBoundedEnd(rows: readonly Row[]): Micros | undefined {
  let last: Micros | undefined;
  for (const row of rows) {
    for (const track of row.tracks) {
      for (const segment of track.segments) {
        if (segment.end !== null && (last === undefined || segment.end > last)) {
          last = segment.end;
        }
      }
    }
  }
  return last;
}
