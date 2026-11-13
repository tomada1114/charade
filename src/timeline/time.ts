import { CharadeError } from "../errors.js";

/** A time or a length of time in integer microseconds, as the timeline stores it. */
export type Micros = number;

export const MICROS_PER_SECOND = 1_000_000;

export const DEFAULT_FPS = 30;

/**
 * A number given to the timeline is outside what it can store: not finite, negative
 * where a time is expected, fractional where an integer is expected, or too large to
 * stay exact. `path` names the argument, never its value.
 */
export class TimelineRangeError extends CharadeError {
  readonly code = "ERR_SCENE_OUT_OF_RANGE" as const;

  readonly path: string;

  constructor(path: string) {
    super(`${path} is outside the range the timeline can store.`);
    this.path = path;
  }
}

/**
 * Quantises a time in seconds to integer microseconds, rounding to the nearest and a
 * half up. Each recorded value is quantised on its own; sums are taken afterwards in
 * microseconds, so `0.1` then `0.2` ends at exactly 300 000.
 */
export function toMicros(seconds: number, path = "seconds"): Micros {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new TimelineRangeError(path);
  }
  // `+ 0` turns a `-0` input into `0`.
  const micros = Math.round(seconds * MICROS_PER_SECOND) + 0;
  if (!Number.isSafeInteger(micros)) {
    throw new TimelineRangeError(path);
  }
  return micros;
}

/** Converts stored microseconds back to seconds, for the numbers handed to an author. */
export function toSeconds(micros: Micros): number {
  return micros / MICROS_PER_SECOND;
}

/** Throws unless `fps` is a positive safe integer. */
export function assertFps(fps: number): void {
  if (!Number.isSafeInteger(fps) || fps <= 0) {
    throw new TimelineRangeError("fps");
  }
}

/**
 * The scene time of frame `n` in seconds, `n / fps`, computed from `n` alone so it
 * never accumulates error from earlier frames.
 */
export function frameSeconds(frame: number, fps: number): number {
  assertFrame(frame);
  assertFps(fps);
  return frame / fps;
}

/**
 * The first frame drawn at or after `micros`: `ceil(micros × fps / 1e6)`, in exact
 * integer arithmetic. A frame time is rarely a whole microsecond (frame 1 at 30 fps is
 * 33 333.3̅ µs), so frames are compared by cross-multiplying, never by rounding the
 * frame's time.
 */
export function firstFrameAtOrAfter(micros: Micros, fps: number): number {
  const scaled = scaledMicros(micros, fps);
  const remainder = scaled % MICROS_PER_SECOND;
  const whole = (scaled - remainder) / MICROS_PER_SECOND;
  return remainder === 0 ? whole : whole + 1;
}

/**
 * The frames a half-open segment `[start, end)` covers, or `undefined` when it covers
 * none. An open-ended segment (`end` of `null`) has no last frame of its own; it runs
 * to the end of the scene.
 */
export function segmentFrames(
  start: Micros,
  end: Micros | null,
  fps: number,
): { readonly first: number; readonly last: number | null } | undefined {
  const first = firstFrameAtOrAfter(start, fps);
  if (end === null) {
    return { first, last: null };
  }
  const last = firstFrameAtOrAfter(end, fps) - 1;
  return last < first ? undefined : { first, last };
}

/** Whether frame `n` falls in the half-open segment `[start, end)`. */
export function frameInSegment(
  frame: number,
  start: Micros,
  end: Micros | null,
  fps: number,
): boolean {
  assertFrame(frame);
  const frameScaled = frame * MICROS_PER_SECOND;
  if (!Number.isSafeInteger(frameScaled)) {
    throw new TimelineRangeError("frame");
  }
  if (frameScaled < scaledMicros(start, fps)) {
    return false;
  }
  return end === null || frameScaled < scaledMicros(end, fps);
}

/**
 * The number of frames in a scene of duration `micros`: the duration rounded up to a
 * frame, times `fps`, plus one, because the frame at `t = duration` is drawn.
 */
export function frameCount(micros: Micros, fps: number): number {
  return firstFrameAtOrAfter(micros, fps) + 1;
}

function scaledMicros(micros: Micros, fps: number): number {
  assertFps(fps);
  if (!Number.isSafeInteger(micros) || micros < 0) {
    throw new TimelineRangeError("micros");
  }
  const scaled = micros * fps;
  if (!Number.isSafeInteger(scaled)) {
    throw new TimelineRangeError("micros");
  }
  return scaled;
}

function assertFrame(frame: number): void {
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new TimelineRangeError("frame");
  }
}
