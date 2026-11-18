import type { Finding, FindingCollector, Severity } from "../check/findings.js";
import { nearestNames } from "../check/nearest.js";
import { watchReads } from "../check/reads.js";
import { type ItemKind, SceneClosedError, UnknownRowError } from "../errors.js";
import {
  ANGLE_NAMES,
  CHANNEL_NAMES,
  FACE_NAMES,
  EFFECTOR_CHAINS,
  EFFECTOR_NAMES,
  isChannelName,
  isEffectorName,
} from "../rig/rig.js";
import {
  type ActorSegmentData,
  BLEND_MODES,
  type BlendMode,
  DEFAULT_BLEND_MICROS,
  type DrawData,
  type DriveData,
  type ItemData,
  type PlaceData,
  isMotion,
} from "../timeline/segments.js";
import { randomSource } from "../timeline/random.js";
import { type Micros, toSeconds } from "../timeline/time.js";
import type { Timeline } from "../timeline/timeline.js";
import type { Vocabulary } from "./builtins.js";
import { type Definition, allows } from "./define.js";
import type { Actor, Prop, Row, Span, Stage } from "./handles.js";
import type { Param } from "./params.js";
import { isRecord, microsOf } from "./values.js";

/** The scene options the builder needs, already resolved. */
export interface StageSettings {
  readonly fps: number;
  readonly seed: number;
  readonly rows: number;
  readonly duration: Micros | null;
}

interface MutableSegment {
  readonly start: Micros;
  readonly end: Micros | null;
  readonly data: ActorSegmentData | DrawData | ItemData | PlaceData;
}

interface MutableTrack {
  readonly kind: string;
  readonly name: string;
  readonly occurrence: number;
  readonly segments: MutableSegment[];
}

interface RowState {
  readonly index: number;
  readonly tracks: MutableTrack[];
  readonly occurrences: Map<string, number>;
  actors: number;
}

interface ActorState {
  readonly id: string;
  readonly row: number;
  readonly track: MutableTrack;
  /** The latest end of a bounded segment on this actor, or a later `sync()`. */
  cursor: Micros;
  /** Whether an open-ended segment was recorded: the actor then has no cursor. */
  open: boolean;
  /** Whether the missing cursor was reported: once per actor, so it cannot fill the cap. */
  warned: boolean;
  readonly fullBody: { readonly start: Micros; readonly end: Micros | null }[];
  /**
   * What a time given as `at` is counted from: 0 for an actor, the action's start for
   * the clip an action's `build` records on.
   */
  readonly offset: Micros;
  /** The blend and mode a call uses when it sets none: an action's, inside its clip. */
  readonly defaults: {
    readonly blend: Micros | undefined;
    readonly mode: BlendMode | undefined;
  };
}

interface PropState {
  readonly id: string;
  readonly row: number;
  readonly track: MutableTrack;
}

/** The definition of `Kind`. */
type DefinitionOf<Kind extends ItemKind> = Extract<Definition, { readonly kind: Kind }>;

/** Where a finding applies. */
interface Where {
  readonly row?: number;
  readonly target?: string;
}

interface Phases {
  readonly anticipation: Micros;
  readonly blend: Micros;
  readonly followThrough: Micros;
  readonly duration: Micros;
}

const NO_MARKS: Span["marks"] = Object.freeze({});

const TIMING = ["at", "duration"] as const;
const POSE_OPTIONS = [...TIMING, "blend", "mode", "anticipation", "followThrough"];
const REACH_OPTIONS = [...TIMING, "blend", "anticipation", "followThrough"];
const DRIVE_OPTIONS = [...TIMING, "blend", "mode"];
const DRAW_OPTIONS = [...TIMING, "name"];
const ACTOR_OPTIONS = ["name"];
const ACTION_OPTIONS = [...TIMING, "mood", "blend", "mode"];
const EXPRESS_OPTIONS = [...TIMING, "blend", "mode"];
const ITEM_OPTIONS: readonly string[] = TIMING;
const PLACE_OPTIONS = ["at"];

const ITEM_METHODS: Readonly<Record<ItemKind, string>> = {
  action: "do",
  expression: "express",
  prop: "prop",
  backdrop: "backdrop",
  effect: "effect",
};

/** A value to continue with when a parameter has no default and none was given. */
function placeholder(spec: Exclude<Param, { readonly type: "prop" }>): unknown {
  if (spec.default !== undefined) {
    return spec.default;
  }
  switch (spec.type) {
    case "number":
      return clamp(spec, 0);
    case "enum":
      return spec.values[0];
    case "boolean":
      return false;
    case "color":
      return "#111111";
    case "point":
      return { x: 0, y: 0 };
    case "text":
      return "";
  }
}

function clamp(
  spec: { readonly min?: number; readonly max?: number },
  value: number,
): number {
  return Math.min(Math.max(value, spec.min ?? -Infinity), spec.max ?? Infinity);
}

function capitalised(kind: string): string {
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

/** Whether `value` has the shape `define…` gives a definition of `kind`. */
function isDefinitionOf<Kind extends ItemKind>(
  kind: Kind,
  value: unknown,
): value is DefinitionOf<Kind> {
  if (!isRecord(value) || value["kind"] !== kind) {
    return false;
  }
  const method = kind === "action" || kind === "expression" ? "build" : "draw";
  return (
    typeof value["name"] === "string" &&
    isRecord(value["params"]) &&
    Object.values(value["params"]).every(
      (spec) => isRecord(spec) && typeof spec["type"] === "string",
    ) &&
    typeof value[method] === "function" &&
    (kind !== "action" ||
      (Array.isArray(value["marks"]) && Array.isArray(value["moods"])))
  );
}

/**
 * The parameter keys a call may take. When the item could not be resolved its keys are
 * unknown, so every key given is let through rather than reported a second time.
 */
function knownKeys(definition: Definition | undefined, options: unknown): string[] {
  if (definition !== undefined) {
    return Object.keys(definition.params);
  }
  return isRecord(options) ? Object.keys(options) : [];
}

function isFaceName(name: string): boolean {
  return FACE_NAMES.some((face) => face === name);
}

const SECONDS_FIX = "Pass a finite number of seconds, 0 or more.";

function isDrawFunction(value: unknown): value is DrawData["draw"] {
  return typeof value === "function";
}

function isBlendMode(value: unknown): value is BlendMode {
  return BLEND_MODES.some((mode) => mode === value);
}

function spanOf(
  start: Micros,
  end: Micros | null,
  marks: Span["marks"] = NO_MARKS,
): Span {
  return Object.freeze({
    start: toSeconds(start),
    end: end === null ? Infinity : toSeconds(end),
    duration: end === null ? Infinity : toSeconds(end - start),
    marks,
  });
}

/** A span of `actor`, in its own time: an action's clip counts from the action's start. */
function localSpan(actor: ActorState, start: Micros, end: Micros | null): Span {
  return spanOf(start - actor.offset, end === null ? null : end - actor.offset);
}

/**
 * Records a scene's calls. Scene code never draws: every handle method here appends
 * to a track, moves a cursor, or records a finding and continues with a placeholder.
 */
export class SceneBuilder {
  readonly stage: Stage;
  readonly #settings: StageSettings;
  readonly #findings: FindingCollector;
  readonly #top: RowState;
  readonly #rows: RowState[];
  readonly #handles: Row[];
  readonly #actors: ActorState[] = [];
  readonly #vocabulary: Vocabulary;
  /** The prop handles this scene made, and the views an action's `build` is given. */
  readonly #props = new WeakMap<object, PropState>();
  #latest: Micros = 0;
  #closed = false;
  #rowRequiredReported = false;

  constructor(
    settings: StageSettings,
    findings: FindingCollector,
    vocabulary: Vocabulary,
  ) {
    this.#settings = settings;
    this.#findings = findings;
    this.#vocabulary = vocabulary;
    const newRow = (index: number): RowState => ({
      index,
      tracks: [],
      occurrences: new Map<string, number>(),
      actors: 0,
    });
    this.#top = newRow(0);
    this.#rows = [
      this.#top,
      ...Array.from({ length: settings.rows - 1 }, (_, index) => newRow(index + 1)),
    ];
    this.#handles = this.#rows.map((row) => this.#rowHandle(row));
    this.stage = Object.freeze({
      id: "row0",
      index: 0,
      actor: (options?: unknown) => this.#actor(this.#stageRow("actor"), options),
      draw: (draw: unknown, options?: unknown) =>
        this.#draw(this.#stageRow("draw"), draw, options),
      prop: (prop: unknown, options?: unknown) =>
        this.#prop(this.#stageRow("prop"), prop, options),
      backdrop: (backdrop: unknown, options?: unknown) =>
        this.#shown(this.#stageRow("backdrop"), "backdrop", backdrop, options),
      effect: (effect: unknown, options?: unknown) =>
        this.#shown(this.#stageRow("effect"), "effect", effect, options),
      row: (index: number) => this.#row(index),
      sync: () => this.#sync(),
    });
  }

  /** After this, every handle throws: the scene is data and records nothing more. */
  close(): void {
    this.#closed = true;
  }

  timeline(): Timeline {
    return {
      fps: this.#settings.fps,
      seed: this.#settings.seed,
      duration: this.#settings.duration,
      rows: this.#rows.map((row) => ({ tracks: row.tracks })),
    };
  }

  #open(): void {
    if (this.#closed) {
      throw new SceneClosedError();
    }
  }

  #report(
    code: string,
    message: string,
    fix: string,
    where: Where,
    extra: Pick<Finding, "joint" | "measured" | "nearest" | "time"> & {
      severity?: Severity;
    } = {},
  ): void {
    this.#findings.add({ code, severity: "error", message, fix, ...where, ...extra });
  }

  #row(index: number): Row {
    this.#open();
    const handle = Number.isSafeInteger(index) ? this.#handles[index] : undefined;
    if (handle === undefined) {
      throw new UnknownRowError(this.#settings.rows);
    }
    return handle;
  }

  /** Row 0 for a call made on the stage itself, which is only right on a one-row scene. */
  #stageRow(call: "actor" | "draw" | "prop" | "backdrop" | "effect"): RowState {
    this.#open();
    if (this.#settings.rows > 1 && !this.#rowRequiredReported) {
      // Once per scene, so a loop of stage calls cannot fill the findings cap.
      this.#rowRequiredReported = true;
      this.#report(
        "ERR_SCENE_ROW_REQUIRED",
        `stage.${call}() was called on a scene with ${String(this.#settings.rows)} rows; it was recorded on row 0.`,
        `Name the row with stage.row(i), as in stage.row(0).${call}(...).`,
        { row: 0 },
      );
    }
    return this.#top;
  }

  #rowHandle(row: RowState): Row {
    return Object.freeze({
      id: `row${String(row.index)}`,
      index: row.index,
      actor: (options?: unknown) => {
        this.#open();
        return this.#actor(row, options);
      },
      draw: (draw: unknown, options?: unknown) => {
        this.#open();
        return this.#draw(row, draw, options);
      },
      prop: (prop: unknown, options?: unknown) => {
        this.#open();
        return this.#prop(row, prop, options);
      },
      backdrop: (backdrop: unknown, options?: unknown) => {
        this.#open();
        return this.#shown(row, "backdrop", backdrop, options);
      },
      effect: (effect: unknown, options?: unknown) => {
        this.#open();
        return this.#shown(row, "effect", effect, options);
      },
    });
  }

  #sync(): number {
    this.#open();
    for (const actor of this.#actors) {
      actor.cursor = Math.max(actor.cursor, this.#latest);
    }
    return toSeconds(this.#latest);
  }

  /** An options bag as a record, with a finding for anything that is not one of `allowed`. */
  #options(
    raw: unknown,
    allowed: readonly string[],
    call: string,
    where: Where,
  ): Readonly<Record<string, unknown>> {
    if (raw === undefined) {
      return {};
    }
    if (!isRecord(raw)) {
      this.#report(
        "ERR_SCENE_INVALID_VALUE",
        `The options of ${call} are not an object.`,
        `Pass an object with any of: ${allowed.join(", ")}.`,
        where,
      );
      return {};
    }
    for (const key of Object.keys(raw)) {
      if (!allowed.includes(key)) {
        this.#report(
          "ERR_SCENE_UNKNOWN_OPTION",
          `${call} has no option named ${key}; it was ignored.`,
          `Use one of: ${allowed.join(", ")}.`,
          where,
          { nearest: nearestNames(key, allowed) },
        );
      }
    }
    return raw;
  }

  #seconds(value: unknown, path: string, where: Where): Micros | undefined {
    if (value === undefined) {
      return undefined;
    }
    const micros = microsOf(value);
    if (micros === undefined) {
      this.#report(
        "ERR_SCENE_OUT_OF_RANGE",
        `${path} is not a time the timeline can store; its default was used.`,
        SECONDS_FIX,
        where,
      );
    }
    return micros;
  }

  #name(value: unknown, fallback: string, call: string, where: Where): string {
    if (value === undefined) {
      return fallback;
    }
    if (typeof value !== "string" || value === "") {
      this.#report(
        "ERR_SCENE_INVALID_VALUE",
        `The name given to ${call} is not a non-empty string; "${fallback}" was used.`,
        "Pass a non-empty string as options.name, or leave it out.",
        where,
      );
      return fallback;
    }
    return value;
  }

  #track(row: RowState, kind: string, name: string): MutableTrack {
    const key = JSON.stringify([kind, name]);
    const occurrence = row.occurrences.get(key) ?? 0;
    row.occurrences.set(key, occurrence + 1);
    const track: MutableTrack = { kind, name, occurrence, segments: [] };
    row.tracks.push(track);
    return track;
  }

  #actor(row: RowState, options: unknown): Actor {
    const where: Where = { row: row.index };
    const bag = this.#options(options, ACTOR_OPTIONS, "actor", where);
    const name = this.#name(bag["name"], "actor", "actor", where);
    const track = this.#track(row, "actor", name);
    const id = `row${String(row.index)}/actor/${name}/${String(track.occurrence)}`;
    if (row.actors > 0) {
      this.#report(
        "ERR_SCENE_ROW_HAS_ACTOR",
        `Row ${String(row.index)} already has an actor; a row holds at most one.`,
        "Keep the first actor's handle in a variable and reuse it, or put this actor in another row.",
        { row: row.index, target: id },
      );
    }
    row.actors += 1;
    const state: ActorState = {
      id,
      row: row.index,
      track,
      cursor: 0,
      open: false,
      warned: false,
      fullBody: [],
      offset: 0,
      defaults: { blend: undefined, mode: undefined },
    };
    this.#actors.push(state);
    return Object.freeze({
      id,
      pose: (channels: unknown, poseOptions?: unknown) =>
        this.#pose(state, channels, poseOptions),
      reach: (effector: unknown, target: unknown, reachOptions?: unknown) =>
        this.#reach(state, effector, target, reachOptions),
      drive: (motion: unknown, driveOptions?: unknown) =>
        this.#drive(state, motion, driveOptions),
      wait: (seconds: unknown) => this.#wait(state, seconds),
      do: (action: unknown, doOptions?: unknown) => this.#do(state, action, doOptions),
      express: (expression: unknown, expressOptions?: unknown) =>
        this.#express(state, expression, expressOptions),
    });
  }

  #draw(row: RowState, draw: unknown, options: unknown): Span {
    const where: Where = { row: row.index };
    const bag = this.#options(options, DRAW_OPTIONS, "draw", where);
    const name = this.#name(bag["name"], "draw", "draw", where);
    const start = this.#seconds(bag["at"], "draw's options.at", where) ?? 0;
    const duration = this.#seconds(bag["duration"], "draw's options.duration", where);
    const end = duration === undefined ? null : start + duration;
    if (!isDrawFunction(draw)) {
      this.#report(
        "ERR_SCENE_INVALID_VALUE",
        "draw was not given a function; nothing was recorded.",
        "Pass a function (ctx, t, moment) => { ... } that draws one frame.",
        where,
      );
      return spanOf(start, end);
    }
    this.#track(row, "draw", name).segments.push({
      start,
      end,
      data: { kind: "draw", draw },
    });
    this.#latest = Math.max(this.#latest, end ?? 0);
    return spanOf(start, end);
  }

  /**
   * The three phases of an arrival and the call's duration. Phases longer than the
   * duration are shortened in proportion, so the segment has arrived when it ends.
   */
  #phases(
    actor: ActorState,
    bag: Readonly<Record<string, unknown>>,
    call: string,
    where: Where,
  ): Phases {
    const seconds = (key: string): Micros | undefined =>
      this.#seconds(bag[key], `${call}'s options.${key}`, where);
    const anticipation = seconds("anticipation") ?? 0;
    const blend = seconds("blend") ?? actor.defaults.blend ?? DEFAULT_BLEND_MICROS;
    const followThrough = seconds("followThrough") ?? 0;
    const natural = anticipation + blend + followThrough;
    const duration = seconds("duration") ?? natural;
    if (natural <= duration) {
      return { anticipation, blend, followThrough, duration };
    }
    const fitted = (phase: Micros): Micros => Math.floor((phase * duration) / natural);
    const shortAnticipation = fitted(anticipation);
    const shortFollowThrough = fitted(followThrough);
    return {
      anticipation: shortAnticipation,
      blend: duration - shortAnticipation - shortFollowThrough,
      followThrough: shortFollowThrough,
      duration,
    };
  }

  #mode(
    value: unknown,
    call: string,
    where: Where,
    fallback: BlendMode = "replace",
  ): BlendMode {
    if (value === undefined) {
      return fallback;
    }
    if (!isBlendMode(value)) {
      this.#report(
        "ERR_SCENE_UNKNOWN_MODE",
        `${call} has no mode ${typeof value === "string" ? `named ${value}` : "like that"}; replace was used.`,
        `Use one of: ${BLEND_MODES.join(", ")}.`,
        where,
        { nearest: typeof value === "string" ? nearestNames(value, BLEND_MODES) : [] },
      );
      return "replace";
    }
    return value;
  }

  /** The entries of a channel map that name a channel, with a finding for each that does not. */
  #channels(
    raw: unknown,
    call: string,
    where: Where,
  ): [name: string, value: unknown][] {
    if (!isRecord(raw)) {
      this.#report(
        "ERR_SCENE_INVALID_VALUE",
        `${call} did not give a map of channels.`,
        `Give an object keyed by channel name, such as { spine: 0.2 }.`,
        where,
      );
      return [];
    }
    const kept: [string, unknown][] = [];
    for (const [name, value] of Object.entries(raw)) {
      if (isEffectorName(name)) {
        const chain = EFFECTOR_CHAINS[name];
        this.#report(
          "ERR_SCENE_EFFECTOR_AS_CHANNEL",
          `${name} is a target for reach, not a channel; it was ignored.`,
          `Set ${chain[0]} and ${chain[1]}, or call reach("${name}", point).`,
          where,
          { joint: name, nearest: [...chain] },
        );
      } else if (!isChannelName(name)) {
        this.#report(
          "ERR_SCENE_UNKNOWN_CHANNEL",
          `No channel is named ${name}; it was ignored.`,
          `Use a channel name: ${CHANNEL_NAMES.join(", ")}.`,
          where,
          { joint: name, nearest: nearestNames(name, CHANNEL_NAMES) },
        );
      } else {
        kept.push([name, value]);
      }
    }
    return kept;
  }

  /** Where a call on `actor` goes, moving the cursor past it. */
  #place(
    actor: ActorState,
    call: string,
    at: unknown,
    duration: Micros | null,
    where: Where,
  ): { readonly start: Micros; readonly end: Micros | null } {
    const start = this.#startOf(actor, call, at, where);
    const end = duration === null ? null : start + duration;
    if (end === null) {
      actor.open = true;
    }
    actor.cursor = Math.max(actor.cursor, end ?? start);
    this.#latest = Math.max(this.#latest, end ?? 0);
    return { start, end };
  }

  /** Where a call on `actor` starts: at `at`, counted from its offset, or at its cursor. */
  #startOf(actor: ActorState, call: string, at: unknown, where: Where): Micros {
    const given = this.#seconds(at, `${call}'s options.at`, where);
    if (given === undefined && actor.open && !actor.warned) {
      actor.warned = true;
      this.#report(
        "ERR_SCENE_NO_CURSOR",
        `${call} has no time to start at: an open-ended call was recorded on this actor before it, and that never ends.`,
        `Pass { at } to ${call} and to every later call on this actor, or give the open-ended call a duration.`,
        where,
        { time: [toSeconds(actor.cursor), toSeconds(actor.cursor)] },
      );
    }
    return given === undefined ? actor.cursor : given + actor.offset;
  }

  #pose(actor: ActorState, channels: unknown, options: unknown): Span {
    this.#open();
    const where: Where = { row: actor.row, target: actor.id };
    const bag = this.#options(options, POSE_OPTIONS, "pose", where);
    const values: Record<string, number> = {};
    for (const [name, value] of this.#channels(channels, "pose", where)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        // `+ 0` stores a `-0` as `0`, as the timeline's JSON form does.
        values[name] = value + 0;
      } else {
        this.#report(
          "ERR_SCENE_OUT_OF_RANGE",
          `The value of ${name} is not a finite number; it was ignored.`,
          `Give ${name} a finite number.`,
          where,
          { joint: name },
        );
      }
    }
    return this.#recordPose(actor, values, bag, "pose", where);
  }

  /** Records a pose of checked `values`, timed by an already checked options `bag`. */
  #recordPose(
    actor: ActorState,
    values: Readonly<Record<string, number>>,
    bag: Readonly<Record<string, unknown>>,
    call: string,
    where: Where,
  ): Span {
    const { duration, ...phases } = this.#phases(actor, bag, call, where);
    const mode = this.#mode(bag["mode"], call, where, actor.defaults.mode);
    const { start, end } = this.#place(actor, call, bag["at"], duration, where);
    actor.track.segments.push({
      start,
      end,
      data: { kind: "pose", channels: values, mode, ...phases },
    });
    if (
      mode === "replace" &&
      ANGLE_NAMES.every((name) => Object.hasOwn(values, name))
    ) {
      this.#fullBody(actor, start, end, where);
    }
    return localSpan(actor, start, end);
  }

  /** Notes a full-body segment, with a warning when it starts inside an earlier one. */
  #fullBody(actor: ActorState, start: Micros, end: Micros | null, where: Where): void {
    const cut = actor.fullBody.find(
      (earlier) =>
        earlier.start <= start && (earlier.end === null || start < earlier.end),
    );
    if (cut !== undefined) {
      this.#report(
        "ERR_SCENE_FULL_BODY_CUT",
        "A full-body call starts while an earlier full-body call is still playing, and cuts it short.",
        "Start it at the earlier call's end, or shorten the earlier call. Ignore this if the cut is meant.",
        where,
        {
          severity: "warning",
          time: [toSeconds(start), toSeconds(cut.end ?? start)],
        },
      );
    }
    actor.fullBody.push({ start, end });
  }

  #reach(
    actor: ActorState,
    effector: unknown,
    target: unknown,
    options: unknown,
  ): Span {
    this.#open();
    const where: Where = { row: actor.row, target: actor.id };
    const bag = this.#options(options, REACH_OPTIONS, "reach", where);
    const { duration, ...phases } = this.#phases(actor, bag, "reach", where);
    const { start, end } = this.#place(actor, "reach", bag["at"], duration, where);
    const point = this.#point(target, "reach", where);
    if (!isEffectorName(effector)) {
      const named = typeof effector === "string";
      this.#report(
        "ERR_SCENE_UNKNOWN_EFFECTOR",
        `reach moves a hand or a foot, not ${named ? effector : "that"}; the call was recorded as a wait.`,
        `Use one of: ${EFFECTOR_NAMES.join(", ")}.`,
        where,
        { nearest: named ? nearestNames(effector, EFFECTOR_NAMES) : [] },
      );
    }
    // A call that cannot be recorded still takes its time, so what follows keeps its place.
    actor.track.segments.push({
      start,
      end,
      data:
        isEffectorName(effector) && point !== undefined
          ? { kind: "reach", effector, target: point, ...phases }
          : { kind: "wait" },
    });
    return localSpan(actor, start, end);
  }

  #point(
    target: unknown,
    call: "reach" | "place",
    where: Where,
  ): { readonly x: number; readonly y: number } | undefined {
    if (isRecord(target)) {
      const { x, y } = target;
      if (
        typeof x === "number" &&
        typeof y === "number" &&
        Number.isFinite(x) &&
        Number.isFinite(y)
      ) {
        return { x: x + 0, y: y + 0 };
      }
    }
    this.#report(
      "ERR_SCENE_OUT_OF_RANGE",
      call === "reach"
        ? "The target of reach is not a point with finite x and y; the call was recorded as a wait."
        : "The point given to place is not a point with finite x and y; the prop was not moved.",
      "Pass { x, y } in row units: the origin is on the ground at the row's centre, y up.",
      where,
    );
    return undefined;
  }

  #drive(actor: ActorState, motion: unknown, options: unknown): Span {
    this.#open();
    const where: Where = { row: actor.row, target: actor.id };
    const bag = this.#options(options, DRIVE_OPTIONS, "drive", where);
    const duration =
      this.#seconds(bag["duration"], "drive's options.duration", where) ?? null;
    const blend = Math.min(
      this.#seconds(bag["blend"], "drive's options.blend", where) ??
        actor.defaults.blend ??
        DEFAULT_BLEND_MICROS,
      duration ?? Infinity,
    );
    const mode = this.#mode(bag["mode"], "drive", where, actor.defaults.mode);
    const { start, end } = this.#place(actor, "drive", bag["at"], duration, where);
    if (!isMotion(motion)) {
      this.#report(
        "ERR_SCENE_INVALID_VALUE",
        "drive was not given a function; the call was recorded as a wait.",
        "Pass a function of time that returns channel values, such as (t) => ({ spine: Math.sin(t * 3) * 0.1 }). Fixed values belong in pose.",
        where,
      );
      actor.track.segments.push({ start, end, data: { kind: "wait" } });
      return localSpan(actor, start, end);
    }
    const channels = this.#driven(actor, motion, start, end, where);
    actor.track.segments.push({
      start,
      end,
      data: { kind: "drive", motion, channels, mode, blend },
    });
    return localSpan(actor, start, end);
  }

  /**
   * The channels a drive names: the keys its function returns at `t = 0`. They have
   * to be known when the call is recorded, so that an unknown name is a finding and
   * the call overrides only its own joints.
   */
  #driven(
    actor: ActorState,
    motion: DriveData["motion"],
    start: Micros,
    end: Micros | null,
    where: Where,
  ): string[] {
    let first: unknown;
    try {
      // A clock or random read here is left to the frame check, which meets it again
      // at every frame and names the track; kept, it would be reported twice.
      first = watchReads(() =>
        motion(0, {
          time: toSeconds(start),
          duration: end === null ? Infinity : toSeconds(end - start),
          progress: 0,
          random: randomSource({
            seed: this.#settings.seed,
            row: actor.row,
            kind: actor.track.kind,
            name: actor.track.name,
            occurrence: actor.track.occurrence,
          }),
        }),
      ).value;
    } catch {
      this.#report(
        "ERR_SCENE_INVALID_VALUE",
        "The function given to drive threw when it was called with t = 0; it moves nothing.",
        "Make it return its channel values for every t from 0, without reading anything but its arguments.",
        where,
      );
      return [];
    }
    return this.#channels(first, "drive's function", where).map(([name]) => name);
  }

  #wait(actor: ActorState, seconds: unknown): Span {
    this.#open();
    const where: Where = { row: actor.row, target: actor.id };
    const duration = microsOf(seconds);
    if (duration === undefined) {
      this.#report(
        "ERR_SCENE_OUT_OF_RANGE",
        "wait was not given a time the timeline can store; it waited 0 seconds.",
        SECONDS_FIX,
        where,
      );
    }
    const { start, end } = this.#place(actor, "wait", undefined, duration ?? 0, where);
    actor.track.segments.push({ start, end, data: { kind: "wait" } });
    return localSpan(actor, start, end);
  }
  /**
   * The definition `item` names or is, or `undefined` with a finding: a name that is
   * not a built-in of `kind`, or a value that is not a definition of `kind`.
   */
  #definition<Kind extends ItemKind>(
    kind: Kind,
    item: unknown,
    call: string,
    where: Where,
  ): DefinitionOf<Kind> | undefined {
    // A built-in map is typed by its names, not as a record; every entry is checked here.
    const builtins = this.#vocabulary[kind] as Readonly<Record<string, unknown>>;
    if (typeof item === "string") {
      const found = Object.hasOwn(builtins, item) ? builtins[item] : undefined;
      if (isDefinitionOf(kind, found)) {
        return found;
      }
      const names = Object.keys(builtins);
      this.#report(
        `ERR_SCENE_UNKNOWN_${kind.toUpperCase()}`,
        `No ${kind} is named ${item}.`,
        names.length === 0
          ? `There are no built-in ${kind}s yet; pass a definition made with define${capitalised(kind)}.`
          : `Use a built-in ${kind} (run charade catalog), or pass a definition made with define${capitalised(kind)}.`,
        where,
        { nearest: nearestNames(item, names) },
      );
      return undefined;
    }
    if (isDefinitionOf(kind, item)) {
      return item;
    }
    const other =
      isRecord(item) && typeof item["kind"] === "string" ? item["kind"] : null;
    this.#report(
      "ERR_SCENE_INVALID_VALUE",
      other === null
        ? `${call} was not given a ${kind} name or definition.`
        : `${call} was given a ${other} definition, not a ${kind}.`,
      `Pass a built-in ${kind}'s name, or a definition made with define${capitalised(kind)}.`,
      where,
    );
    return undefined;
  }

  /**
   * Every parameter of `definition`, from `bag`, defaults filled in. A bad or missing
   * value is a finding and a placeholder is used; `undefined` when a prop parameter
   * has no valid handle, since an action cannot move a prop it was not given.
   */
  #resolve(
    definition: Definition,
    bag: Readonly<Record<string, unknown>>,
    offset: Micros,
    where: Where,
  ): Readonly<Record<string, unknown>> | undefined {
    const resolved: Record<string, unknown> = {};
    let runnable = true;
    const item = `${definition.kind} ${definition.name}`;
    for (const [key, spec] of Object.entries(definition.params)) {
      // Own keys only: a parameter named like an Object.prototype member is not passed.
      const value = Object.hasOwn(bag, key) ? bag[key] : undefined;
      if (spec.type === "prop") {
        const prop = this.#props.get(isRecord(value) ? value : {});
        if (prop === undefined) {
          runnable = false;
          this.#report(
            value === undefined
              ? "ERR_SCENE_MISSING_PARAMETER"
              : "ERR_SCENE_INVALID_VALUE",
            value === undefined
              ? `The ${item} needs ${key}, a prop; it was not done.`
              : `${key} of the ${item} is not a prop handle of this scene; it was not done.`,
            `Pass the handle row.prop(...) returned as ${key}.`,
            where,
          );
        } else {
          resolved[key] = this.#propHandle(prop, offset);
        }
        continue;
      }
      if (value === undefined) {
        if (spec.default === undefined) {
          this.#report(
            "ERR_SCENE_MISSING_PARAMETER",
            `The ${item} needs ${key}; a placeholder was used.`,
            `Pass ${key}: ${spec.doc}`,
            where,
          );
        }
        resolved[key] = placeholder(spec);
        continue;
      }
      if (allows(spec, value)) {
        resolved[key] =
          spec.type === "point" && isRecord(value)
            ? { x: Number(value["x"]) + 0, y: Number(value["y"]) + 0 }
            : value;
        continue;
      }
      resolved[key] = this.#badParameter(item, key, spec, value, where);
    }
    return runnable ? resolved : undefined;
  }

  /** Reports a value `spec` does not allow, and returns the value to continue with. */
  #badParameter(
    item: string,
    key: string,
    spec: Exclude<Param, { readonly type: "prop" }>,
    value: unknown,
    where: Where,
  ): unknown {
    if (spec.type === "number") {
      const finite = typeof value === "number" && Number.isFinite(value);
      const range =
        `${spec.min === undefined ? "" : `from ${String(spec.min)} `}${spec.max === undefined ? "" : `to ${String(spec.max)}`}`.trim();
      this.#report(
        "ERR_SCENE_OUT_OF_RANGE",
        finite
          ? `${key} of the ${item} is ${String(value)}, outside ${range}; ${String(clamp(spec, value))} was used.`
          : `${key} of the ${item} is not a finite number; a placeholder was used.`,
        `Give ${key} a number${range === "" ? "" : ` ${range}`}.`,
        where,
        finite
          ? {
              measured: {
                value,
                ...(spec.min === undefined ? {} : { min: spec.min }),
                ...(spec.max === undefined ? {} : { max: spec.max }),
              },
            }
          : {},
      );
      return finite ? clamp(spec, value) : placeholder(spec);
    }
    const expected = {
      enum: `one of: ${spec.type === "enum" ? spec.values.join(", ") : ""}`,
      boolean: "true or false",
      color: "a CSS colour string",
      point: "a point { x, y } with finite numbers",
      text: "a string",
    }[spec.type];
    this.#report(
      "ERR_SCENE_INVALID_VALUE",
      `${key} of the ${item} is not ${expected}; a placeholder was used.`,
      `Give ${key} ${expected}.`,
      where,
      spec.type === "enum" && typeof value === "string"
        ? { nearest: nearestNames(value, spec.values) }
        : {},
    );
    return placeholder(spec);
  }

  /** The checked face values `expression` returns, with a finding for each bad one. */
  #face(
    expression: DefinitionOf<"expression">,
    params: Readonly<Record<string, unknown>>,
    where: Where,
  ): Record<string, number> {
    // The params were resolved from the definition's own specification.
    const returned: unknown = expression.build(params as never);
    const values: Record<string, number> = {};
    const item = `expression ${expression.name}`;
    if (!isRecord(returned)) {
      this.#report(
        "ERR_SCENE_INVALID_VALUE",
        `The ${item} did not return a map of face channels; the face was not changed.`,
        "Return an object keyed by face channel, such as { mouthCurve: 0.5 }.",
        where,
      );
      return values;
    }
    for (const [name, value] of Object.entries(returned)) {
      if (!isFaceName(name)) {
        this.#report(
          "ERR_SCENE_UNKNOWN_CHANNEL",
          `The ${item} returned ${name}, which is not a face channel; it was ignored.`,
          `Return face channels only: ${FACE_NAMES.join(", ")}.`,
          where,
          { joint: name, nearest: nearestNames(name, FACE_NAMES) },
        );
      } else if (typeof value === "number" && Number.isFinite(value)) {
        values[name] = value + 0;
      } else {
        this.#report(
          "ERR_SCENE_OUT_OF_RANGE",
          `The ${item} returned a value for ${name} that is not a finite number; it was ignored.`,
          `Return a finite number for ${name}.`,
          where,
          { joint: name },
        );
      }
    }
    return values;
  }

  #express(actor: ActorState, item: unknown, options: unknown): Span {
    this.#open();
    const where: Where = { row: actor.row, target: actor.id };
    const expression = this.#definition("expression", item, "express", where);
    const keys = knownKeys(expression, options);
    const bag = this.#options(options, [...EXPRESS_OPTIONS, ...keys], "express", where);
    const params =
      expression === undefined ? undefined : this.#resolve(expression, bag, 0, where);
    const values =
      expression === undefined || params === undefined
        ? {}
        : this.#face(expression, params, where);
    const timing = {
      at: bag["at"],
      duration: bag["duration"],
      blend: bag["blend"],
      mode: bag["mode"],
    };
    return this.#recordPose(actor, values, timing, "express", where);
  }

  /** The name and face values of an action's mood, or `undefined`. */
  #mood(
    value: unknown,
    where: Where,
  ): { readonly name: string; readonly values: Record<string, number> } | undefined {
    if (value === undefined) {
      return undefined;
    }
    const expression = this.#definition("expression", value, "do's mood", where);
    if (expression === undefined) {
      return undefined;
    }
    const params = this.#resolve(expression, {}, 0, where);
    return {
      name: expression.name,
      values: params === undefined ? {} : this.#face(expression, params, where),
    };
  }

  #do(actor: ActorState, item: unknown, options: unknown): Span {
    this.#open();
    const where: Where = { row: actor.row, target: actor.id };
    const action = this.#definition("action", item, "do", where);
    const keys = knownKeys(action, options);
    const bag = this.#options(options, [...ACTION_OPTIONS, ...keys], "do", where);
    const duration = this.#seconds(bag["duration"], "do's options.duration", where);
    const blend = this.#seconds(bag["blend"], "do's options.blend", where);
    const mode =
      bag["mode"] === undefined ? undefined : this.#mode(bag["mode"], "do", where);
    const mood = this.#mood(bag["mood"], where);
    const start = this.#startOf(actor, "do", bag["at"], where);
    const params =
      action === undefined ? undefined : this.#resolve(action, bag, start, where);

    const clipState: ActorState = {
      id: actor.id,
      row: actor.row,
      track: actor.track,
      cursor: start,
      open: false,
      // Shared with the actor, so the missing cursor is still reported once per actor.
      warned: actor.warned,
      fullBody: actor.fullBody,
      offset: start,
      defaults: { blend, mode },
    };
    const moodAt = actor.track.segments.length;
    const marks = new Map<string, Micros>();
    if (action !== undefined && params !== undefined) {
      const clip = Object.freeze({
        id: actor.id,
        duration: duration === undefined ? null : toSeconds(duration),
        mood: mood?.name ?? null,
        pose: (channels: unknown, poseOptions?: unknown) =>
          this.#pose(clipState, channels, poseOptions),
        reach: (effector: unknown, target: unknown, reachOptions?: unknown) =>
          this.#reach(clipState, effector, target, reachOptions),
        drive: (motion: unknown, driveOptions?: unknown) =>
          this.#drive(clipState, motion, driveOptions),
        wait: (seconds: unknown) => this.#wait(clipState, seconds),
        mark: (name: unknown, at: unknown) => {
          this.#mark(action, marks, start, name, at, where);
        },
      });
      // The params were resolved from the action's own specification.
      action.build(clip, params as never);
    }

    const natural = clipState.open ? null : clipState.cursor;
    const end = duration === undefined ? natural : start + duration;
    if (end === null || clipState.open) {
      actor.open = true;
    }
    actor.warned ||= clipState.warned;
    // An asked duration is what the action occupies, even when its clip records more.
    actor.cursor = Math.max(
      actor.cursor,
      duration === undefined ? clipState.cursor : (end ?? start),
    );
    this.#latest = Math.max(this.#latest, end ?? 0);
    if (mood !== undefined) {
      // Before the action's own calls, so a face the action sets itself wins.
      actor.track.segments.splice(moodAt, 0, {
        start,
        end,
        data: {
          kind: "pose",
          channels: mood.values,
          mode: "replace",
          anticipation: 0,
          blend: Math.min(
            blend ?? DEFAULT_BLEND_MICROS,
            end === null ? Infinity : end - start,
          ),
          followThrough: 0,
        },
      });
    }
    if (action === undefined || params === undefined) {
      // A call that cannot run still takes its time, so what follows keeps its place.
      actor.track.segments.push({ start, end: end ?? start, data: { kind: "wait" } });
    }
    return spanOf(start, end, this.#marksOf(action, marks, start, end, where));
  }

  #mark(
    action: DefinitionOf<"action">,
    marks: Map<string, Micros>,
    start: Micros,
    name: unknown,
    at: unknown,
    where: Where,
  ): void {
    this.#open();
    if (typeof name !== "string" || !action.marks.includes(name)) {
      this.#report(
        "ERR_SCENE_UNKNOWN_MARK",
        `The action ${action.name} does not state a mark ${typeof name === "string" ? `named ${name}` : "like that"}; it was ignored.`,
        action.marks.length === 0
          ? `List the mark in the action's marks.`
          : `Use one of: ${action.marks.join(", ")}, or list the mark in the action's marks.`,
        where,
        { nearest: typeof name === "string" ? nearestNames(name, action.marks) : [] },
      );
      return;
    }
    const time = this.#seconds(at, `the time of mark ${name}`, where);
    if (time !== undefined) {
      marks.set(name, start + time);
    }
  }

  /** The marks a `do` returns, with a finding for each the action states but did not set. */
  #marksOf(
    action: DefinitionOf<"action"> | undefined,
    marks: ReadonlyMap<string, Micros>,
    start: Micros,
    end: Micros | null,
    where: Where,
  ): Span["marks"] {
    if (action === undefined || action.marks.length === 0) {
      return NO_MARKS;
    }
    const times: Record<string, number> = {};
    for (const name of action.marks) {
      let time = marks.get(name);
      if (time === undefined) {
        time = end ?? start;
        this.#report(
          "ERR_SCENE_MISSING_MARK",
          `The action ${action.name} states a mark ${name} but its build did not set it; the action's ${end === null ? "start" : "end"} was used.`,
          `Call clip.mark("${name}", t) in the action's build.`,
          where,
        );
      }
      times[name] = toSeconds(time);
    }
    return Object.freeze(times);
  }

  /** The handle of a prop; inside an action's `build`, `at` counts from `offset`. */
  #propHandle(prop: PropState, offset: Micros): Prop {
    const handle: Prop = Object.freeze({
      id: prop.id,
      place: (point: unknown, options?: unknown) =>
        this.#placeProp(prop, point, options, offset),
    });
    this.#props.set(handle, prop);
    return handle;
  }

  #placeProp(prop: PropState, point: unknown, options: unknown, offset: Micros): Span {
    this.#open();
    const where: Where = { row: prop.row, target: prop.id };
    const bag = this.#options(options, PLACE_OPTIONS, "place", where);
    const start = (this.#seconds(bag["at"], "place's options.at", where) ?? 0) + offset;
    const target = this.#point(point, "place", where);
    if (target !== undefined) {
      prop.track.segments.push({
        start,
        end: null,
        data: { kind: "place", x: target.x, y: target.y },
      });
    }
    return spanOf(start - offset, null);
  }

  /** Records a prop, backdrop or effect on `row`: its track, and when it is shown. */
  #item(
    row: RowState,
    kind: "prop" | "backdrop" | "effect",
    item: unknown,
    options: unknown,
  ): { readonly track: MutableTrack | undefined; readonly span: Span } {
    const where: Where = { row: row.index };
    const call = ITEM_METHODS[kind];
    const definition = this.#definition(kind, item, call, where);
    const keys = knownKeys(definition, options);
    const bag = this.#options(options, [...ITEM_OPTIONS, ...keys], call, where);
    const start = this.#seconds(bag["at"], `${call}'s options.at`, where) ?? 0;
    const duration = this.#seconds(
      bag["duration"],
      `${call}'s options.duration`,
      where,
    );
    const end = duration === undefined ? null : start + duration;
    const span = spanOf(start, end);
    if (definition === undefined) {
      return { track: undefined, span };
    }
    const track = this.#track(row, kind, definition.name);
    const id = `row${String(row.index)}/${kind}/${definition.name}/${String(track.occurrence)}`;
    const params =
      this.#resolve(definition, bag, 0, { row: row.index, target: id }) ?? {};
    track.segments.push({
      start,
      end,
      data: {
        kind,
        name: definition.name,
        // A built-in named by a string is found again by its name; nothing to keep.
        definition: typeof item === "string" ? null : definition,
        params,
      },
    });
    this.#latest = Math.max(this.#latest, end ?? 0);
    return { track, span };
  }

  #prop(row: RowState, item: unknown, options: unknown): Prop {
    const { track } = this.#item(row, "prop", item, options);
    const name = typeof item === "string" ? item : "prop";
    const placed = track ?? this.#track(row, "prop", name);
    return this.#propHandle(
      {
        id: `row${String(row.index)}/prop/${placed.name}/${String(placed.occurrence)}`,
        row: row.index,
        track: placed,
      },
      0,
    );
  }

  #shown(
    row: RowState,
    kind: "backdrop" | "effect",
    item: unknown,
    options: unknown,
  ): Span {
    return this.#item(row, kind, item, options).span;
  }
}
