import type { Finding, FindingCollector, Severity } from "../check/findings.js";
import { nearestNames } from "../check/nearest.js";
import { SceneClosedError, UnknownRowError } from "../errors.js";
import {
  ANGLE_NAMES,
  CHANNEL_NAMES,
  EFFECTOR_CHAINS,
  EFFECTOR_NAMES,
  type EffectorName,
} from "../rig/rig.js";
import {
  type ActorSegmentData,
  BLEND_MODES,
  type BlendMode,
  DEFAULT_BLEND_MICROS,
  type DrawData,
  type MotionFunction,
} from "../timeline/segments.js";
import { type Micros, toSeconds } from "../timeline/time.js";
import type { Timeline } from "../timeline/timeline.js";
import type { Actor, Row, Span, Stage } from "./handles.js";
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
  readonly data: ActorSegmentData | DrawData;
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
  readonly fullBody: { readonly start: Micros; readonly end: Micros | null }[];
}

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

const SECONDS_FIX = "Pass a finite number of seconds, 0 or more.";

function isMotionFunction(value: unknown): value is MotionFunction {
  return typeof value === "function";
}

function isDrawFunction(value: unknown): value is DrawData["draw"] {
  return typeof value === "function";
}

function isEffectorName(value: unknown): value is EffectorName {
  return EFFECTOR_NAMES.some((name) => name === value);
}

function isBlendMode(value: unknown): value is BlendMode {
  return BLEND_MODES.some((mode) => mode === value);
}

function spanOf(start: Micros, end: Micros | null): Span {
  return Object.freeze({
    start: toSeconds(start),
    end: end === null ? Infinity : toSeconds(end),
    duration: end === null ? Infinity : toSeconds(end - start),
    marks: NO_MARKS,
  });
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
  #latest: Micros = 0;
  #closed = false;

  constructor(settings: StageSettings, findings: FindingCollector) {
    this.#settings = settings;
    this.#findings = findings;
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
    extra: Pick<Finding, "joint" | "nearest" | "time"> & { severity?: Severity } = {},
  ): void {
    this.#findings.add({ code, severity: "error", message, fix, ...where, ...extra });
  }

  #row(index: number): Row {
    this.#open();
    const handle = this.#handles[index];
    if (handle === undefined) {
      throw new UnknownRowError(this.#settings.rows);
    }
    return handle;
  }

  /** Row 0 for a call made on the stage itself, which is only right on a one-row scene. */
  #stageRow(call: "actor" | "draw"): RowState {
    this.#open();
    if (this.#settings.rows > 1) {
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
      fullBody: [],
    };
    this.#actors.push(state);
    return Object.freeze({
      id,
      pose: (channels: unknown, poseOptions?: unknown) =>
        this.#pose(state, channels, poseOptions),
      reach: (effector: unknown, target: unknown, reachOptions?: unknown) =>
        this.#reach(state, effector, target, reachOptions),
      drive: (channels: unknown, driveOptions?: unknown) =>
        this.#drive(state, channels, driveOptions),
      wait: (seconds: unknown) => this.#wait(state, seconds),
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
  #phases(bag: Readonly<Record<string, unknown>>, call: string, where: Where): Phases {
    const seconds = (key: string): Micros | undefined =>
      this.#seconds(bag[key], `${call}'s options.${key}`, where);
    const anticipation = seconds("anticipation") ?? 0;
    const blend = seconds("blend") ?? DEFAULT_BLEND_MICROS;
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

  #mode(value: unknown, call: string, where: Where): BlendMode {
    if (value === undefined) {
      return "replace";
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

  /** The entries of a channel map that name a channel and hold an accepted value. */
  #channels<T>(
    raw: unknown,
    call: string,
    where: Where,
    accept: (value: unknown) => value is T,
    reject: (name: string) => readonly [code: string, message: string, fix: string],
  ): [name: string, value: T][] {
    if (!isRecord(raw)) {
      this.#report(
        "ERR_SCENE_INVALID_VALUE",
        `${call} was not given a map of channels.`,
        `Pass an object keyed by channel name, such as { spine: ... }.`,
        where,
      );
      return [];
    }
    const kept: [string, T][] = [];
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
      } else if (!CHANNEL_NAMES.some((channel) => channel === name)) {
        this.#report(
          "ERR_SCENE_UNKNOWN_CHANNEL",
          `No channel is named ${name}; it was ignored.`,
          `Use a channel name: ${CHANNEL_NAMES.join(", ")}.`,
          where,
          { joint: name, nearest: nearestNames(name, CHANNEL_NAMES) },
        );
      } else if (accept(value)) {
        kept.push([name, value]);
      } else {
        const [code, message, fix] = reject(name);
        this.#report(code, message, fix, where, { joint: name });
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
    const given = this.#seconds(at, `${call}'s options.at`, where);
    if (given === undefined && actor.open) {
      this.#report(
        "ERR_SCENE_NO_CURSOR",
        `${call} has no time to start at: an open-ended call was recorded on this actor before it, and that never ends.`,
        `Pass { at } to ${call}, or give the open-ended call a duration.`,
        where,
        { time: [toSeconds(actor.cursor), toSeconds(actor.cursor)] },
      );
    }
    const start = given ?? actor.cursor;
    const end = duration === null ? null : start + duration;
    if (end === null) {
      actor.open = true;
    }
    actor.cursor = Math.max(actor.cursor, end ?? start);
    this.#latest = Math.max(this.#latest, end ?? 0);
    return { start, end };
  }

  #pose(actor: ActorState, channels: unknown, options: unknown): Span {
    this.#open();
    const where: Where = { row: actor.row, target: actor.id };
    const bag = this.#options(options, POSE_OPTIONS, "pose", where);
    const kept = this.#channels(
      channels,
      "pose",
      where,
      (value): value is number => typeof value === "number" && Number.isFinite(value),
      (name) => [
        "ERR_SCENE_OUT_OF_RANGE",
        `The value of ${name} is not a finite number; it was ignored.`,
        `Give ${name} a finite number.`,
      ],
    );
    const { duration, ...phases } = this.#phases(bag, "pose", where);
    const mode = this.#mode(bag["mode"], "pose", where);
    const { start, end } = this.#place(actor, "pose", bag["at"], duration, where);
    // `+ 0` stores a `-0` as `0`, as the timeline's JSON form does.
    const values = Object.fromEntries(kept.map(([name, value]) => [name, value + 0]));
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
    return spanOf(start, end);
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
    const { duration, ...phases } = this.#phases(bag, "reach", where);
    const { start, end } = this.#place(actor, "reach", bag["at"], duration, where);
    const point = this.#point(target, where);
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
    return spanOf(start, end);
  }

  #point(
    target: unknown,
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
      "The target of reach is not a point with finite x and y; the call was recorded as a wait.",
      "Pass { x, y } in row units: the origin is on the ground at the row's centre, y up.",
      where,
    );
    return undefined;
  }

  #drive(actor: ActorState, channels: unknown, options: unknown): Span {
    this.#open();
    const where: Where = { row: actor.row, target: actor.id };
    const bag = this.#options(options, DRIVE_OPTIONS, "drive", where);
    const kept = this.#channels(channels, "drive", where, isMotionFunction, (name) => [
      "ERR_SCENE_INVALID_VALUE",
      `The value of ${name} is not a function; it was ignored.`,
      `Give ${name} a function of time, such as (t) => Math.sin(t * 3) * 0.1. A fixed value belongs in pose.`,
    ]);
    const duration =
      this.#seconds(bag["duration"], "drive's options.duration", where) ?? null;
    const blend = Math.min(
      this.#seconds(bag["blend"], "drive's options.blend", where) ??
        DEFAULT_BLEND_MICROS,
      duration ?? Infinity,
    );
    const mode = this.#mode(bag["mode"], "drive", where);
    const { start, end } = this.#place(actor, "drive", bag["at"], duration, where);
    actor.track.segments.push({
      start,
      end,
      data: { kind: "drive", channels: Object.fromEntries(kept), mode, blend },
    });
    return spanOf(start, end);
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
    return spanOf(start, end);
  }
}
