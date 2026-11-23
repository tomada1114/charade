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

/**
 * The part of a row a frame shows, in the units and from the origin the function
 * handed it draws in: `y` up, the ground line at `y = 0` when that origin is on it.
 *
 * @remarks
 * A row always shows 2.5 units of height, 0.3 of them below the ground line. Its width
 * follows from the canvas and the row count: 2.5 units for one row of a square canvas,
 * about 17.8 for four rows of a 16:9 one. A drawing that spans the row reads its edges
 * here.
 *
 * @public
 */
export interface RowView {
  /** `x` of the row's left edge. */
  readonly left: number;
  /** `x` of the row's right edge. */
  readonly right: number;
  /** `y` of the row's lower edge. */
  readonly bottom: number;
  /** `y` of the row's upper edge. */
  readonly top: number;
}

/**
 * The moment a drawing function is handed: a free drawing at depth 4, or the `draw` of a
 * prop, backdrop or effect. It is a {@link Moment} plus how long the segment has been
 * shown and the row's visible area.
 *
 * @public
 */
export interface DrawMoment extends Moment {
  /**
   * Seconds since the segment began, the `t` a depth 4 function also receives as its
   * own argument. It counts in an open-ended segment too, where `progress` stays 0, so
   * what repeats starts with the segment rather than at scene time 0.
   */
  readonly t: number;
  /** The row's visible area, in the coordinates the function draws in. */
  readonly view: RowView;
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

/**
 * A `cycle` call: keyed values that repeat every `period`, each channel eased from
 * one of its keys to the next and from its last back to its first. All data, so it
 * serialises.
 */
export interface CycleData {
  readonly kind: "cycle";
  readonly period: Micros;
  /** In time order, each `at` within `[0, period)`. */
  readonly keys: readonly {
    readonly at: Micros;
    readonly channels: Readonly<Record<string, number>>;
  }[];
  readonly mode: BlendMode;
  readonly blend: Micros;
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
export type ActorSegmentData = PoseData | ReachData | DriveData | CycleData | WaitData;

/** A prop's placement: where its ground point is from the segment's start on. */
export interface PlaceData {
  readonly kind: "place";
  readonly x: number;
  readonly y: number;
  /** Which side of the row's actor the prop draws on while it stands here. */
  readonly layer: "behind" | "front";
}

/** A prop carried by an actor's hand or foot, from the segment's start on. */
export interface HoldData {
  readonly kind: "hold";
  readonly effector: string;
  /** The key of the holding actor's track in the prop's row. */
  readonly actor: { readonly name: string; readonly occurrence: number };
  /** The ground point's offset from the effector, `x` the way the holder faces. */
  readonly offset: { readonly x: number; readonly y: number };
}

/**
 * A prop moving to `x`, `y` over the segment, from where it was at the segment's
 * start: a straight line at constant speed, lifted by `4 · arc · p · (1 − p)` at
 * progress `p`, which is a thrown thing's parabola. It stays there afterwards.
 */
export interface MoveData {
  readonly kind: "move";
  readonly x: number;
  readonly y: number;
  readonly arc: number;
}

/** An effect's origin on a part of an actor of its row, followed every frame. */
export interface AnchorData {
  /** The key of the actor's track in the effect's row. */
  readonly actor: { readonly name: string; readonly occurrence: number };
  readonly part: string;
  /** The origin's offset from the part, `x` the way the actor faces. */
  readonly offset: { readonly x: number; readonly y: number };
}

/**
 * A prop, backdrop or effect while it is shown: its name, its definition when it was
 * passed as one (`null` for a built-in named by a string), and its resolved
 * parameters. An effect also records `on`, where its origin is: a point of the row, a
 * part of an actor, or `null` for the row's origin.
 */
export interface ItemData {
  readonly kind: "prop" | "backdrop" | "effect";
  readonly name: string;
  readonly definition: object | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly on?: { readonly x: number; readonly y: number } | AnchorData | null;
}

/**
 * Which part of a text block its `x` names: its left edge, its centre or its right
 * edge.
 *
 * @public
 */
export type TextAlign = "left" | "center" | "right";

export const TEXT_ALIGNS: readonly TextAlign[] = ["left", "center", "right"];

/**
 * A label while it is shown: its text, the point its block is centred on vertically
 * and aligned to horizontally, the size of its font in row units, and the width its
 * lines wrap at, `null` for none.
 */
export interface LabelData {
  readonly kind: "label";
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly align: TextAlign;
  readonly width: number | null;
}

/** A speech bubble while it is shown, above the head of the actor that says it. */
export interface SayData {
  readonly kind: "say";
  readonly text: string;
  /** The key of the speaking actor's track in the bubble's row. */
  readonly actor: { readonly name: string; readonly occurrence: number };
  readonly size: number;
  /** The width the text wraps at, in row units. */
  readonly width: number;
}
