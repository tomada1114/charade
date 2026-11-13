import { type Finding, FindingCollector } from "../check/findings.js";
import { nearestNames } from "../check/nearest.js";
import { AsyncBuildError } from "../errors.js";
import { DEFAULT_SEED } from "../timeline/random.js";
import { DEFAULT_FPS, type Micros } from "../timeline/time.js";
import { computeDuration, type Timeline } from "../timeline/timeline.js";
import { SceneBuilder } from "./builder.js";
import type { Stage } from "./handles.js";
import { deepFreeze, isRecord, microsOf } from "./values.js";

/**
 * What is known about a scene before its first call.
 *
 * @public
 */
export interface SceneOptions {
  /** Canvas width in pixels. Defaults to 1080. */
  readonly width?: number;
  /** Canvas height in pixels. Defaults to 1080. */
  readonly height?: number;
  /** Frames per second, a positive whole number. Defaults to 30. */
  readonly fps?: number;
  /** How many rows the canvas is split into, 1 to 4. Defaults to 1. */
  readonly rows?: number;
  /** Seed of the scene's random source, a whole number. Defaults to 0. */
  readonly seed?: number;
  /** The font family for the scene's text. Defaults to a system font. */
  readonly font?: string;
  /**
   * The scene's length in seconds. Defaults to the end of the last call that has
   * one.
   */
  readonly duration?: number;
}

/**
 * A built scene: what a scene file exports as its default.
 *
 * @remarks
 * It is deep-frozen data, not a function, so checking and rendering read the same
 * run of the scene's code. `kind` and `version` identify the shape.
 *
 * @public
 */
export interface Scene {
  /** Marks the value as a charade scene. */
  readonly kind: "charade.scene";
  /** Version of this object's shape. */
  readonly version: 1;
  /** Canvas width in pixels. */
  readonly width: number;
  /** Canvas height in pixels. */
  readonly height: number;
  /** The font family the scene named, or `null` for a system font. */
  readonly font: string | null;
  /** Every recorded call. The frame rate, seed and rows are in here. */
  readonly timeline: Timeline;
  /** The problems found while the scene's code ran, in the order they were found. */
  readonly findings: readonly Finding[];
  /** Whether findings past the cap were dropped. */
  readonly truncated: boolean;
}

const DEFAULT_SIZE = 1080;
const MAX_ROWS = 4;
const OPTION_NAMES = ["width", "height", "fps", "rows", "seed", "font", "duration"];

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

interface Settings {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly rows: number;
  readonly seed: number;
  readonly font: string | null;
  readonly duration: Micros | null;
}

/**
 * The scene's settings. A bad option is a finding and its default is used, so the
 * rest of the scene is still checked.
 */
function resolveOptions(raw: unknown, findings: FindingCollector): Settings {
  let bag: Readonly<Record<string, unknown>> = {};
  if (isRecord(raw)) {
    bag = raw;
  } else if (raw !== undefined) {
    findings.add({
      code: "ERR_SCENE_INVALID_VALUE",
      severity: "error",
      message: "The options of scene are not an object; the defaults were used.",
      fix: `Pass an object with any of: ${OPTION_NAMES.join(", ")}.`,
    });
  }
  for (const key of Object.keys(bag)) {
    if (!OPTION_NAMES.includes(key)) {
      findings.add({
        code: "ERR_SCENE_UNKNOWN_OPTION",
        severity: "error",
        message: `scene has no option named ${key}; it was ignored.`,
        fix: `Use one of: ${OPTION_NAMES.join(", ")}.`,
        nearest: nearestNames(key, OPTION_NAMES),
      });
    }
  }
  const outOfRange = (name: string, expected: string, used: string): void => {
    findings.add({
      code: "ERR_SCENE_OUT_OF_RANGE",
      severity: "error",
      message: `The scene option ${name} is not ${expected}; ${used} was used.`,
      fix: `Set ${name} to ${expected}, or leave it out.`,
    });
  };
  const positive = (name: string, fallback: number): number => {
    const value = bag[name];
    if (value === undefined || isPositiveInteger(value)) {
      return value ?? fallback;
    }
    outOfRange(name, "a positive whole number", String(fallback));
    return fallback;
  };

  let rows = 1;
  if (isPositiveInteger(bag["rows"])) {
    rows = Math.min(bag["rows"], MAX_ROWS);
  }
  if (bag["rows"] !== undefined && bag["rows"] !== rows) {
    outOfRange("rows", "a whole number from 1 to 4", String(rows));
  }

  let seed = DEFAULT_SEED;
  if (typeof bag["seed"] === "number" && Number.isSafeInteger(bag["seed"])) {
    // `+ 0` stores a `-0` as `0`.
    seed = bag["seed"] + 0;
  } else if (bag["seed"] !== undefined) {
    outOfRange("seed", "a whole number", String(DEFAULT_SEED));
  }

  let font: string | null = null;
  if (typeof bag["font"] === "string" && bag["font"] !== "") {
    font = bag["font"];
  } else if (bag["font"] !== undefined) {
    findings.add({
      code: "ERR_SCENE_INVALID_VALUE",
      severity: "error",
      message:
        "The scene option font is not a non-empty string; a system font was used.",
      fix: "Set font to a font family name, or leave it out.",
    });
  }

  const duration = microsOf(bag["duration"]) ?? null;
  if (bag["duration"] !== undefined && duration === null) {
    outOfRange("duration", "a finite number of seconds, 0 or more", "the computed one");
  }

  return {
    width: positive("width", DEFAULT_SIZE),
    height: positive("height", DEFAULT_SIZE),
    fps: positive("fps", DEFAULT_FPS),
    rows,
    seed,
    font,
    duration,
  };
}

function isBuild(value: unknown): value is (stage: Stage) => unknown {
  return typeof value === "function";
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

/** Records the finding of a scene that has no length, or one too long to count frames of. */
function checkDuration(timeline: Timeline, findings: FindingCollector): void {
  try {
    if (computeDuration(timeline).ok) {
      return;
    }
  } catch {
    findings.add({
      code: "ERR_SCENE_OUT_OF_RANGE",
      severity: "error",
      message: "The scene is too long for its frames to be counted.",
      fix: "Shorten the scene: check the largest at, duration and wait values.",
    });
    return;
  }
  findings.add({
    code: "ERR_SCENE_NO_DURATION",
    severity: "error",
    message:
      "The scene has no length: no call in it has an end, and no duration is set.",
    fix: "Give a call a duration, or set the duration option of scene().",
  });
}

/**
 * Build a scene: run `build` once and return what it recorded.
 *
 * @remarks
 * `build` runs synchronously inside this call. Its calls on the stage, the rows and
 * the actors draw nothing; each records when something happens, and the engine later
 * draws frame `n` from that record alone.
 *
 * A mistake that leaves a way to continue (an unknown name, a bad value) is recorded
 * in `findings` and a placeholder is used, so one run reports every mistake.
 *
 * @param build - Records the scene on the stage it is given.
 * @returns The scene as frozen data, to be the file's default export.
 * @throws `AsyncBuildError` when `build` returns a promise.
 * @throws `UnknownRowError` when `build` names a row the scene does not have.
 *
 * @example
 * ```ts
 * const waving = scene((stage) => {
 *   const hero = stage.actor();
 *   const up = hero.pose({ shoulderR: 2.6, elbowR: 0.4 }, { duration: 0.5 });
 *   hero.pose({ elbowR: 1.2 }, { duration: 0.3 });
 *   hero.pose({ elbowR: 0.4 }, { duration: 0.3 });
 *   hero.drive({ spine: (t) => Math.sin(t * 3) * 0.05 }, { at: up.end, duration: 0.6 });
 * });
 * console.log(waving.kind, waving.findings.length);
 * // => "charade.scene" 0
 * ```
 *
 * @public
 */
export function scene(build: (stage: Stage) => void): Scene;
/**
 * Build a scene with options.
 *
 * @param options - The canvas, the frame rate, the row count and the seed.
 * @param build - Records the scene on the stage it is given.
 * @returns The scene as frozen data, to be the file's default export.
 *
 * @public
 */
export function scene(options: SceneOptions, build: (stage: Stage) => void): Scene;
export function scene(first: unknown, second?: unknown): Scene {
  const [options, build] =
    typeof first === "function" && second === undefined
      ? [undefined, first]
      : [first, second];
  const findings = new FindingCollector();
  const settings = resolveOptions(options, findings);
  const builder = new SceneBuilder(settings, findings);
  let returned: unknown;
  if (isBuild(build)) {
    try {
      returned = build(builder.stage);
    } finally {
      builder.close();
    }
  } else {
    builder.close();
    findings.add({
      code: "ERR_SCENE_INVALID_VALUE",
      severity: "error",
      message: "scene was not given a build function; the scene is empty.",
      fix: "Call scene((stage) => { ... }) or scene(options, (stage) => { ... }).",
    });
  }
  if (isThenable(returned)) {
    // The rejected build goes on running; what it throws after this is already answered.
    void Promise.resolve(returned).catch(() => undefined);
    throw new AsyncBuildError();
  }
  const timeline = builder.timeline();
  checkDuration(timeline, findings);
  const built: Scene = {
    kind: "charade.scene",
    version: 1,
    width: settings.width,
    height: settings.height,
    font: settings.font,
    timeline,
    findings: findings.findings,
    truncated: findings.truncated,
  };
  return deepFreeze(built);
}
