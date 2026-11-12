import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isMain, main, runCli, runIfMain } from "../src/cli.js";

describe("runCli", () => {
  it("returns help on --help", () => {
    expect(runCli(["--help"], "my-tool")).toEqual({
      exitCode: 0,
      stdout:
        "Usage: my-tool [options]\n\n" +
        "Options:\n" +
        "  -h, --help  Show this help message.\n",
      stderr: "",
    });
  });

  it("returns help on the short help flag", () => {
    const result = runCli(["-h"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: package [options]");
    expect(result.stderr).toBe("");
  });

  it("does not write output for an invocation without options", () => {
    expect(runCli([])).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  it.each([
    { argv: ["--unknown"] },
    { argv: ["unexpected"] },
    { argv: ["--help", "--unknown"] },
    { argv: ["--help=false"] },
  ])(
    "reports invalid arguments $argv on stderr with a failing exit code",
    ({ argv }) => {
      expect(runCli(argv, "my-tool")).toEqual({
        exitCode: 2,
        stdout: "",
        stderr: "Invalid arguments. Run my-tool --help for usage.\n",
      });
    },
  );
});

describe("main", () => {
  it("writes the result to the given streams and returns the exit code", () => {
    const out: string[] = [];
    const err: string[] = [];
    const streams = {
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => err.push(chunk) },
    };

    expect(main(["--unknown"], "my-tool", streams)).toBe(2);
    expect(out.join("")).toBe("");
    expect(err.join("")).toBe("Invalid arguments. Run my-tool --help for usage.\n");
  });
});

describe("runIfMain", () => {
  const moduleUrl = new URL("../src/cli.ts", import.meta.url).href;
  const silent = { stdout: { write: () => true }, stderr: { write: () => true } };

  it("runs the command when the module is the entry script", () => {
    const entry = fileURLToPath(moduleUrl);
    expect(runIfMain(moduleUrl, ["node", entry, "--unknown"], silent)).toBe(2);
  });

  it("does nothing when the module was only imported", () => {
    expect(
      runIfMain(moduleUrl, ["node", "/elsewhere/tool.js"], silent),
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
