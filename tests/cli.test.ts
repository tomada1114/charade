import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  type CliOptions,
  isMain,
  main,
  nodeNotice,
  parseAt,
  runCli,
  runIfMain,
} from "../src/cli.js";
import { scene } from "../src/index.js";

const built = scene({}, () => undefined);

/** A loader that never touches the filesystem, recording what it was asked for. */
function fakeLoader(): { options: CliOptions; files: string[] } {
  const files: string[] = [];
  return {
    files,
    options: {
      nodeVersion: "24.22.1",
      load: (file) => {
        files.push(file);
        return Promise.resolve(built);
      },
    },
  };
}

const quiet: CliOptions = {
  nodeVersion: "24.22.1",
  load: () => Promise.reject(new Error("the loader must not run")),
};

function parseOne(stdout: string): { ok: boolean; error?: { code: string } } {
  expect(stdout.endsWith("\n")).toBe(true);
  expect(stdout.trimEnd().includes("\n")).toBe(false);
  return JSON.parse(stdout) as { ok: boolean; error?: { code: string } };
}

describe("help", () => {
  it.each([["--help"], ["-h"]])("prints the usage on %s and exits 0", async (flag) => {
    const result = await runCli([flag], quiet);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: charade <command> [options]");
    for (const command of ["render", "check", "frame", "sheet", "catalog"]) {
      expect(result.stdout).toContain(`  ${command} `);
    }
    expect(result.stderr).toBe("");
  });

  it.each(["render", "check", "frame", "sheet", "catalog"])(
    "prints the usage of %s on its --help without loading anything",
    async (command) => {
      const result = await runCli([command, "--help"], quiet);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Usage: charade ${command} `);
      expect(result.stdout).toContain("--json");
    },
  );

  it("prints help as one JSON document under --json", async () => {
    const result = await runCli(["--help", "--json"], quiet);
    expect(result.exitCode).toBe(0);
    expect(parseOne(result.stdout)).toMatchObject({ version: 1, ok: true });
  });
});

describe("usage errors (R1)", () => {
  it("exits 2 with usage when no command is given", async () => {
    const result = await runCli([], quiet);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("ERR_CLI_NO_COMMAND");
    expect(result.stderr).toContain("Usage: charade <command> [options]");
  });

  it.each([
    {
      label: "unknown subcommand",
      argv: ["rendr", "a.ts"],
      code: "ERR_CLI_UNKNOWN_COMMAND",
    },
    {
      label: "unknown flag",
      argv: ["check", "a.ts", "--strct"],
      code: "ERR_CLI_UNKNOWN_FLAG",
    },
    {
      label: "unknown short flag",
      argv: ["check", "a.ts", "-z"],
      code: "ERR_CLI_UNKNOWN_FLAG",
    },
    { label: "unknown global flag", argv: ["--bogus"], code: "ERR_CLI_UNKNOWN_FLAG" },
    {
      label: "an override flag",
      argv: ["render", "a.ts", "--fps", "60"],
      code: "ERR_CLI_UNKNOWN_FLAG",
    },
    {
      label: "flag before the command",
      argv: ["-h", "check", "a.ts"],
      code: "ERR_CLI_UNEXPECTED_ARGUMENT",
    },
    { label: "missing scene", argv: ["check"], code: "ERR_CLI_MISSING_SCENE" },
    {
      label: "two scenes",
      argv: ["check", "a.ts", "b.ts"],
      code: "ERR_CLI_UNEXPECTED_ARGUMENT",
    },
    {
      label: "two catalog modules",
      argv: ["catalog", "a.ts", "b.ts"],
      code: "ERR_CLI_UNEXPECTED_ARGUMENT",
    },
    {
      label: "missing --at value",
      argv: ["frame", "a.ts", "--at"],
      code: "ERR_CLI_MISSING_VALUE",
    },
    {
      label: "--at followed by a flag",
      argv: ["frame", "a.ts", "--at", "-o", "x.png"],
      code: "ERR_CLI_MISSING_VALUE",
    },
    {
      label: "value on a boolean flag",
      argv: ["check", "a.ts", "--strict=yes"],
      code: "ERR_CLI_UNEXPECTED_VALUE",
    },
    {
      label: "frame without --at",
      argv: ["frame", "a.ts"],
      code: "ERR_CLI_MISSING_FLAG",
    },
    {
      label: "a bad --at",
      argv: ["frame", "a.ts", "--at", "soon"],
      code: "ERR_CLI_INVALID_AT",
    },
    {
      label: "a negative check --at",
      argv: ["check", "a.ts", "--at=-1"],
      code: "ERR_CLI_INVALID_AT",
    },
    {
      label: "a negative --at read as a flag",
      argv: ["check", "a.ts", "--at", "-1"],
      code: "ERR_CLI_MISSING_VALUE",
    },
  ])("reports $label on stderr with exit 2", async ({ argv, code }) => {
    const result = await runCli(argv, quiet);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(new RegExp(`^error ${code}: .+\\n  fix: .+\\n`, "m"));
  });

  it.each(["--constructor", "--toString", "--__proto__"])(
    "reports %s, a name Object.prototype has, as an unknown flag",
    async (flag) => {
      const result = await runCli(["check", "a.ts", flag], quiet);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/^error ERR_CLI_UNKNOWN_FLAG: /);
    },
  );

  it("names an unknown flag by its dotted path, not its value", async () => {
    const result = await runCli(["check", "a.ts", "--strct=secret", "--json"], quiet);
    expect(parseOne(result.stdout).error?.code).toBe("ERR_CLI_UNKNOWN_FLAG");
    expect(result.stdout).toContain("check.strct");
    expect(result.stdout).not.toContain("secret");
  });
});

describe("--json (R2)", () => {
  it.each([
    {
      label: "an unknown flag",
      argv: ["check", "a.ts", "--bogus", "--json"],
      code: "ERR_CLI_UNKNOWN_FLAG",
    },
    {
      label: "an unknown command",
      argv: ["nope", "--json"],
      code: "ERR_CLI_UNKNOWN_COMMAND",
    },
    { label: "no command", argv: ["--json"], code: "ERR_CLI_NO_COMMAND" },
    {
      label: "a bad --at",
      argv: ["frame", "a.ts", "--json", "--at", "1e3"],
      code: "ERR_CLI_INVALID_AT",
    },
  ])("prints one document with the code for $label", async ({ argv, code }) => {
    const result = await runCli(argv, quiet);
    expect(result.exitCode).toBe(2);
    expect(parseOne(result.stdout)).toMatchObject({
      version: 1,
      ok: false,
      error: { code },
    });
    expect(result.stderr).toBe("");
  });

  it("prints one document when loading fails", async () => {
    const result = await runCli(["check", "a.ts", "--json"], {
      nodeVersion: "24.22.1",
      load: () => Promise.reject(new Error("boom")),
    });
    expect(result.exitCode).toBe(2);
    expect(parseOne(result.stdout).error?.code).toBe("ERR_LOAD_FAILED");
  });

  it("keeps notices on stderr", async () => {
    const result = await runCli(["check", "a.ts", "--json"], {
      nodeVersion: "24.22.1",
      load: (_file, notice) => {
        notice("notice: a local version differs");
        return Promise.resolve(built);
      },
    });
    expect(parseOne(result.stdout).ok).toBe(false);
    expect(result.stderr).toBe("notice: a local version differs\n");
  });

  it("does not take --json after the -- terminator", async () => {
    const result = await runCli(["check", "a.ts", "--", "--json"], quiet);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("ERR_CLI_UNEXPECTED_ARGUMENT");
  });
});

describe("commands", () => {
  it.each([
    { command: "render", argv: ["render", "s.ts", "-o", "out.mp4"] },
    { command: "check", argv: ["check", "s.ts", "--strict", "--at", "1.5s"] },
    { command: "frame", argv: ["frame", "s.ts", "--at", "45f", "--out", "f.png"] },
    { command: "sheet", argv: ["sheet", "s.ts", "--ghost", "ada"] },
  ])(
    "passes the built scene to $command, which is not implemented yet",
    async ({ command, argv }) => {
      const { options, files } = fakeLoader();
      const result = await runCli([...argv, "--json"], options);
      expect(files).toEqual(["s.ts"]);
      expect(result.exitCode).toBe(2);
      expect(parseOne(result.stdout)).toMatchObject({
        ok: false,
        error: { code: "ERR_CLI_NOT_IMPLEMENTED" },
      });
      expect(result.stdout).toContain(command);
    },
  );

  it("runs catalog without loading a scene", async () => {
    const result = await runCli(["catalog", "--images"], quiet);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("ERR_CLI_NOT_IMPLEMENTED");
  });

  it("reports a stub as text without --json", async () => {
    const { options } = fakeLoader();
    const result = await runCli(["check", "s.ts"], options);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^error ERR_CLI_NOT_IMPLEMENTED: .+\n {2}fix: .+\n$/);
  });

  it("passes a loader's own load error through with its code", async () => {
    const result = await runCli(["check", "s.ts"], {
      nodeVersion: "24.22.1",
      load: () => Promise.reject(new Error("x")),
    });
    expect(result.stderr).toContain("ERR_LOAD_FAILED");
  });
});

describe("parseAt", () => {
  it.each([
    { text: "1.5", at: { unit: "seconds", value: 1.5 } },
    { text: "1.5s", at: { unit: "seconds", value: 1.5 } },
    { text: "0", at: { unit: "seconds", value: 0 } },
    { text: "0s", at: { unit: "seconds", value: 0 } },
    { text: "12", at: { unit: "seconds", value: 12 } },
    { text: "45f", at: { unit: "frame", value: 45 } },
    { text: "0f", at: { unit: "frame", value: 0 } },
    {
      text: "9007199254740991f",
      at: { unit: "frame", value: Number.MAX_SAFE_INTEGER },
    },
  ])("reads $text", ({ text, at }) => {
    expect(parseAt(text, "frame.at")).toEqual(at);
  });

  it.each([
    ["empty", ""],
    ["a bare s", "s"],
    ["a bare f", "f"],
    ["negative seconds", "-1"],
    ["a negative frame", "-3f"],
    ["a plus sign", "+1"],
    ["an exponent", "1e3"],
    ["a fractional frame", "1.5f"],
    ["both units", "1sf"],
    ["a leading dot", ".5"],
    ["a trailing dot", "5."],
    ["whitespace", " 1"],
    ["hex", "0x10"],
    ["Infinity", "Infinity"],
    ["NaN", "NaN"],
    ["full-width digits", "１.５"],
    ["Arabic-Indic digits", "٤٥f"],
    ["an emoji", "1🎬"],
    ["a frame past the safe integers", "9007199254740992f"],
    ["seconds that overflow", "9".repeat(400)],
  ])("rejects %s", (_label, text) => {
    expect(() => parseAt(text, "frame.at")).toThrow(
      expect.objectContaining({ code: "ERR_CLI_INVALID_AT", path: "frame.at" }),
    );
  });
});

describe("Node notice (R5)", () => {
  it.each(["24.0.0", "24.9.3", "24.11.1", "v24.11.0"])(
    "prints one stderr line on Node %s and continues",
    async (nodeVersion) => {
      const result = await runCli(["--help"], { ...quiet, nodeVersion });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Usage:");
      const lines = result.stderr.split("\n").filter((line) => line !== "");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("24.12");
    },
  );

  it("still runs the command after the notice", async () => {
    const { options, files } = fakeLoader();
    const result = await runCli(["check", "s.ts", "--json"], {
      ...options,
      nodeVersion: "24.4.0",
    });
    expect(files).toEqual(["s.ts"]);
    expect(parseOne(result.stdout).error?.code).toBe("ERR_CLI_NOT_IMPLEMENTED");
    expect(result.stderr).toMatch(/^notice: .*24\.12.*\n$/);
  });

  it.each(["24.12.0", "24.22.1", "25.0.0", "26.1.0"])(
    "is silent on Node %s",
    (version) => {
      expect(nodeNotice(version)).toBeUndefined();
    },
  );

  it("is silent on a version it cannot read", () => {
    expect(nodeNotice("24")).toBeUndefined();
  });
});

describe("main", () => {
  it("writes the result to the given streams and returns the exit code", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const streams = {
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => err.push(chunk) },
    };

    expect(await main(["--unknown"], streams, quiet)).toBe(2);
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain("ERR_CLI_UNKNOWN_FLAG");
  });
});

describe("runIfMain", () => {
  const moduleUrl = new URL("../src/cli.ts", import.meta.url).href;
  const silent = { stdout: { write: () => true }, stderr: { write: () => true } };

  it("runs the command when the module is the entry script", async () => {
    const entry = fileURLToPath(moduleUrl);
    expect(
      await runIfMain(moduleUrl, ["node", entry, "--unknown"], silent, quiet),
    ).toBe(2);
  });

  it("does nothing when the module was only imported", async () => {
    expect(
      await runIfMain(moduleUrl, ["node", "/elsewhere/tool.js"], silent),
    ).toBeUndefined();
  });
});

describe("isMain", () => {
  const moduleUrl = new URL("../src/cli.ts", import.meta.url).href;

  it("is true when the entry is the module's own file", () => {
    expect(isMain(moduleUrl, fileURLToPath(moduleUrl))).toBe(true);
  });

  it("is false without an entry script", () => {
    expect(isMain(moduleUrl, undefined)).toBe(false);
  });

  it("is false for an entry that does not exist", () => {
    expect(isMain(moduleUrl, "/no/such/entry.js")).toBe(false);
  });
});
