#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

import {
  type CheckOptions,
  type CheckResult,
  checkScene,
  formatFinding,
  formatReport,
  lastFrameOf,
} from "./check/check.js";
import {
  builtinDefinitions,
  catalogItem,
  describeRig,
  formatCatalog,
  sampleFrames,
  sampleImageName,
  sampleScene,
  selectItems,
} from "./check/catalog.js";
import { describeState, formatState, type StateDescription } from "./check/describe.js";
import {
  type CheckReport,
  checkReport,
  COULD_NOT_RUN,
  type ExitCode,
  exitCodeFor,
} from "./check/findings.js";
import {
  type AbortedBuild,
  installReadWatch,
  takeAbortedBuild,
} from "./check/reads.js";
import {
  findActor,
  GHOSTS,
  MAX_SHEET_FRAMES,
  SHEET_CELLS,
  spreadFrames,
} from "./check/sheet.js";
import { textFont } from "./draw/text.js";
import { CharadeError, UnknownFlagError } from "./errors.js";
import { chooseFont, hasText } from "./export/fonts.js";
import {
  type FileWriter,
  type FolderMaker,
  type ImageEnvironment,
  type ImageOutput,
  makeFolder,
  outputBeside,
  writeFrameImage,
  writeGhostImage,
  writeOutput,
  writeSheetImage,
} from "./export/images.js";
import {
  loadDefinitions,
  loadScene,
  SceneFailedError,
  SceneLoadError,
} from "./export/loader.js";
import { createRasteriser, type Rasteriser } from "./export/raster.js";
import {
  assertEvenSize,
  findEncoder,
  type Interrupts,
  processInterrupts,
  type Spawn,
  spawnProcess,
  type VideoEnvironment,
  videoBeside,
  writeVideo,
} from "./export/video.js";
import { watchGlobals } from "./export/watch.js";
import type { Definition } from "./scene/define.js";
import type { Scene } from "./scene/scene.js";

const NAME = "charade";

export interface CliResult {
  exitCode: ExitCode;
  stdout: string;
  stderr: string;
}

/** A failure the CLI reports: a stable code, what went wrong, and how to fix it. */
interface Reportable {
  readonly code: string;
  readonly message: string;
  readonly fix: string;
  /** The valid names nearest to an unknown one, when the failure is an unknown name. */
  readonly nearest?: readonly string[];
}

abstract class UsageError extends CharadeError {
  abstract readonly fix: string;
}

/** No command was given. */
class NoCommandError extends UsageError {
  readonly code = "ERR_CLI_NO_COMMAND" as const;
  readonly fix = `Name a command: ${NAME} check scene.ts. Run ${NAME} --help for the list.`;

  constructor() {
    super("No command was given.");
  }
}

/** The first argument is not a command. */
class UnknownCommandError extends UsageError {
  readonly code = "ERR_CLI_UNKNOWN_COMMAND" as const;
  readonly fix = `Use one of render, check, frame, sheet, catalog. Run ${NAME} --help for the list.`;

  /** The command name as given. */
  readonly command: string;

  constructor(command: string) {
    super(`Unknown command ${command}.`);
    this.command = command;
  }
}

/** A flag that takes a value was given none. */
class MissingValueError extends UsageError {
  readonly code = "ERR_CLI_MISSING_VALUE" as const;
  readonly fix: string;

  /** The dotted path of the flag, such as `frame.at`. */
  readonly path: string;

  constructor(path: string, help: string) {
    super(`Flag ${path} needs a value.`);
    this.path = path;
    this.fix = `Give it a value, as in --${lastSegment(path)} <value>. Run ${help} for usage.`;
  }
}

/** A flag that takes no value was given one. */
class UnexpectedValueError extends UsageError {
  readonly code = "ERR_CLI_UNEXPECTED_VALUE" as const;
  readonly fix: string;

  /** The dotted path of the flag, such as `check.json`. */
  readonly path: string;

  constructor(path: string, help: string) {
    super(`Flag ${path} takes no value.`);
    this.path = path;
    this.fix = `Write --${lastSegment(path)} on its own. Run ${help} for usage.`;
  }
}

/** A positional argument the command does not take. */
class UnexpectedArgumentError extends UsageError {
  readonly code = "ERR_CLI_UNEXPECTED_ARGUMENT" as const;
  readonly fix: string;

  /** The command that was given it, or `undefined` before a command. */
  readonly command: string | undefined;

  constructor(command: string | undefined, help: string) {
    super(
      command === undefined
        ? "The command must come first."
        : `${command} takes fewer arguments.`,
    );
    this.command = command;
    this.fix = `Run ${help} for usage.`;
  }
}

/** A command that needs a scene file was given none. */
class MissingSceneError extends UsageError {
  readonly code = "ERR_CLI_MISSING_SCENE" as const;
  readonly fix: string;

  /** The command. */
  readonly command: string;

  constructor(command: string) {
    super(`${command} needs a scene file.`);
    this.command = command;
    this.fix =
      `Name the scene file: ${NAME} ${command} scene.ts.` +
      (command === "check"
        ? ` To check the samples of your own definitions, name their module: ${NAME} check --defs items.ts.`
        : "");
  }
}

/** The name given to `catalog` is no item's. */
class UnknownItemError extends UsageError {
  readonly code = "ERR_CLI_UNKNOWN_ITEM" as const;
  readonly fix: string;

  /** The nearest items, each as `<kind>.<name>`, closest first. */
  readonly nearest: readonly string[];

  constructor(nearest: readonly string[], defs: string | undefined) {
    super("catalog was given a name that is no item's.");
    this.nearest = nearest;
    const all = `${NAME} catalog${defs === undefined ? "" : ` --defs ${defs}`}`;
    this.fix =
      nearest.length === 0
        ? `Run ${all} for the names.`
        : `Did you mean ${nearest.join(", ")}? Run ${all} for every name.`;
  }
}

/** A required flag is absent. */
class MissingFlagError extends UsageError {
  readonly code = "ERR_CLI_MISSING_FLAG" as const;
  readonly fix: string;

  /** The dotted path of the flag, such as `frame.at`. */
  readonly path: string;

  constructor(path: string, example: string) {
    super(`Flag ${path} is required.`);
    this.path = path;
    this.fix = `Add it, as in ${example}.`;
  }
}

/** An `--at` value that is neither seconds nor a frame. */
export class InvalidAtError extends UsageError {
  readonly code = "ERR_CLI_INVALID_AT" as const;
  readonly fix =
    "Give seconds (1.5 or 1.5s) or a frame number (45f): digits only, no sign or exponent.";

  /** The dotted path of the flag, such as `frame.at`. */
  readonly path: string;

  constructor(path: string) {
    super(`Flag ${path} is not a time or a frame.`);
    this.path = path;
  }
}

/** An `--at` value names a frame after the scene's last one. */
class AtPastEndError extends UsageError {
  readonly code = "ERR_CLI_AT_PAST_END" as const;
  readonly fix: string;

  /** The dotted path of the flag, such as `check.at`. */
  readonly path: string;
  /** The scene's last frame. */
  readonly lastFrame: number;

  constructor(path: string, lastFrame: number, fps: number) {
    super(`Flag ${path} is past the end of the scene.`);
    this.path = path;
    this.lastFrame = lastFrame;
    this.fix = `Give a time up to ${String(lastFrame / fps)} s, or a frame up to ${String(lastFrame)}f.`;
  }
}

/** Two flags that cannot be given together. */
class ConflictingFlagsError extends UsageError {
  readonly code = "ERR_CLI_CONFLICTING_FLAGS" as const;
  readonly fix: string;

  /** The dotted path of the flag that was rejected, such as `sheet.times`. */
  readonly path: string;
  /** The dotted path of the flag it cannot be combined with. */
  readonly other: string;

  constructor(path: string, other: string, fix: string) {
    super(`Flags ${path} and ${other} cannot be combined.`);
    this.path = path;
    this.other = other;
    this.fix = fix;
  }
}

/** `--times` names more frames than one image can show. */
class TooManyTimesError extends UsageError {
  readonly code = "ERR_CLI_TOO_MANY_TIMES" as const;
  readonly fix = `Name at most ${String(MAX_SHEET_FRAMES)} times, or write a second sheet with -o for the rest.`;

  /** The most times one image takes. */
  readonly limit = MAX_SHEET_FRAMES;

  constructor() {
    super("Flag sheet.times names too many times for one image.");
  }
}

/** `--row` is not a row of the scene. */
class InvalidRowError extends UsageError {
  readonly code = "ERR_CLI_INVALID_ROW" as const;
  readonly fix: string;

  /** How many rows the scene has, when the scene was loaded. */
  readonly rows: number | undefined;

  constructor(rows: number | undefined) {
    super("Flag sheet.row is not a row of the scene.");
    this.rows = rows;
    this.fix =
      rows === undefined
        ? "Give a row index in digits; row 0 is the top."
        : `Give a row index from 0 to ${String(rows - 1)}; row 0 is the top.`;
  }
}

/** `--from` names a frame after `--to`. */
class InvalidRangeError extends UsageError {
  readonly code = "ERR_CLI_INVALID_RANGE" as const;
  readonly fix = "Give --from a time at or before --to.";

  constructor() {
    super("Flag sheet.from is after sheet.to.");
  }
}

/** `--ghost` names no actor, or a name more than one actor has. */
class UnknownActorError extends UsageError {
  readonly code = "ERR_CLI_UNKNOWN_ACTOR" as const;
  readonly fix: string;

  /** The ids of the scene's actors. */
  readonly actors: readonly string[];

  constructor(actors: readonly string[]) {
    super("Flag sheet.ghost does not name one actor of the scene.");
    this.actors = actors;
    this.fix =
      actors.length === 0
        ? "The scene has no actor to draw as ghosts."
        : `Give an actor's id, or its name when only one actor has it: ${actors.join(", ")}.`;
  }
}

/** The scene has no countable length, so there are no frames to spread a sheet over. */
class NoLengthError extends UsageError {
  readonly code = "ERR_CLI_NO_LENGTH" as const;
  readonly fix =
    "Give the scene a duration, or name the frames to draw with --times, as in --times 0,1.5,45f.";

  constructor() {
    super("The scene has no length to pick frames from.");
  }
}

function lastSegment(dotted: string): string {
  return dotted.slice(dotted.lastIndexOf(".") + 1);
}

/** A point in a scene, as `--at` gives it. */
export type At =
  | { readonly unit: "seconds"; readonly value: number }
  | { readonly unit: "frame"; readonly value: number };

const SECONDS = /^\d+(?:\.\d+)?s?$/;
const FRAME = /^\d+f$/;

/**
 * Parse an `--at` value: `1.5` and `1.5s` are seconds, `45f` is a frame.
 *
 * @param text The value as given.
 * @param flagPath The flag's dotted path, carried by the error.
 * @throws InvalidAtError for anything else, including a sign, an exponent or
 * non-ASCII digits.
 */
export function parseAt(text: string, flagPath: string): At {
  if (SECONDS.test(text)) {
    const value = Number(text.endsWith("s") ? text.slice(0, -1) : text);
    if (Number.isFinite(value)) {
      return { unit: "seconds", value };
    }
  } else if (FRAME.test(text)) {
    const value = Number(text.slice(0, -1));
    if (Number.isSafeInteger(value)) {
      return { unit: "frame", value };
    }
  }
  throw new InvalidAtError(flagPath);
}

/** A command name. */
export type CommandName = "render" | "check" | "frame" | "sheet" | "catalog";

/** One parsed invocation of a command. */
export type Invocation =
  | {
      readonly command: "render";
      readonly scene: string;
      readonly out: string | undefined;
      readonly json: boolean;
    }
  | {
      readonly command: "check";
      readonly scene: string;
      readonly strict: boolean;
      readonly at: At | undefined;
      readonly json: boolean;
    }
  | {
      readonly command: "frame";
      readonly scene: string;
      readonly at: At;
      readonly out: string | undefined;
      readonly json: boolean;
    }
  | {
      readonly command: "sheet";
      readonly scene: string;
      readonly out: string | undefined;
      readonly ghost: string | undefined;
      readonly times: readonly At[] | undefined;
      readonly from: At | undefined;
      readonly to: At | undefined;
      readonly row: number | undefined;
      readonly json: boolean;
    }
  | {
      /** `check --defs`: the samples of a definitions module, not a scene. */
      readonly command: "check-samples";
      readonly defs: string;
      readonly strict: boolean;
      readonly json: boolean;
    }
  | {
      readonly command: "catalog";
      /** The item to show, as its name or `<kind>.<name>`. */
      readonly name: string | undefined;
      /** A module of the user's definitions to list in place of the built-ins. */
      readonly defs: string | undefined;
      /** The folder sample images go to, empty for the default; `undefined` for none. */
      readonly images: string | undefined;
      readonly json: boolean;
    };

/** A scene command's invocation. */
export type SceneInvocation = Exclude<
  Invocation,
  { readonly command: "catalog" | "check-samples" }
>;

/** The invocation of a command that reads definitions instead of a scene. */
export type VocabularyInvocation = Exclude<Invocation, SceneInvocation>;

interface CommandSpec {
  readonly synopsis: string;
  readonly summary: string;
  readonly options: ParseArgsOptionsConfig;
  readonly help: readonly (readonly [flag: string, text: string])[];
}

const COMMON_OPTIONS = {
  help: { type: "boolean", short: "h" },
  json: { type: "boolean" },
} as const satisfies ParseArgsOptionsConfig;

const COMMON_HELP = [
  ["--json", "Print exactly one JSON document on stdout, also on failure."],
  ["-h, --help", "Show this help."],
] as const;

const OUT_OPTION = { out: { type: "string", short: "o" } } as const;

const DEFS_OPTION = { defs: { type: "string" } } as const;

/** Where `catalog --images` writes when the flag names no folder. */
export const CATALOG_IMAGES = "charade-catalog";

const COMMANDS: Readonly<Record<CommandName, CommandSpec>> = {
  render: {
    synopsis: "render <scene.ts> [options]",
    summary: "Write the scene as an MP4 video (H.264, yuv420p). Needs ffmpeg.",
    options: { ...COMMON_OPTIONS, ...OUT_OPTION },
    help: [
      ["-o, --out <path>", "Where to write the video; next to the scene by default."],
    ],
  },
  check: {
    synopsis: "check <scene.ts> [options]",
    summary: "Report the scene's problems, each with how to fix it.",
    options: {
      ...COMMON_OPTIONS,
      ...DEFS_OPTION,
      strict: { type: "boolean" },
      at: { type: "string" },
    },
    help: [
      ["--strict", "Fail on warnings too."],
      ["--at <time>", "Also describe the state at a time: 1.5, 1.5s or 45f."],
      [
        "--defs <module>",
        "In place of a scene, check the sample of every definition the module exports.",
      ],
    ],
  },
  frame: {
    synopsis: "frame <scene.ts> --at <time> [options]",
    summary: "Write one frame as a PNG.",
    options: { ...COMMON_OPTIONS, ...OUT_OPTION, at: { type: "string" } },
    help: [
      ["--at <time>", "Required. Seconds (1.5 or 1.5s) or a frame (45f)."],
      ["-o, --out <path>", "Where to write the PNG; next to the scene by default."],
    ],
  },
  sheet: {
    synopsis: "sheet <scene.ts> [options]",
    summary: "Write a contact sheet PNG of frames across the scene.",
    options: {
      ...COMMON_OPTIONS,
      ...OUT_OPTION,
      ghost: { type: "string" },
      times: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      row: { type: "string" },
    },
    help: [
      ["--times <list>", "Draw these frames instead of twelve: 0,1.5,45f."],
      ["--from <time>", "Spread the frames from this time on: 1.5, 1.5s or 45f."],
      ["--to <time>", "Spread the frames up to this time."],
      ["--row <index>", "Draw one row of the scene alone; row 0 is the top."],
      [
        "--ghost <actor>",
        "Overlay one actor's motion on a single image instead: its id or name.",
      ],
      ["-o, --out <path>", "Where to write the PNG; next to the scene by default."],
    ],
  },
  catalog: {
    synopsis: "catalog [name] [options]",
    summary: "List the installed vocabulary and the rig, for an agent to read.",
    options: { ...COMMON_OPTIONS, ...DEFS_OPTION, images: { type: "string" } },
    help: [
      [
        "[name]",
        "Show that item alone: sitDown, or prop.ball when two kinds share the name.",
      ],
      [
        "--images [dir]",
        `Also write a sample image of each item listed, into dir (${CATALOG_IMAGES}/ by default). Put the name before this flag.`,
      ],
      [
        "--defs <module>",
        "List the definitions the module exports in place of the built-ins.",
      ],
    ],
  },
};

function isCommand(name: string): name is CommandName {
  return Object.hasOwn(COMMANDS, name);
}

function table(rows: readonly (readonly [string, string])[]): string {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}\n`).join("");
}

// Looked up for a load error no build threw, so no build's kept findings can match it.
const NO_BUILD = Symbol("no build");

const EXIT_CODES = "Exit codes: 0 success, 1 error findings, 2 could not run.\n";

/** The top-level usage text. */
export function usage(): string {
  const commands = (Object.keys(COMMANDS) as CommandName[]).map(
    (name) =>
      [
        COMMANDS[name].synopsis.replace(" [options]", ""),
        COMMANDS[name].summary,
      ] as const,
  );
  return (
    `Usage: ${NAME} <command> [options]\n\n` +
    `Commands:\n${table(commands)}\n` +
    `Options:\n${table(COMMON_HELP)}\n` +
    `Run ${NAME} <command> --help for a command's options.\n` +
    EXIT_CODES
  );
}

/** One command's usage text. */
export function commandUsage(command: CommandName): string {
  const spec = COMMANDS[command];
  return (
    `Usage: ${NAME} ${spec.synopsis}\n\n${spec.summary}\n\n` +
    `Options:\n${table([...spec.help, ...COMMON_HELP])}\n` +
    EXIT_CODES
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

/**
 * Turn a strict `parseArgs` failure into a usage error. The flag's name comes from a
 * second, lenient pass over the tokens, never from the message.
 */
function usageErrorFrom(
  error: unknown,
  args: readonly string[],
  options: ParseArgsOptionsConfig,
  command: CommandName | undefined,
): Reportable {
  const help = command === undefined ? `${NAME} --help` : `${NAME} ${command} --help`;
  const dotted = (name: string): string =>
    command === undefined ? name : `${command}.${name}`;
  const { tokens } = parseArgs({
    args: [...args],
    options,
    strict: false,
    allowPositionals: true,
    tokens: true,
  });
  const code = errorCode(error);
  for (const token of tokens) {
    if (token.kind !== "option") {
      continue;
    }
    const known = Object.hasOwn(options, token.name) ? options[token.name] : undefined;
    if (known === undefined) {
      if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
        const unknown = new UnknownFlagError(dotted(token.name));
        return {
          code: unknown.code,
          message: unknown.message,
          fix: `Run ${help} for the flags it takes.`,
        };
      }
    } else if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
      if (known.type === "boolean" && token.inlineValue === true) {
        return new UnexpectedValueError(dotted(token.name), help);
      }
      if (
        known.type === "string" &&
        (token.value === undefined || token.value.startsWith("-"))
      ) {
        return new MissingValueError(dotted(token.name), help);
      }
    }
  }
  return new UnexpectedArgumentError(command, help);
}

/** What parsing argv produced: an invocation, a help text, or a usage error. */
type Parsed =
  | { readonly kind: "run"; readonly invocation: Invocation }
  | { readonly kind: "help"; readonly text: string }
  | { readonly kind: "error"; readonly error: Reportable };

/**
 * `--images` may stand alone, which `parseArgs` has no spelling for: one with no
 * value after it is rewritten to `--images=`, the empty folder name being the default.
 */
function withOptionalImages(args: readonly string[]): string[] {
  const end = args.indexOf("--");
  return args.map((arg, index) => {
    const next = args[index + 1];
    return arg === "--images" &&
      (end === -1 || index < end) &&
      (next === undefined || next.startsWith("-"))
      ? "--images="
      : arg;
  });
}

function parseCommand(command: CommandName, given: readonly string[]): Parsed {
  const spec = COMMANDS[command];
  const args = command === "catalog" ? withOptionalImages(given) : given;
  let values: Record<string, string | boolean | (string | boolean)[] | undefined>;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...args],
      options: spec.options,
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    return { kind: "error", error: usageErrorFrom(error, args, spec.options, command) };
  }
  if (values["help"] === true) {
    return { kind: "help", text: commandUsage(command) };
  }
  const json = values["json"] === true;
  const text = (name: string): string | undefined => {
    const value = values[name];
    return typeof value === "string" ? value : undefined;
  };
  const fail = (error: Reportable): Parsed => ({ kind: "error", error });
  const help = `${NAME} ${command} --help`;

  if (command === "catalog") {
    if (positionals.length > 1) {
      return fail(new UnexpectedArgumentError(command, help));
    }
    return {
      kind: "run",
      invocation: {
        command,
        name: positionals[0],
        defs: text("defs"),
        images: text("images"),
        json,
      },
    };
  }
  const [scene, ...extra] = positionals;
  const defs = command === "check" ? text("defs") : undefined;
  if (defs !== undefined) {
    if (scene !== undefined) {
      return fail(new UnexpectedArgumentError(command, help));
    }
    if (values["at"] !== undefined) {
      return fail(
        new ConflictingFlagsError(
          "check.at",
          "check.defs",
          "Leave --at out: a module's samples are several scenes, with no one time line.",
        ),
      );
    }
    return {
      kind: "run",
      invocation: {
        command: "check-samples",
        defs,
        strict: values["strict"] === true,
        json,
      },
    };
  }
  if (scene === undefined) {
    return fail(new MissingSceneError(command));
  }
  if (extra.length > 0) {
    return fail(new UnexpectedArgumentError(command, help));
  }
  const time = (name: string): At | undefined => {
    const given = text(name);
    return given === undefined ? undefined : parseAt(given, `${command}.${name}`);
  };
  try {
    return parseSceneCommand(command, scene, json, text, time, values);
  } catch (error) {
    if (error instanceof UsageError) {
      return fail(error);
    }
    throw error;
  }
}

const ROW = /^\d+$/;

/** @throws UsageError for a flag value that cannot be read. */
function parseSceneCommand(
  command: Exclude<CommandName, "catalog">,
  scene: string,
  json: boolean,
  text: (name: string) => string | undefined,
  time: (name: string) => At | undefined,
  values: Readonly<Record<string, unknown>>,
): Parsed {
  const fail = (error: Reportable): Parsed => ({ kind: "error", error });
  const at = time("at");
  switch (command) {
    case "render":
      return { kind: "run", invocation: { command, scene, out: text("out"), json } };
    case "check":
      return {
        kind: "run",
        invocation: { command, scene, strict: values["strict"] === true, at, json },
      };
    case "frame":
      if (at === undefined) {
        return fail(
          new MissingFlagError("frame.at", `${NAME} frame scene.ts --at 1.5`),
        );
      }
      return {
        kind: "run",
        invocation: { command, scene, at, out: text("out"), json },
      };
    case "sheet": {
      const ghost = text("ghost");
      const from = time("from");
      const to = time("to");
      const times = text("times")
        ?.split(",")
        .map((entry) => parseAt(entry.trim(), "sheet.times"));
      const rowText = text("row");
      const row = rowText === undefined ? undefined : Number(rowText);
      if (rowText !== undefined && !(ROW.test(rowText) && Number.isSafeInteger(row))) {
        throw new InvalidRowError(undefined);
      }
      if (times !== undefined && (from ?? to) !== undefined) {
        throw new ConflictingFlagsError(
          "sheet.times",
          from === undefined ? "sheet.to" : "sheet.from",
          "Name the frames with --times, or spread them with --from and --to, not both.",
        );
      }
      if (ghost !== undefined && row !== undefined) {
        throw new ConflictingFlagsError(
          "sheet.row",
          "sheet.ghost",
          "Leave --row out: a ghost image always shows the actor's own row.",
        );
      }
      if (times !== undefined && times.length > MAX_SHEET_FRAMES) {
        throw new TooManyTimesError();
      }
      return {
        kind: "run",
        invocation: {
          command,
          scene,
          out: text("out"),
          ghost,
          times,
          from,
          to,
          row,
          json,
        },
      };
    }
  }
}

/** Parse argv into what to run. */
function parse(argv: readonly string[]): Parsed {
  const [first, ...rest] = argv;
  if (first !== undefined && isCommand(first)) {
    return parseCommand(first, rest);
  }
  if (first !== undefined && !first.startsWith("-")) {
    return { kind: "error", error: new UnknownCommandError(first) };
  }
  let help: boolean | undefined;
  try {
    ({
      values: { help },
    } = parseArgs({
      args: [...argv],
      options: COMMON_OPTIONS,
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return {
      kind: "error",
      error: usageErrorFrom(error, argv, COMMON_OPTIONS, undefined),
    };
  }
  if (help === true) {
    return { kind: "help", text: usage() };
  }
  return { kind: "error", error: new NoCommandError() };
}

/** Whether `--json` was asked for, read before parsing so a usage error honours it. */
function wantsJson(argv: readonly string[]): boolean {
  const end = argv.indexOf("--");
  return (end === -1 ? argv : argv.slice(0, end)).includes("--json");
}

/** What a command body returns. */
export type CommandOutcome =
  | {
      readonly kind: "done";
      readonly exitCode: ExitCode;
      readonly document: Readonly<Record<string, unknown>>;
      readonly text: string;
    }
  | { readonly kind: "failed"; readonly error: Reportable };

/**
 * The frame an `--at` value names: a frame as given, seconds as the frame on screen
 * at that time, which is the last one at or before it. `undefined` when the number is
 * too large to compare with the timeline's microseconds.
 */
export function frameAt(at: At, fps: number): number | undefined {
  let frame = at.value;
  if (at.unit === "seconds") {
    const scaled = Math.round(at.value * 1_000_000) * fps;
    if (!Number.isSafeInteger(scaled)) {
      return undefined;
    }
    frame = Math.floor(scaled / 1_000_000);
  }
  return Number.isSafeInteger(frame * 1_000_000) ? frame : undefined;
}

/**
 * The frame an `--at` style value names in `scene`.
 *
 * @throws InvalidAtError for a number too large to compare, and AtPastEndError for a
 * frame after the scene's last one.
 */
function frameIn(scene: Scene, at: At, path: string): number {
  const { fps } = scene.timeline;
  const frame = frameAt(at, fps);
  if (frame === undefined) {
    throw new InvalidAtError(path);
  }
  // A scene without a length has no last frame to be past; its finding says so.
  const lastFrame = lastFrameOf(scene.timeline);
  if (lastFrame !== undefined && frame > lastFrame) {
    throw new AtPastEndError(path, lastFrame, fps);
  }
  return frame;
}

/** What a command needs to draw and check a scene's text on this machine. */
interface TextSetup {
  /** The font family list text is drawn in; `undefined` when no font was looked up. */
  readonly font: string | undefined;
  /** What `checkScene` measures the text with, and what it reports about the font. */
  readonly check: CheckOptions;
}

/**
 * Chooses the scene's font and makes the measurer its text is checked with. A scene
 * without a label or a bubble has nothing to measure, so `check` (`draws` false) then
 * loads no rasteriser; a command that draws loads it anyway, and text drawn inside a
 * drawing still gets the font.
 */
async function textSetup(
  scene: Scene,
  sceneFile: string,
  { raster, platform }: ImageEnvironment,
  draws: boolean,
): Promise<TextSetup> {
  const text = hasText(scene.timeline);
  if (!text && !draws) {
    return { font: undefined, check: {} };
  }
  const { family, findings } = chooseFont(
    scene,
    sceneFile,
    platform,
    await raster.fonts(),
  );
  return {
    font: family,
    check: text
      ? { measurer: await raster.measurer(textFont(family)), environment: findings }
      : {},
  };
}

function runCheck(
  scene: Scene,
  invocation: Extract<Invocation, { command: "check" }>,
  text: TextSetup,
): CommandOutcome {
  const { strict, at } = invocation;
  const { findings, truncated } = checkScene(scene, text.check);
  const report = checkReport(findings, { strict, truncated });
  const exitCode = exitCodeFor(findings, { strict });
  if (at === undefined) {
    return {
      kind: "done",
      exitCode,
      document: { ...report },
      text: formatReport(report),
    };
  }
  const state = describeState(scene, frameIn(scene, at, "check.at"));
  return {
    kind: "done",
    exitCode,
    document: { ...report, state },
    text: `${formatReport(report)}\n${formatState(state)}`,
  };
}

/**
 * What `frame` and `sheet` report: the paths written, the state of each frame drawn,
 * and the count of the scene's findings. They draw whatever the findings are, so the
 * exit code is 0.
 */
function imagesOutcome(
  scene: Scene,
  paths: readonly string[],
  states: readonly StateDescription[],
  text: TextSetup,
): CommandOutcome {
  const { findings, truncated } = checkScene(scene, text.check);
  const { summary } = checkReport(findings, { strict: false, truncated });
  return {
    kind: "done",
    exitCode: 0,
    document: { version: 1, ok: true, paths, states, summary },
    text:
      paths.map((file) => `wrote ${file}\n`).join("") +
      states.map((state) => `${formatState(state)}\n`).join("") +
      formatReport({ version: 1, ok: true, findings: [], summary }),
  };
}

async function runFrame(
  scene: Scene,
  invocation: Extract<Invocation, { command: "frame" }>,
  environment: ImageEnvironment,
): Promise<CommandOutcome> {
  const frame = frameIn(scene, invocation.at, "frame.at");
  const out =
    invocation.out ?? outputBeside(invocation.scene, `frame-${String(frame)}`);
  const text = await textSetup(scene, invocation.scene, environment, true);
  await writeFrameImage(scene, frame, out, output(environment, text));
  return imagesOutcome(scene, [out], [describeState(scene, frame)], text);
}

function output(environment: ImageEnvironment, text: TextSetup): ImageOutput {
  return {
    raster: environment.raster,
    write: environment.write,
    textFont: text.font ?? "sans-serif",
  };
}

/** The frames a sheet or a ghost image draws, in order, each once. */
function sheetFrames(
  scene: Scene,
  invocation: Extract<Invocation, { command: "sheet" }>,
  count: number,
): number[] {
  const { times, from, to } = invocation;
  if (times !== undefined) {
    const frames = times.map((at) => frameIn(scene, at, "sheet.times"));
    return [...new Set(frames)].sort((a, b) => a - b);
  }
  const lastFrame = lastFrameOf(scene.timeline);
  const first = from === undefined ? 0 : frameIn(scene, from, "sheet.from");
  const last = to === undefined ? lastFrame : frameIn(scene, to, "sheet.to");
  if (last === undefined) {
    throw new NoLengthError();
  }
  if (first > last) {
    throw new InvalidRangeError();
  }
  return spreadFrames(first, last, count);
}

async function runSheet(
  scene: Scene,
  invocation: Extract<Invocation, { command: "sheet" }>,
  environment: ImageEnvironment,
): Promise<CommandOutcome> {
  const { ghost } = invocation;
  const text = await textSetup(scene, invocation.scene, environment, true);
  let { row } = invocation;
  let out: string;
  let frames: number[];
  if (ghost === undefined) {
    if (row !== undefined && row >= scene.timeline.rows.length) {
      throw new InvalidRowError(scene.timeline.rows.length);
    }
    frames = sheetFrames(scene, invocation, SHEET_CELLS);
    out = invocation.out ?? outputBeside(invocation.scene, "sheet");
    await writeSheetImage(scene, frames, row, out, output(environment, text));
  } else {
    const actor = findActor(scene.timeline, ghost);
    if (actor.kind === "none") {
      throw new UnknownActorError(actor.ids);
    }
    frames = sheetFrames(scene, invocation, GHOSTS);
    out = invocation.out ?? outputBeside(invocation.scene, "ghost");
    await writeGhostImage(scene, actor.row, actor.track, frames, out, environment);
    ({ row } = actor);
  }
  const states = frames.map((frame) => {
    const state = describeState(scene, frame);
    return row === undefined
      ? state
      : { ...state, rows: state.rows.filter((shown) => shown.row === row) };
  });
  return imagesOutcome(scene, [out], states, text);
}

/** What a scene command needs from this machine: the image writer and the encoder. */
export interface CommandEnvironment extends ImageEnvironment, VideoEnvironment {}

/**
 * `render`: the checks first, so an error finding stops it before ffmpeg is spawned;
 * then the encoder, then every frame. Warnings are printed with the path written.
 */
async function runRender(
  scene: Scene,
  invocation: Extract<Invocation, { command: "render" }>,
  environment: CommandEnvironment,
): Promise<CommandOutcome> {
  assertEvenSize(scene.width, scene.height);
  const text = await textSetup(scene, invocation.scene, environment, true);
  const { findings, truncated } = checkScene(scene, text.check);
  const report = checkReport(findings, { strict: false, truncated });
  const { version, ok, summary } = report;
  if (!ok) {
    return {
      kind: "done",
      exitCode: 1,
      document: { version, ok, paths: [], findings, summary },
      text: formatReport(report),
    };
  }
  // A scene without a length carries an error finding, so it never gets here.
  const lastFrame = lastFrameOf(scene.timeline) ?? 0;
  await findEncoder(environment.spawn, environment.platform);
  const out = invocation.out ?? videoBeside(invocation.scene);
  await writeVideo(scene, text.font ?? "sans-serif", out, lastFrame + 1, environment);
  return {
    kind: "done",
    exitCode: 0,
    document: { version, ok, paths: [out], findings, summary },
    text: `wrote ${out}\n${formatReport(report)}`,
  };
}

/** The failure to report for what a command body threw, or `undefined` to rethrow. */
function reportableFrom(error: unknown, checked: string): Reportable | undefined {
  if (!(error instanceof CharadeError)) {
    return undefined;
  }
  const code = errorCode(error);
  if (code === undefined) {
    return undefined;
  }
  const fix = "fix" in error && typeof error.fix === "string" ? error.fix : undefined;
  return {
    code,
    message: error.message,
    // A drawing that threw has no fix of its own; `check` names the function and why.
    fix:
      fix ??
      (code === "ERR_SCENE_DRAWING_FAILED"
        ? `Run ${NAME} check ${checked} for where it fails and how to fix it.`
        : `Fix what the message names, then run ${NAME} check ${checked}.`),
    ...(error instanceof UnknownItemError ? { nearest: error.nearest } : {}),
  };
}

/** Run a scene command on an already-built scene. */
export async function runSceneCommand(
  scene: Scene,
  invocation: SceneInvocation,
  environment: CommandEnvironment,
): Promise<CommandOutcome> {
  try {
    switch (invocation.command) {
      case "check":
        return runCheck(
          scene,
          invocation,
          await textSetup(scene, invocation.scene, environment, false),
        );
      case "frame":
        return await runFrame(scene, invocation, environment);
      case "sheet":
        return await runSheet(scene, invocation, environment);
      case "render":
        return await runRender(scene, invocation, environment);
    }
  } catch (error) {
    const reportable = reportableFrom(error, invocation.scene);
    if (reportable === undefined) {
      throw error;
    }
    return { kind: "failed", error: reportable };
  }
}

/** Loads a module of definitions; the real one imports it, a test passes a fake. */
export type DefinitionsLoader = (
  file: string,
  notice: (line: string) => void,
) => Promise<readonly Definition[]>;

/** What `catalog` and `check --defs` need from this machine. */
export interface VocabularyEnvironment extends ImageEnvironment {
  /** Loads the module `--defs` names. */
  readonly loadDefinitions: DefinitionsLoader;
  /** Makes the folder sample images go to, and its parents, when they are missing. */
  readonly mkdir: FolderMaker;
  /** Receives each notice line, without its newline. */
  readonly notice: (line: string) => void;
}

/**
 * `catalog`: the items, built-in or of the module given, narrowed to a name when one
 * is given; the rig with the whole built-in listing only; a sample image per item
 * only with `--images`.
 */
async function runCatalog(
  invocation: Extract<Invocation, { command: "catalog" }>,
  environment: VocabularyEnvironment,
): Promise<CommandOutcome> {
  const { name, defs, images } = invocation;
  let definitions =
    defs === undefined
      ? builtinDefinitions()
      : await environment.loadDefinitions(defs, environment.notice);
  if (name !== undefined) {
    const selection = selectItems(definitions, name);
    if (selection.kind === "none") {
      throw new UnknownItemError(selection.nearest, defs);
    }
    ({ definitions } = selection);
  }
  const items = definitions.map(catalogItem);
  const rig = name === undefined && defs === undefined ? describeRig() : undefined;
  const written: { kind: string; name: string; path: string }[] = [];
  if (images !== undefined) {
    const folder = images === "" ? CATALOG_IMAGES : images;
    await environment.mkdir(folder);
    for (const definition of definitions) {
      const built = sampleScene(definition);
      if (built === undefined) {
        continue;
      }
      const out = path.join(folder, sampleImageName(definition));
      const target = output(
        environment,
        await textSetup(built, defs ?? folder, environment, true),
      );
      const frames = sampleFrames(definition.kind, built);
      await (frames.length === 1
        ? writeFrameImage(built, frames[0] ?? 0, out, target)
        : writeSheetImage(built, frames, undefined, out, target));
      written.push({ kind: definition.kind, name: definition.name, path: out });
    }
  }
  return {
    kind: "done",
    exitCode: 0,
    document: {
      version: 1,
      ok: true,
      items,
      ...(rig === undefined ? {} : { rig }),
      ...(images === undefined ? {} : { images: written }),
    },
    text:
      formatCatalog(items, rig) +
      (images !== undefined && rig !== undefined ? "\n" : "") +
      written.map(({ path: file }) => `wrote ${file}\n`).join(""),
  };
}

/**
 * `check --defs`: every definition's sample as a scene, checked as `check` checks
 * one. An item without a sample is a warning, since nothing of it was checked.
 */
async function runCheckSamples(
  invocation: Extract<Invocation, { command: "check-samples" }>,
  environment: VocabularyEnvironment,
): Promise<CommandOutcome> {
  const { defs, strict } = invocation;
  const definitions = await environment.loadDefinitions(defs, environment.notice);
  const reports: (CheckReport & { kind: string; name: string })[] = [];
  for (const definition of definitions) {
    const { kind, name } = definition;
    const built = sampleScene(definition);
    let result: CheckResult;
    if (built === undefined) {
      result = {
        findings: [
          {
            code: "ERR_DEFINE_NO_SAMPLE",
            severity: "warning",
            message: `The ${kind} ${name} has no sample, so nothing of it was checked.`,
            fix: "Give the definition a sample(stage) that shows the item in use.",
          },
        ],
        truncated: false,
      };
    } else {
      const text = await textSetup(built, defs, environment, false);
      result = checkScene(built, text.check);
    }
    const { findings, truncated } = result;
    reports.push({ kind, name, ...checkReport(findings, { strict, truncated }) });
  }
  const all = reports.flatMap((report) => report.findings);
  const truncated = reports.some((report) => report.summary.truncated);
  const { version, ok, summary } = checkReport(all, { strict, truncated });
  return {
    kind: "done",
    exitCode: exitCodeFor(all, { strict }),
    document: {
      version,
      ok,
      items: reports.map((report) => ({
        kind: report.kind,
        name: report.name,
        ok: report.ok,
        findings: report.findings,
        summary: report.summary,
      })),
      summary,
    },
    text:
      reports
        .map((report) => `${report.kind} ${report.name}\n${formatReport(report)}\n`)
        .join("") + `total: ${formatReport({ version, ok, findings: [], summary })}`,
  };
}

/** Run a command that reads definitions instead of a scene. */
export async function runVocabularyCommand(
  invocation: VocabularyInvocation,
  environment: VocabularyEnvironment,
): Promise<CommandOutcome> {
  try {
    return await (invocation.command === "catalog"
      ? runCatalog(invocation, environment)
      : runCheckSamples(invocation, environment));
  } catch (error) {
    const reportable = reportableFrom(error, `--defs ${invocation.defs ?? "items.ts"}`);
    if (reportable === undefined) {
      throw error;
    }
    return { kind: "failed", error: reportable };
  }
}

/** The first Node version whose type stripping is stable. */
const STABLE_STRIPPING = [24, 12] as const;

/** The one stderr line owed on Node 24.0–24.11, or `undefined`. */
export function nodeNotice(version: string): string | undefined {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  if (
    major !== STABLE_STRIPPING[0] ||
    minor === undefined ||
    minor >= STABLE_STRIPPING[1]
  ) {
    return undefined;
  }
  return `notice: type stripping is stable from Node 24.12.0; this is Node ${version}, so upgrading to 24.12 or newer is recommended.`;
}

/** Loads a scene file; the real one imports it, a test passes a fake. */
export type SceneLoader = (
  file: string,
  notice: (line: string) => void,
) => Promise<Scene>;

/** What {@link runCli} reads from its environment, each replaceable in a test. */
export interface CliOptions {
  /** The running Node version, `process.versions.node` by default. */
  readonly nodeVersion?: string;
  /** Loads the scene file. */
  readonly load?: SceneLoader;
  /** Loads the module `--defs` names. */
  readonly loadDefinitions?: DefinitionsLoader;
  /** Makes the folder `catalog --images` writes to; `node:fs` by default. */
  readonly mkdir?: FolderMaker;
  /** Turns drawings into pixels; skia-canvas by default, loaded on first use. */
  readonly raster?: Rasteriser;
  /** Writes an output file; `node:fs` by default. */
  readonly write?: FileWriter;
  /** The operating system, `process.platform` by default: it picks the default font. */
  readonly platform?: string;
  /** Starts ffmpeg; `node:child_process` without a shell by default. */
  readonly spawn?: Spawn;
  /** Reports SIGINT, SIGTERM and SIGHUP by default, so a partial video is removed. */
  readonly interrupts?: Interrupts;
  /**
   * Receives stderr as it is produced, so progress shows during a long render and is
   * not lost when a signal ends the process. The result's `stderr` holds it all too.
   */
  readonly stderr?: { write(chunk: string): unknown };
}

const realLoad: SceneLoader = (file, notice) => loadScene(file, { notice });

const realLoadDefinitions: DefinitionsLoader = (file, notice) =>
  loadDefinitions(file, { notice });

/**
 * Run the command without coupling its behavior to process globals.
 *
 * @param argv Arguments after the executable name.
 * @param options The environment, replaceable in a test.
 * @returns The process result a caller should observe.
 */
export async function runCli(
  argv: readonly string[],
  options: CliOptions = {},
): Promise<CliResult> {
  const json = wantsJson(argv);
  let stderr = "";
  const emit = (text: string): void => {
    stderr += text;
    options.stderr?.write(text);
  };
  const notice = (line: string): void => {
    emit(`${line}\n`);
  };
  const node = nodeNotice(options.nodeVersion ?? process.versions.node);
  if (node !== undefined) {
    notice(node);
  }

  const failed = (
    error: Reportable,
    usageText?: string,
    { findings, truncated }: AbortedBuild = { findings: [], truncated: false },
  ): CliResult => {
    if (json) {
      const document = {
        version: 1,
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          fix: error.fix,
          ...(error.nearest === undefined ? {} : { nearest: error.nearest }),
        },
        ...(findings.length === 0 ? {} : { findings }),
        ...(truncated ? { truncated } : {}),
      };
      return {
        exitCode: COULD_NOT_RUN,
        stdout: `${JSON.stringify(document)}\n`,
        stderr,
      };
    }
    emit(`error ${error.code}: ${error.message}\n  fix: ${error.fix}\n`);
    if (findings.length > 0) {
      emit(`\n${findings.map(formatFinding).join("\n")}`);
    }
    if (truncated) {
      emit("\nLater findings were dropped: fix these and check again.\n");
    }
    if (usageText !== undefined) {
      emit(`\n${usageText}`);
    }
    return { exitCode: COULD_NOT_RUN, stdout: "", stderr };
  };

  const parsed = parse(argv);
  switch (parsed.kind) {
    case "help":
      return {
        exitCode: 0,
        stdout: json
          ? `${JSON.stringify({ version: 1, ok: true, help: parsed.text })}\n`
          : parsed.text,
        stderr,
      };
    case "error":
      return failed(
        parsed.error,
        parsed.error.code === "ERR_CLI_NO_COMMAND" ? usage() : undefined,
      );
    case "run":
      break;
  }

  const { invocation } = parsed;
  let outcome: CommandOutcome;
  // Installed for the load too: the scene's build function runs inside the import.
  const previous = installReadWatch(watchGlobals);
  try {
    if (invocation.command === "catalog" || invocation.command === "check-samples") {
      outcome = await runVocabularyCommand(invocation, {
        raster: options.raster ?? createRasteriser(),
        write: options.write ?? writeOutput,
        platform: options.platform ?? process.platform,
        loadDefinitions: options.loadDefinitions ?? realLoadDefinitions,
        mkdir: options.mkdir ?? makeFolder,
        notice,
      });
    } else {
      let scene: Scene;
      try {
        scene = await (options.load ?? realLoad)(invocation.scene, notice);
      } catch (error) {
        // The build's findings are kept under what it threw, which the loader wraps; a
        // load error with no cause (no scene file, not a scene) was thrown by no build.
        const kept = takeAbortedBuild(
          error instanceof SceneLoadError
            ? Object.hasOwn(error, "cause")
              ? error.cause
              : NO_BUILD
            : error,
        );
        return failed(
          error instanceof SceneLoadError ? error : new SceneFailedError(error),
          undefined,
          kept,
        );
      }
      outcome = await runSceneCommand(scene, invocation, {
        raster: options.raster ?? createRasteriser(),
        write: options.write ?? writeOutput,
        platform: options.platform ?? process.platform,
        spawn: options.spawn ?? spawnProcess,
        interrupts: options.interrupts ?? processInterrupts,
        notice,
      });
    }
  } finally {
    installReadWatch(previous);
  }
  if (outcome.kind === "failed") {
    return failed(outcome.error);
  }
  return {
    exitCode: outcome.exitCode,
    stdout: json ? `${JSON.stringify(outcome.document)}\n` : outcome.text,
    stderr,
  };
}

function canonicalize(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * Whether the module at `moduleUrl` is the script Node was started with.
 *
 * @param moduleUrl The module's `import.meta.url`.
 * @param entry The script path Node was given, `process.argv[1]`.
 */
export function isMain(moduleUrl: string, entry: string | undefined): boolean {
  return (
    entry !== undefined &&
    canonicalize(entry) === canonicalize(fileURLToPath(moduleUrl))
  );
}

/** The streams {@link main} writes to. */
export interface CliStreams {
  readonly stdout: { write(chunk: string): unknown };
  readonly stderr: {
    write(chunk: string): unknown;
    on?(event: "error", listener: (error: Error) => void): unknown;
  };
}

/**
 * Run the command, writing stderr to `streams` as it is produced and stdout once the
 * command is done.
 *
 * @param argv Arguments after the executable name.
 * @param streams Where stdout and stderr go.
 * @param options The environment, replaceable in a test.
 * @returns The exit code.
 */
export async function main(
  argv: readonly string[],
  streams: CliStreams,
  options: CliOptions = {},
): Promise<ExitCode> {
  // stderr is written mid-render now: an EPIPE there (`2>&1 | head`) must not crash the
  // process before ffmpeg is stopped and the partial video removed.
  streams.stderr.on?.("error", () => undefined);
  const result = await runCli(argv, { ...options, stderr: streams.stderr });
  streams.stdout.write(result.stdout);
  return result.exitCode;
}

/**
 * Run the command when `moduleUrl` is the script Node was started with.
 *
 * @param moduleUrl The module's `import.meta.url`.
 * @param argv The full `process.argv`.
 * @param streams Where stdout and stderr go.
 * @param options The environment, replaceable in a test.
 * @returns The exit code, or `undefined` when the module was only imported.
 */
export async function runIfMain(
  moduleUrl: string,
  argv: readonly string[],
  streams: CliStreams,
  options: CliOptions = {},
): Promise<ExitCode | undefined> {
  if (!isMain(moduleUrl, argv[1])) {
    return undefined;
  }
  return main(argv.slice(2), streams, options);
}

const exitCode = await runIfMain(import.meta.url, process.argv, process);
if (exitCode !== undefined) {
  process.exitCode = exitCode;
}
