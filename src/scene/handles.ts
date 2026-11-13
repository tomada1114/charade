import type { ShapeContext } from "../draw/context.js";
import type { Point } from "../rig/kinematics.js";
import type { ChannelName, EffectorName } from "../rig/rig.js";
import type { BlendMode, Moment } from "../timeline/segments.js";

/**
 * When a recorded call plays, in seconds of scene time.
 *
 * @remarks
 * Every recording call returns one. Parallel motion and timing across rows are
 * written with these numbers, as in `{ at: span.end }`; all rows share one clock.
 * A call without a duration is open-ended: its `end` and `duration` are `Infinity`.
 *
 * `Marks` names the moments inside the span that the call states, such as the
 * release of a throw. `pose`, `reach`, `drive`, `wait` and `draw` state none.
 *
 * @example
 * ```ts
 * import { scene } from "charade";
 *
 * const spans: Span[] = [];
 * scene((stage) => {
 *   const hero = stage.actor();
 *   spans.push(hero.pose({ kneeR: 1.2 }, { duration: 0.5 }));
 *   spans.push(hero.pose({ kneeR: 0 }, { duration: 0.5 }));
 * });
 * console.log(spans[1]?.start, spans[1]?.end);
 * // => 0.5 1
 * ```
 *
 * @public
 */
export interface Span<Marks extends string = never> {
  /** When the call starts. */
  readonly start: number;
  /** When the call ends; `Infinity` when it is open-ended. */
  readonly end: number;
  /** `end - start`. */
  readonly duration: number;
  /** Named moments inside the span, as scene times. */
  readonly marks: Readonly<Record<Marks, number>>;
}

/**
 * The values `pose` moves channels to: angles in radians, root offsets in figure
 * heights, face numbers. Channels left out are not touched.
 *
 * @public
 */
export type PoseChannels = Readonly<Partial<Record<ChannelName, number>>>;

/**
 * Motion as a function of time, at depth 3: the values of the channels it moves, `t`
 * seconds after its segment began.
 *
 * @remarks
 * It is called once with `t = 0` when `drive` records it, and the channels it returns
 * then are the ones the call moves; a channel it returns only later is ignored. It
 * must be a pure function of its arguments. Reading the clock or `Math.random` makes a
 * frame depend on when it was drawn; use `moment.random` instead.
 *
 * @public
 */
export type MotionFunction = (t: number, moment: Moment) => PoseChannels;

/**
 * A free drawing at depth 4: draws one frame on `ctx`, in row units with `y` up.
 *
 * @remarks
 * `t` is seconds since the drawing's segment began. Like a {@link MotionFunction} it
 * must be a pure function of its arguments.
 *
 * @public
 */
export type DrawFunction = (ctx: ShapeContext, t: number, moment: Moment) => void;

/**
 * Options of `actor.pose`.
 *
 * @public
 */
export interface PoseOptions {
  /** Absolute scene time to start at, in seconds. Defaults to the actor's cursor. */
  readonly at?: number;
  /**
   * How long the call occupies the actor, in seconds: the arrival, then holding the
   * pose. Defaults to `anticipation + blend + followThrough`; a shorter duration
   * shortens the three in proportion.
   */
  readonly duration?: number;
  /** Seconds the pose takes to blend in from what is beneath it. Defaults to 0.2. */
  readonly blend?: number;
  /** `replace` (the default) takes over the named channels; `add` adds to them. */
  readonly mode?: BlendMode;
  /** Seconds of wind-up away from the pose before moving to it. Defaults to 0. */
  readonly anticipation?: number;
  /** Seconds of overshoot past the pose after reaching it. Defaults to 0. */
  readonly followThrough?: number;
}

/**
 * Options of `actor.reach`.
 *
 * @public
 */
export interface ReachOptions {
  /** Absolute scene time to start at, in seconds. Defaults to the actor's cursor. */
  readonly at?: number;
  /**
   * How long the call occupies the actor, in seconds. Defaults to
   * `anticipation + blend + followThrough`; a shorter duration shortens the three in
   * proportion.
   */
  readonly duration?: number;
  /** Seconds the limb takes to arrive from where it is. Defaults to 0.2. */
  readonly blend?: number;
  /** Seconds of wind-up away from the target before moving to it. Defaults to 0. */
  readonly anticipation?: number;
  /** Seconds of overshoot past the target after reaching it. Defaults to 0. */
  readonly followThrough?: number;
}

/**
 * Options of `actor.drive`.
 *
 * @public
 */
export interface DriveOptions {
  /** Absolute scene time to start at, in seconds. Defaults to the actor's cursor. */
  readonly at?: number;
  /**
   * How long the function runs, in seconds. Without it the call is open-ended: it
   * runs to the end of the scene, does not extend it, and leaves the actor without a
   * cursor, so later calls on that actor need `at`.
   */
  readonly duration?: number;
  /** Seconds the motion takes to blend in, and out when it ends. Defaults to 0.2. */
  readonly blend?: number;
  /** `replace` (the default) takes over the named channels; `add` adds to them. */
  readonly mode?: BlendMode;
}

/**
 * Options of `row.draw`.
 *
 * @public
 */
export interface DrawOptions {
  /** Absolute scene time to start at, in seconds. Defaults to 0. */
  readonly at?: number;
  /** How long the drawing is shown, in seconds. Without it, to the end of the scene. */
  readonly duration?: number;
  /** A name for the drawing, used in its id and its random source. Defaults to `draw`. */
  readonly name?: string;
}

/**
 * Options of `row.actor`.
 *
 * @public
 */
export interface ActorOptions {
  /** A name for the actor, used in its id and its random source. Defaults to `actor`. */
  readonly name?: string;
}

/**
 * A stick figure in one row. Calls record what it does and when; nothing is drawn
 * while the scene runs.
 *
 * @remarks
 * The actor has a cursor: a call without `at` starts when everything already recorded
 * on the actor has ended, so consecutive calls play in order. When two calls overlap,
 * the one recorded later wins for the channels it names. A pose is held after its
 * call ends, until a later call moves those channels.
 *
 * You are handed an actor by `row.actor()`; you never implement this interface.
 *
 * @public
 */
export interface Actor {
  /** Names the actor in findings: its row, kind, name and occurrence index. */
  readonly id: string;

  /**
   * Move the named channels to the given values.
   *
   * @param channels - Target values by channel name.
   * @param options - Timing, blending and the timing curve.
   * @returns When the call plays.
   */
  pose(channels: PoseChannels, options?: PoseOptions): Span;

  /**
   * Put a hand or a foot on a point, by inverse kinematics on its two joints.
   *
   * @param effector - Which hand or foot.
   * @param target - Where it goes, in row units.
   * @param options - Timing, blending and the timing curve.
   * @returns When the call plays.
   */
  reach(effector: EffectorName, target: Point, options?: ReachOptions): Span;

  /**
   * Run channels as a function of time.
   *
   * @param motion - Returns the values of the channels it moves at time `t`.
   * @param options - Timing and blending.
   * @returns When the call plays.
   */
  drive(motion: MotionFunction, options?: DriveOptions): Span;

  /**
   * Hold still: move the cursor on by `seconds`.
   *
   * @param seconds - How long to wait.
   * @returns When the wait plays.
   */
  wait(seconds: number): Span;
}

/**
 * One row of the scene: a panel with its own ground line and coordinates.
 *
 * @remarks
 * You are handed a row by `stage.row(i)`; you never implement this interface.
 *
 * @public
 */
export interface Row {
  /** Names the row in findings. */
  readonly id: string;
  /** The row's index; 0 is the top. */
  readonly index: number;

  /**
   * Create the row's actor.
   *
   * @param options - The actor's name.
   * @returns The actor's handle.
   */
  actor(options?: ActorOptions): Actor;

  /**
   * Record a free drawing, called once per frame it is shown in.
   *
   * @param draw - Draws one frame.
   * @param options - When it is shown, and its name.
   * @returns When the drawing is shown.
   */
  draw(draw: DrawFunction, options?: DrawOptions): Span;
}

/**
 * What a scene's `build` callback receives: the rows, and the clock they share.
 *
 * @remarks
 * The stage is also row 0, so a one-row scene calls `stage.actor()` and
 * `stage.draw(...)` directly. On a scene with more rows those calls are a finding
 * that says to use `stage.row(i)`.
 *
 * @public
 */
export interface Stage extends Row {
  /**
   * The handle of row `index`; the same handle on every call.
   *
   * @param index - A whole number from 0 (the top) to one less than the row count.
   * @returns The row's handle.
   * @throws `UnknownRowError` when the scene has no such row.
   */
  row(index: number): Row;

  /**
   * Move every actor's cursor to the latest end recorded so far, in any row.
   *
   * @returns That time, in seconds.
   */
  sync(): number;
}
