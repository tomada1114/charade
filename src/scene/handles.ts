import type { ShapeContext } from "../draw/context.js";
import type { Point } from "../rig/kinematics.js";
import type { ChannelName, EffectorName } from "../rig/rig.js";
import type { BlendMode, Moment, TextAlign } from "../timeline/segments.js";
import type {
  BuiltinName,
  BuiltinActions,
  BuiltinBackdrops,
  BuiltinEffects,
  BuiltinExpressions,
  BuiltinProps,
} from "./builtins.js";
import type {
  ActionDefinition,
  BackdropDefinition,
  EffectDefinition,
  ExpressionDefinition,
  PropDefinition,
} from "./define.js";
import type { ItemArgs, ParamSpec } from "./params.js";

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
 * Options of `row.label`.
 *
 * @public
 */
export interface LabelOptions {
  /** Absolute scene time the label appears at, in seconds. Defaults to 0. */
  readonly at?: number;
  /**
   * How long the label is shown, in seconds. Without it the label is open-ended: it
   * stays to the end of the scene and does not make the scene longer.
   */
  readonly duration?: number;
  /** Where the label's alignment point is along `x`, in row units. Defaults to 0. */
  readonly x?: number;
  /**
   * Where the middle of the label is along `y`, in row units. Defaults to 2, near
   * the top of the row.
   */
  readonly y?: number;
  /** The font size, in row units; a standing figure is 1 tall. Defaults to 0.16. */
  readonly size?: number;
  /** Which part of the label `x` names. Defaults to `center`. */
  readonly align?: TextAlign;
  /** The width lines wrap at, in row units. Without it only `\n` breaks a line. */
  readonly width?: number;
  /** A name for the label, used in its id. Defaults to `label`. */
  readonly name?: string;
}

/**
 * Options of `actor.say`.
 *
 * @public
 */
export interface SayOptions {
  /** Absolute scene time to start at, in seconds. Defaults to the actor's cursor. */
  readonly at?: number;
  /**
   * How long the bubble is shown and the call occupies the actor, in seconds.
   * Defaults to a reading time: 1 second and 0.08 more for each character.
   */
  readonly duration?: number;
  /** The font size, in row units; a standing figure is 1 tall. Defaults to 0.16. */
  readonly size?: number;
  /** The width the text wraps at, in row units. Defaults to 12 times `size`. */
  readonly width?: number;
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

  /**
   * Say something: a speech bubble above the actor's head, which follows the head
   * while it is shown. The call occupies the actor as a `wait` does, so the next
   * call follows it; pass `at` to speak while doing something else.
   *
   * @param text - What is said; `\n` starts a new line.
   * @param options - Timing, the font size and the wrapping width.
   * @returns When the bubble is shown.
   */
  say(text: string, options?: SayOptions): Span;

  /**
   * Do an action, given as its definition.
   *
   * @param action - The action's definition.
   * @param options - The action's parameters, and the call's timing and mood.
   * @returns When the action plays, with the marks it states.
   */
  do<P extends ParamSpec, Marks extends string>(
    action: ActionDefinition<P, Marks>,
    ...options: ItemArgs<P, ActionOptions>
  ): Span<Marks>;
  /**
   * Do a built-in action, given by name.
   *
   * @param name - The built-in action's name.
   * @param options - The action's parameters, and the call's timing and mood.
   * @returns When the action plays, with the marks it states.
   */
  do<N extends BuiltinName<BuiltinActions>>(
    name: N,
    ...options: BuiltinActions[N] extends ActionDefinition<infer P>
      ? ItemArgs<P, ActionOptions>
      : never
  ): Span<
    BuiltinActions[N] extends ActionDefinition<ParamSpec, infer Marks> ? Marks : never
  >;

  /**
   * Show an expression, given as its definition or a built-in name.
   *
   * @param expression - The expression's definition.
   * @param options - The expression's parameters, and the call's timing.
   * @returns When the expression plays.
   */
  express<P extends ParamSpec>(
    expression: ExpressionDefinition<P>,
    ...options: ItemArgs<P, ExpressOptions>
  ): Span;
  /**
   * Show a built-in expression, given by name.
   *
   * @param name - The built-in expression's name.
   * @param options - The expression's parameters, and the call's timing.
   * @returns When the expression plays.
   */
  express<N extends BuiltinName<BuiltinExpressions>>(
    name: N,
    ...options: BuiltinExpressions[N] extends ExpressionDefinition<infer P>
      ? ItemArgs<P, ExpressOptions>
      : never
  ): Span;
}

/**
 * Options of `actor.do`, in the same bag as the action's parameters.
 *
 * @public
 */
export interface ActionOptions {
  /** Absolute scene time to start at, in seconds. Defaults to the actor's cursor. */
  readonly at?: number;
  /**
   * How long the action occupies the actor, in seconds. The action reads it as
   * `clip.duration`; without it the action lasts as long as what it records.
   */
  readonly duration?: number;
  /**
   * The expression the face shows while the action plays. An action lists the moods
   * that also change its body.
   */
  readonly mood?: BuiltinName<BuiltinExpressions> | ExpressionDefinition;
  /** The blend of the action's calls that do not set their own, in seconds. */
  readonly blend?: number;
  /** The mode of the action's calls that do not set their own. */
  readonly mode?: BlendMode;
}

/**
 * Options of `actor.express`, in the same bag as the expression's parameters.
 *
 * @public
 */
export interface ExpressOptions {
  /** Absolute scene time to start at, in seconds. Defaults to the actor's cursor. */
  readonly at?: number;
  /** How long the call occupies the actor, in seconds. Defaults to its blend. */
  readonly duration?: number;
  /** Seconds the face takes to change. Defaults to 0.2. */
  readonly blend?: number;
  /** `replace` (the default) takes over the face; `add` adds to it. */
  readonly mode?: BlendMode;
}

/**
 * Options of `row.prop`, `row.backdrop` and `row.effect`, in the same bag as the
 * item's parameters.
 *
 * @public
 */
export interface ItemOptions {
  /** Absolute scene time the item appears at, in seconds. Defaults to 0. */
  readonly at?: number;
  /** How long the item is shown, in seconds. Without it, to the end of the scene. */
  readonly duration?: number;
}

/**
 * Options of `prop.place`.
 *
 * @public
 */
export interface PlaceOptions {
  /**
   * Scene time the prop moves at, in seconds. Defaults to 0; inside an action's
   * `build`, time 0 is the action's start.
   */
  readonly at?: number;
  /**
   * Which side of the row's actor the prop draws on while it stands on this
   * placement: `"front"` for a desk the figure sits behind. Defaults to `"behind"`.
   */
  readonly layer?: "behind" | "front";
}

/**
 * Options of `prop.hold`.
 *
 * @public
 */
export interface HoldOptions {
  /**
   * Scene time the prop is taken at, in seconds. Defaults to 0; inside an action's
   * `build`, time 0 is the action's start.
   */
  readonly at?: number;
  /**
   * Where the prop's ground point sits from the hand or foot, in row units with `x`
   * the way the holder faces: `{ x: 0, y: -0.05 }` lowers a small ball into the palm.
   * Defaults to none, the ground point on the effector.
   */
  readonly offset?: Point;
}

/**
 * Options of `prop.move`.
 *
 * @public
 */
export interface MoveOptions {
  /**
   * Scene time the prop sets off at, in seconds. Defaults to 0; inside an action's
   * `build`, time 0 is the action's start.
   */
  readonly at?: number;
  /** How long the prop takes to arrive, in seconds. Defaults to 0.5. */
  readonly duration?: number;
  /**
   * How far the path rises above the straight line at its middle, in row units: a
   * thrown thing's parabola. Negative sags below it. Defaults to 0, a straight line.
   */
  readonly arc?: number;
}

/**
 * A prop in a row. An action that moves it takes the handle as a parameter.
 *
 * @remarks
 * The prop stands with its ground point on the row's origin until it is placed,
 * held or moved; the call that started last says where it is. It draws behind the
 * row's actor, and in front of it while it moves, is in a near (`R`) hand or foot, or
 * stands where `place` put it with `layer: "front"`.
 * You are handed a prop by `row.prop()`; you never implement this interface.
 *
 * @public
 */
export interface Prop {
  /** Names the prop in findings: its row, kind, name and occurrence index. */
  readonly id: string;

  /**
   * Put the prop's ground point on `point`, from `at` on, until it is placed again.
   *
   * @param point - Where the ground point goes, in row units.
   * @param options - When, and whether it draws behind or in front of the actor.
   * @returns When the placement holds; it is open-ended.
   */
  place(point: Point, options?: PlaceOptions): Span;

  /**
   * Put the prop's ground point on a hand or a foot of the row's actor, from `at`
   * on: it rides the effector until it is placed, held or moved again. Inside an
   * action's `build` the holder is the actor doing the action.
   *
   * @param effector - Which hand or foot carries the prop.
   * @param options - When.
   * @returns When the hold lasts; it is open-ended.
   */
  hold(effector: EffectorName, options?: HoldOptions): Span;

  /**
   * Send the prop from where it is at `at` to `to`, along a closed-form path: a
   * straight line at constant speed, lifted at its middle by `arc`. It stays on `to`
   * afterwards.
   *
   * @param to - Where the ground point arrives, in row units.
   * @param options - When, for how long, and how high the path arcs.
   * @returns When the prop is on its way.
   */
  move(to: Point, options?: MoveOptions): Span;
}

/**
 * What an action's `build` records on: the actor's depth 2 and 3 calls, with time 0
 * at the action's start.
 *
 * @remarks
 * `at` in a clip's calls, the spans they return and the times given to `mark` are
 * all in the action's own time. A call without `at` follows the clip's own cursor,
 * which starts at 0. You are handed a clip by `do`; you never implement this
 * interface.
 *
 * @public
 */
export interface Clip<Marks extends string = string> {
  /** Names the actor the clip records on. */
  readonly id: string;
  /** The duration the scene asked for in seconds, or `null` when it did not. */
  readonly duration: number | null;
  /** The name of the mood the scene asked for, or `null` when it did not. */
  readonly mood: string | null;

  /**
   * As `actor.pose`, in the action's time.
   *
   * @param channels - Target values by channel name.
   * @param options - Timing, blending and the timing curve.
   * @returns When the call plays, in the action's time.
   */
  pose(channels: PoseChannels, options?: PoseOptions): Span;

  /**
   * As `actor.reach`, in the action's time.
   *
   * @param effector - Which hand or foot.
   * @param target - Where it goes, in row units.
   * @param options - Timing, blending and the timing curve.
   * @returns When the call plays, in the action's time.
   */
  reach(effector: EffectorName, target: Point, options?: ReachOptions): Span;

  /**
   * As `actor.drive`, in the action's time.
   *
   * @param motion - Returns the values of the channels it moves at time `t`.
   * @param options - Timing and blending.
   * @returns When the call plays, in the action's time.
   */
  drive(motion: MotionFunction, options?: DriveOptions): Span;

  /**
   * As `actor.wait`.
   *
   * @param seconds - How long to wait.
   * @returns When the wait plays, in the action's time.
   */
  wait(seconds: number): Span;

  /**
   * Say when one of the action's marks falls.
   *
   * @param name - One of the marks the action states.
   * @param at - When, in seconds of the action's time.
   */
  mark(name: Marks, at: number): void;
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

  /**
   * Show free-standing text in the row, drawn in front of everything else in it.
   *
   * @param text - The text; `\n` starts a new line.
   * @param options - When it is shown, where, its size, alignment and name.
   * @returns When the label is shown.
   */
  label(text: string, options?: LabelOptions): Span;

  /**
   * Put a prop in the row, given as its definition.
   *
   * @param prop - The prop's definition.
   * @param options - The prop's parameters, and when it is shown.
   * @returns The prop's handle.
   */
  prop<P extends ParamSpec>(
    prop: PropDefinition<P>,
    ...options: ItemArgs<P, ItemOptions>
  ): Prop;
  /**
   * Put a built-in prop in the row, given by name.
   *
   * @param name - The built-in prop's name.
   * @param options - The prop's parameters, and when it is shown.
   * @returns The prop's handle.
   */
  prop<N extends BuiltinName<BuiltinProps>>(
    name: N,
    ...options: BuiltinProps[N] extends PropDefinition<infer P>
      ? ItemArgs<P, ItemOptions>
      : never
  ): Prop;

  /**
   * Show a backdrop behind the row, given as its definition.
   *
   * @param backdrop - The backdrop's definition.
   * @param options - The backdrop's parameters, and when it is shown.
   * @returns When the backdrop is shown.
   */
  backdrop<P extends ParamSpec>(
    backdrop: BackdropDefinition<P>,
    ...options: ItemArgs<P, ItemOptions>
  ): Span;
  /**
   * Show a built-in backdrop behind the row, given by name.
   *
   * @param name - The built-in backdrop's name.
   * @param options - The backdrop's parameters, and when it is shown.
   * @returns When the backdrop is shown.
   */
  backdrop<N extends BuiltinName<BuiltinBackdrops>>(
    name: N,
    ...options: BuiltinBackdrops[N] extends BackdropDefinition<infer P>
      ? ItemArgs<P, ItemOptions>
      : never
  ): Span;

  /**
   * Show an effect in the row, given as its definition.
   *
   * @param effect - The effect's definition.
   * @param options - The effect's parameters, and when it is shown.
   * @returns When the effect is shown.
   */
  effect<P extends ParamSpec>(
    effect: EffectDefinition<P>,
    ...options: ItemArgs<P, ItemOptions>
  ): Span;
  /**
   * Show a built-in effect in the row, given by name.
   *
   * @param name - The built-in effect's name.
   * @param options - The effect's parameters, and when it is shown.
   * @returns When the effect is shown.
   */
  effect<N extends BuiltinName<BuiltinEffects>>(
    name: N,
    ...options: BuiltinEffects[N] extends EffectDefinition<infer P>
      ? ItemArgs<P, ItemOptions>
      : never
  ): Span;
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
