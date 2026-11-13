import { firstFrameAtOrAfter, type Micros } from "./time.js";

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
 * One recorded call on a timeline, half-open `[start, end)`.
 *
 * @remarks
 * `data` is what the call recorded. Its shape belongs to the call that wrote it and
 * is not part of the published contract; a function recorded at depth 3 or 4 is held
 * in it as it was given.
 *
 * @public
 */
export interface TimelineSegment {
  /** When the segment starts, in integer microseconds of scene time. */
  readonly start: number;
  /**
   * When the segment ends, in integer microseconds; `null` for an open-ended
   * segment, which runs to the end of the scene.
   */
  readonly end: number | null;
  /** What the call recorded. */
  readonly data: unknown;
}

/**
 * The segments of one item of a scene: an actor, or one free drawing.
 *
 * @remarks
 * `kind`, `name` and `occurrence` are the item's key, the same one its id and its
 * random source are built from.
 *
 * @public
 */
export interface TimelineTrack {
  /** What the item is, such as `actor` or `draw`. */
  readonly kind: string;
  /** The item's name. */
  readonly name: string;
  /** How many items of this kind and name the row created before this one. */
  readonly occurrence: number;
  /** The recorded calls, in the order they were recorded. */
  readonly segments: readonly TimelineSegment[];
}

/**
 * One row of a scene; row 0 is the top.
 *
 * @public
 */
export interface TimelineRow {
  /** The row's items, in the order they were created. */
  readonly tracks: readonly TimelineTrack[];
}

/**
 * The data a scene yields: every recorded call, with its times quantised to integer
 * microseconds.
 *
 * @remarks
 * The engine draws frame `n` as a pure function of this data and `n`. Read it
 * through this package's commands; an author has no reason to build one by hand.
 *
 * @public
 */
export interface Timeline {
  /** Frames per second, a positive integer. */
  readonly fps: number;
  /** The scene's random seed. */
  readonly seed: number;
  /** The `duration` option in integer microseconds, `null` when not set. */
  readonly duration: number | null;
  /** The rows, top first. */
  readonly rows: readonly TimelineRow[];
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
  const lastFrame = firstFrameAtOrAfter(micros, timeline.fps);
  return { ok: true, micros, lastFrame, frameCount: lastFrame + 1 };
}

function lastBoundedEnd(rows: readonly TimelineRow[]): Micros | undefined {
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
