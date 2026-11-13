import type { RandomSource } from "./random.js";
import type { Micros } from "./time.js";

/**
 * How a track combines with what is beneath it: `replace` takes over the channels it
 * names, `add` adds its values to them.
 *
 * @public
 */
export type BlendMode = "replace" | "add";

export const BLEND_MODES: readonly BlendMode[] = ["replace", "add"];

/** How long a segment takes to blend in when the call does not say: 0.2 s. */
export const DEFAULT_BLEND_MICROS: Micros = 200_000;

/**
 * The second argument of a function at depth 3 or 4: where in the scene and in its
 * own segment the function is being evaluated.
 *
 * @public
 */
export interface Moment {
  /** Scene time in seconds. */
  readonly time: number;
  /** The segment's length in seconds; `Infinity` for an open-ended segment. */
  readonly duration: number;
  /** How far through the segment, 0 to 1; stays 0 in an open-ended segment. */
  readonly progress: number;
  /** The seeded random source of the item the function belongs to. */
  readonly random: RandomSource;
}

/** A `pose` call: target values, and the three phases of its arrival. */
export interface PoseData {
  readonly kind: "pose";
  readonly channels: Readonly<Record<string, number>>;
  readonly mode: BlendMode;
  readonly anticipation: Micros;
  readonly blend: Micros;
  readonly followThrough: Micros;
}

/** A `reach` call: an effector, the point it goes to, and the phases of its arrival. */
export interface ReachData {
  readonly kind: "reach";
  readonly effector: string;
  readonly target: { readonly x: number; readonly y: number };
  readonly anticipation: Micros;
  readonly blend: Micros;
  readonly followThrough: Micros;
}

/**
 * A `drive` call: the author's function, and the channels it names, read from what it
 * returned at `t = 0` when the call was recorded.
 */
export interface DriveData {
  readonly kind: "drive";
  readonly motion: (t: number, moment: Moment) => unknown;
  readonly channels: readonly string[];
  readonly mode: BlendMode;
  readonly blend: Micros;
}

export function isMotion(value: unknown): value is DriveData["motion"] {
  return typeof value === "function";
}

/** A `wait` call, or the placeholder of a call that could not be recorded. */
export interface WaitData {
  readonly kind: "wait";
}

/** A free drawing; `draw` is the author's callback. */
export interface DrawData {
  readonly kind: "draw";
  readonly draw: (...args: never[]) => unknown;
}

/** What a segment of an actor's track records. */
export type ActorSegmentData = PoseData | ReachData | DriveData | WaitData;
