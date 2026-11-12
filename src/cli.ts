#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the package command without coupling its behavior to process globals.
 *
 * @param argv Arguments after the executable name.
 * @param executable Name or path shown in the usage line.
 * @returns The process result a caller should observe.
 */
export function runCli(argv: readonly string[], executable = "package"): CliResult {
  let help: boolean | undefined;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { help: { type: "boolean", short: "h" } },
      strict: true,
      allowPositionals: false,
    });
    help = values.help;
  } catch {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `Invalid arguments. Run ${executable} --help for usage.\n`,
    };
  }
  if (help === true) {
    return {
      exitCode: 0,
      stdout:
        `Usage: ${executable} [options]\n\n` +
        "Options:\n" +
        "  -h, --help  Show this help message.\n",
      stderr: "",
    };
  }
  return { exitCode: 0, stdout: "", stderr: "" };
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
export function isMain(moduleUrl: string, entry: string | undefined): entry is string {
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
 * @param executable Name or path shown in the usage line.
 * @param streams Where stdout and stderr go.
 * @returns The exit code.
 */
export function main(
  argv: readonly string[],
  executable: string,
  streams: CliStreams,
): number {
  const result = runCli(argv, executable);
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
 * @returns The exit code, or `undefined` when the module was only imported.
 */
export function runIfMain(
  moduleUrl: string,
  argv: readonly string[],
  streams: CliStreams,
): number | undefined {
  const entry = argv[1];
  return isMain(moduleUrl, entry) ? main(argv.slice(2), entry, streams) : undefined;
}

process.exitCode = runIfMain(import.meta.url, process.argv, process);
