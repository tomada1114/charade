#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

import { COULD_NOT_RUN, type ExitCode } from "./check/findings.js";
import { CharadeError, UnknownFlagError } from "./errors.js";
import { loadScene, SceneFailedError, SceneLoadError } from "./export/loader.js";
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
    this.fix = `Name the scene file: ${NAME} ${command} scene.ts.`;
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

/** The command parsed, but its body is not built yet. */
class NotImplementedError extends UsageError {
  readonly code = "ERR_CLI_NOT_IMPLEMENTED" as const;
  readonly fix: string;

  /** The command. */
  readonly command: CommandName;

  constructor(command: CommandName) {
    super(`${command} is not implemented yet.`);
    this.command = command;
    this.fix = `Upgrade charade to a release that has ${command}.`;
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
      readonly json: boolean;
    }
  | {
      readonly command: "catalog";
      readonly module: string | undefined;
      readonly images: boolean;
      readonly json: boolean;
    };

/** A scene command's invocation. */
export type SceneInvocation = Exclude<Invocation, { readonly command: "catalog" }>;

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
    options: { ...COMMON_OPTIONS, strict: { type: "boolean" }, at: { type: "string" } },
    help: [
      ["--strict", "Fail on warnings too."],
      ["--at <time>", "Also describe the state at a time: 1.5, 1.5s or 45f."],
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
    options: { ...COMMON_OPTIONS, ...OUT_OPTION, ghost: { type: "string" } },
    help: [
      ["--ghost <actor>", "Overlay one actor's motion on a single image instead."],
      ["-o, --out <path>", "Where to write the PNG; next to the scene by default."],
    ],
  },
  catalog: {
    synopsis: "catalog [module] [options]",
    summary: "List the installed vocabulary and the rig, for an agent to read.",
    options: { ...COMMON_OPTIONS, images: { type: "boolean" } },
    help: [["--images", "Also write a sample image of every item."]],
  },
};

function isCommand(name: string): name is CommandName {
  return Object.hasOwn(COMMANDS, name);
}

function table(rows: readonly (readonly [string, string])[]): string {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}\n`).join("");
}

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
  | { readonly kind: "error"; readonly error: Reportable; readonly usage: string };

function parseCommand(command: CommandName, args: readonly string[]): Parsed {
  const spec = COMMANDS[command];
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
    return {
      kind: "error",
      error: usageErrorFrom(error, args, spec.options, command),
      usage: commandUsage(command),
    };
  }
  if (values["help"] === true) {
    return { kind: "help", text: commandUsage(command) };
  }
  const json = values["json"] === true;
  const text = (name: string): string | undefined => {
    const value = values[name];
    return typeof value === "string" ? value : undefined;
  };
  const fail = (error: Reportable): Parsed => ({
    kind: "error",
    error,
    usage: commandUsage(command),
  });
  const help = `${NAME} ${command} --help`;

  if (command === "catalog") {
    if (positionals.length > 1) {
      return fail(new UnexpectedArgumentError(command, help));
    }
    return {
      kind: "run",
      invocation: {
        command,
        module: positionals[0],
        images: values["images"] === true,
        json,
      },
    };
  }
  const [scene, ...extra] = positionals;
  if (scene === undefined) {
    return fail(new MissingSceneError(command));
  }
  if (extra.length > 0) {
    return fail(new UnexpectedArgumentError(command, help));
  }
  try {
    const atText = text("at");
    const at = atText === undefined ? undefined : parseAt(atText, `${command}.at`);
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
      case "sheet":
        return {
          kind: "run",
          invocation: { command, scene, out: text("out"), ghost: text("ghost"), json },
        };
    }
  } catch (error) {
    if (error instanceof InvalidAtError) {
      return fail(error);
    }
    throw error;
  }
}

/** Parse argv into what to run. */
function parse(argv: readonly string[]): Parsed {
  const [first, ...rest] = argv;
  if (first !== undefined && isCommand(first)) {
    return parseCommand(first, rest);
  }
  if (first !== undefined && !first.startsWith("-")) {
    return { kind: "error", error: new UnknownCommandError(first), usage: usage() };
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
      usage: usage(),
    };
  }
  if (help === true) {
    return { kind: "help", text: usage() };
  }
  return { kind: "error", error: new NoCommandError(), usage: usage() };
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

function notImplemented(command: CommandName): CommandOutcome {
  return { kind: "failed", error: new NotImplementedError(command) };
}

/**
 * Run a scene command on an already-built scene. Each body is a stub that its own
 * issue replaces: `render` #17, `check` #18, `frame` and `sheet` #28.
 */
export function runSceneCommand(
  _scene: Scene,
  invocation: SceneInvocation,
): CommandOutcome {
  return notImplemented(invocation.command);
}

/** Run `catalog`, which #30 builds. */
export function runCatalog(
  invocation: Extract<Invocation, { command: "catalog" }>,
): CommandOutcome {
  return notImplemented(invocation.command);
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
}

const realLoad: SceneLoader = (file, notice) => loadScene(file, { notice });

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
  const notice = (line: string): void => {
    stderr += `${line}\n`;
  };
  const node = nodeNotice(options.nodeVersion ?? process.versions.node);
  if (node !== undefined) {
    notice(node);
  }

  const failed = (error: Reportable, usageText?: string): CliResult => {
    if (json) {
      const document = {
        version: 1,
        ok: false,
        error: { code: error.code, message: error.message, fix: error.fix },
      };
      return {
        exitCode: COULD_NOT_RUN,
        stdout: `${JSON.stringify(document)}\n`,
        stderr,
      };
    }
    const block = `error ${error.code}: ${error.message}\n  fix: ${error.fix}\n`;
    return {
      exitCode: COULD_NOT_RUN,
      stdout: "",
      stderr: stderr + block + (usageText === undefined ? "" : `\n${usageText}`),
    };
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
        parsed.error.code === "ERR_CLI_NO_COMMAND" ? parsed.usage : undefined,
      );
    case "run":
      break;
  }

  const { invocation } = parsed;
  let outcome: CommandOutcome;
  if (invocation.command === "catalog") {
    outcome = runCatalog(invocation);
  } else {
    let scene: Scene;
    try {
      scene = await (options.load ?? realLoad)(invocation.scene, notice);
    } catch (error) {
      return failed(
        error instanceof SceneLoadError ? error : new SceneFailedError(error),
      );
    }
    outcome = runSceneCommand(scene, invocation);
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
  readonly stderr: { write(chunk: string): unknown };
}

/**
 * Run the command and write its result to `streams`.
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
  const result = await runCli(argv, options);
  streams.stdout.write(result.stdout);
  streams.stderr.write(result.stderr);
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
