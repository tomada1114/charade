import consoleModule from "node:console";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import type * as NodeTools from "../scripts/lib/node-tools.mjs";

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

// scripts/smoke-package.mjs's checkRuntimeImports/checkRequireInterop/
// checkDeepImportBlocked/checkTypeScriptConsumers all write a generated
// script into a throwaway consumer directory and then run it through
// runNode(). Mocking runNode at the subprocess boundary (the conventions in
// .claude/rules/tests.md) exercises both outcomes of each check without installing a
// real tarball or compiling a real TypeScript project for every case.
// checkTarballContents (the other half of this file) already has real-fixture
// coverage in tests/package.test.ts from #83.
const runNodeMock =
  vi.fn<
    (
      script: string,
      args: readonly string[],
      options?: { cwd?: string; env?: NodeJS.ProcessEnv },
    ) => RunResult
  >();

vi.mock("../scripts/lib/node-tools.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeTools>();
  return {
    ...actual,
    runNode: (
      script: string,
      args: readonly string[],
      options?: { cwd?: string; env?: NodeJS.ProcessEnv },
    ) => runNodeMock(script, args, options),
  };
});

const {
  checkBinCommands,
  checkDeepImportBlocked,
  checkEmptyFolderFrame,
  checkNoTranspiler,
  checkRequireInterop,
  checkRuntimeImports,
  checkTypeScriptConsumers,
  compileTypeScriptConsumer,
  installConsumer,
  isUniversalProfile,
  main,
  publicBinCommands,
  publicSubpaths,
  TRANSPILER_PACKAGES,
  unexportedEntryPath,
} = await import("../scripts/smoke-package.mjs");
const { repoRoot } = await import("../scripts/lib/node-tools.mjs");

const workspaces: string[] = [];

function makeConsumer(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "smoke-package-test-"));
  workspaces.push(dir);
  return dir;
}

let stdoutSpy: MockInstance<typeof process.stdout.write>;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  while (workspaces.length > 0) {
    const dir = workspaces.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("checkRuntimeImports", () => {
  it("passes and reports stdout when every subpath imports cleanly", () => {
    runNodeMock.mockReturnValue({ status: 0, stdout: "  ./ -> a, b\n", stderr: "" });
    const consumer = makeConsumer();

    expect(() => checkRuntimeImports(consumer, "fixture-package", [""])).not.toThrow();
    expect(stdoutSpy).toHaveBeenCalledWith("  ./ -> a, b\n");
  });

  it("throws ERR_SMOKE_IMPORT_FAILED, naming every subpath, when an import fails", () => {
    runNodeMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "Cannot find module",
    });
    const consumer = makeConsumer();

    expect(() =>
      checkRuntimeImports(consumer, "fixture-package", ["", "/sub"]),
    ).toThrow(/ERR_SMOKE_IMPORT_FAILED[\s\S]*fixture-package, fixture-package\/sub/);
  });

  it("skips the library contract for a bin-only package", () => {
    const consumer = makeConsumer();

    expect(() =>
      checkRuntimeImports(consumer, "fixture-package", [""], false),
    ).not.toThrow();
    expect(runNodeMock).not.toHaveBeenCalled();
  });

  it("keeps the named-export contract for a package that also has a bin", () => {
    runNodeMock.mockReturnValue({ status: 0, stdout: "  library ok\n", stderr: "" });
    const consumer = makeConsumer();

    expect(() =>
      checkRuntimeImports(consumer, "fixture-package", [""], true),
    ).not.toThrow();
    expect(runNodeMock).toHaveBeenCalledTimes(1);
  });
});

describe("publicBinCommands and checkBinCommands", () => {
  it("normalizes a string bin and an unnamed object bin to command names", () => {
    expect(
      publicBinCommands({ bin: "./dist/cli.js" }, "@scope/fixture-package"),
    ).toEqual(["fixture-package"]);
    expect(
      publicBinCommands(
        { bin: { "": "./dist/cli.js", other: "./dist/other.js" } },
        "fixture-package",
      ),
    ).toEqual(["fixture-package", "other"]);
  });

  it("runs every installed bin command with --help and reports stdout", () => {
    runNodeMock.mockReturnValue({ status: 0, stdout: "Usage: fixture\n", stderr: "" });
    const consumer = makeConsumer();
    const binDirectory = path.join(consumer, "node_modules", ".bin");
    mkdirSync(binDirectory, { recursive: true });
    writeFileSync(path.join(binDirectory, "fixture-package"), "#!/usr/bin/env node\n");
    writeFileSync(path.join(binDirectory, "other"), "#!/usr/bin/env node\n");

    expect(() =>
      checkBinCommands(consumer, "fixture-package", {
        bin: { "": "./dist/cli.js", other: "./dist/other.js" },
      }),
    ).not.toThrow();
    expect(runNodeMock).toHaveBeenCalledTimes(2);
    expect(runNodeMock).toHaveBeenNthCalledWith(
      1,
      path.join(binDirectory, "fixture-package"),
      ["--help"],
      expect.objectContaining({ cwd: consumer }),
    );
    expect(stdoutSpy).toHaveBeenCalledWith("Usage: fixture\n");
  });

  it("reports a missing installed bin with its own smoke error", () => {
    const consumer = makeConsumer();

    expect(() =>
      checkBinCommands(consumer, "fixture-package", {
        bin: { "": "./dist/cli.js" },
      }),
    ).toThrow(/ERR_SMOKE_BIN_MISSING/);
  });

  it("reports a bin that exits unsuccessfully or prints no help", () => {
    runNodeMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });
    const consumer = makeConsumer();
    const binDirectory = path.join(consumer, "node_modules", ".bin");
    mkdirSync(binDirectory, { recursive: true });
    writeFileSync(path.join(binDirectory, "fixture-package"), "#!/usr/bin/env node\n");

    expect(() =>
      checkBinCommands(consumer, "fixture-package", {
        bin: { "": "./dist/cli.js" },
      }),
    ).toThrow(/ERR_SMOKE_BIN_FAILED/);
  });
});

/** Create an installed package directory, `name` possibly scoped. */
function installPackage(nodeModules: string, name: string): string {
  const dir = path.join(nodeModules, ...name.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name }));
  return dir;
}

describe("checkNoTranspiler", () => {
  it("passes for a consumer with no node_modules at all", () => {
    expect(() => checkNoTranspiler(makeConsumer())).not.toThrow();
  });

  it("passes when only unrelated packages are installed, nested and scoped", () => {
    const consumer = makeConsumer();
    const nodeModules = path.join(consumer, "node_modules");
    const root = installPackage(nodeModules, "charade");
    installPackage(path.join(root, "node_modules"), "skia-canvas");
    installPackage(path.join(root, "node_modules"), "@swc/helpers");
    mkdirSync(path.join(nodeModules, ".bin"), { recursive: true });
    writeFileSync(path.join(nodeModules, ".bin", "tsc"), "");

    expect(() => checkNoTranspiler(consumer)).not.toThrow();
  });

  it.each([
    ["typescript at the top level", ["typescript"]],
    ["tsx nested under a dependency", ["charade", "tsx"]],
    [
      "scoped @swc/core nested two levels down",
      ["charade", "skia-canvas", "@swc/core"],
    ],
  ])("throws ERR_SMOKE_CONSUMER_TRANSPILER for %s", (_label, chain) => {
    const consumer = makeConsumer();
    let nodeModules = path.join(consumer, "node_modules");
    for (const name of chain) {
      nodeModules = path.join(installPackage(nodeModules, name), "node_modules");
    }

    expect(() => checkNoTranspiler(consumer)).toThrow(/ERR_SMOKE_CONSUMER_TRANSPILER/);
  });

  it("names each forbidden package once, however often it is installed", () => {
    const consumer = makeConsumer();
    const nodeModules = path.join(consumer, "node_modules");
    installPackage(nodeModules, "esbuild");
    installPackage(
      path.join(installPackage(nodeModules, "a"), "node_modules"),
      "esbuild",
    );

    expect(() => checkNoTranspiler(consumer)).toThrow(/Subject: esbuild\n/);
  });

  it("forbids the compilers and loaders the issue names", () => {
    expect(TRANSPILER_PACKAGES).toEqual(
      expect.arrayContaining([
        "typescript",
        "tsx",
        "ts-node",
        "esbuild",
        "@swc/core",
        "jiti",
      ]),
    );
  });
});

describe("checkEmptyFolderFrame", () => {
  const manifest = { bin: { "fixture-package": "./dist/cli.js" } };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

  /** Fake `frame`: write `contents` beside the scene and answer with `result`. */
  function fakeFrame(result: RunResult, contents?: Buffer): void {
    runNodeMock.mockImplementation((_script, _args, options) => {
      if (contents !== undefined && options?.cwd !== undefined) {
        writeFileSync(path.join(options.cwd, "scene.frame-0.png"), contents);
      }
      return result;
    });
  }

  it("draws frame 0 of a .ts scene through node_modules/.bin and passes", () => {
    vi.stubEnv("NODE_OPTIONS", "--import tsx");
    fakeFrame(
      {
        status: 0,
        stdout: "wrote scene.frame-0.png\n0 errors, 0 warnings\n",
        // The 24.0–24.11 notice is expected on stderr and must not fail the step.
        stderr:
          "charade: Node 24.11.0 strips types as an experiment; use 24.12 or newer.\n",
      },
      png,
    );
    const consumer = makeConsumer();

    expect(() =>
      checkEmptyFolderFrame(consumer, "fixture-package", manifest),
    ).not.toThrow();
    expect(runNodeMock).toHaveBeenCalledWith(
      path.join(consumer, "node_modules", ".bin", "fixture-package"),
      ["frame", "scene.ts", "--at", "0"],
      expect.objectContaining({ cwd: consumer }),
    );
    const env = runNodeMock.mock.calls[0]?.[2]?.env;
    expect(env).toBeDefined();
    expect(env).not.toHaveProperty("NODE_OPTIONS");
    expect(stdoutSpy).toHaveBeenCalledWith(
      "wrote scene.frame-0.png\n0 errors, 0 warnings\n",
    );
  });

  it("writes a scene that imports the package by name and uses only erasable syntax", () => {
    fakeFrame({ status: 0, stdout: "wrote scene.frame-0.png\n", stderr: "" }, png);
    const consumer = makeConsumer();

    checkEmptyFolderFrame(consumer, "fixture-package", manifest);

    const source = readFileSync(path.join(consumer, "scene.ts"), "utf8");
    expect(source).toContain('import { scene } from "fixture-package";');
    expect(source).toContain("export default scene(");
    expect(source).not.toMatch(/\benum\b|\bnamespace\b/);
  });

  it("names the command after the unscoped part of a scoped package", () => {
    fakeFrame({ status: 0, stdout: "wrote scene.frame-0.png\n", stderr: "" }, png);
    const consumer = makeConsumer();

    checkEmptyFolderFrame(consumer, "@scope/fixture-package", {
      bin: { "fixture-package": "./dist/cli.js" },
    });

    expect(runNodeMock).toHaveBeenCalledWith(
      path.join(consumer, "node_modules", ".bin", "fixture-package"),
      expect.any(Array),
      expect.anything(),
    );
  });

  it.each([
    ["the package has no bin", {}],
    ["no command carries the package's name", { bin: { other: "./dist/other.js" } }],
  ])("skips without spawning anything when %s", (_label, skipped) => {
    const consumer = makeConsumer();

    expect(() =>
      checkEmptyFolderFrame(consumer, "fixture-package", skipped),
    ).not.toThrow();
    expect(runNodeMock).not.toHaveBeenCalled();
  });

  it("throws ERR_SMOKE_FRAME_FAILED quoting the command's own error code", () => {
    fakeFrame({
      status: 2,
      stdout: "",
      stderr:
        "error ERR_LOAD_PACKAGE_NOT_FOUND: Cannot find package fixture-package.\n",
    });
    const consumer = makeConsumer();

    expect(() => checkEmptyFolderFrame(consumer, "fixture-package", manifest)).toThrow(
      /ERR_SMOKE_FRAME_FAILED[\s\S]*exit 2\nerror ERR_LOAD_PACKAGE_NOT_FOUND/,
    );
  });

  it("throws ERR_SMOKE_FRAME_MISSING when the command exits 0 but writes no PNG", () => {
    fakeFrame({ status: 0, stdout: "wrote scene.frame-0.png\n", stderr: "" });
    const consumer = makeConsumer();

    expect(() => checkEmptyFolderFrame(consumer, "fixture-package", manifest)).toThrow(
      /ERR_SMOKE_FRAME_MISSING/,
    );
  });

  it("does not accept a PNG left over from an earlier run", () => {
    fakeFrame({ status: 0, stdout: "wrote scene.frame-0.png\n", stderr: "" });
    const consumer = makeConsumer();
    writeFileSync(path.join(consumer, "scene.frame-0.png"), png);

    expect(() => checkEmptyFolderFrame(consumer, "fixture-package", manifest)).toThrow(
      /ERR_SMOKE_FRAME_MISSING/,
    );
  });

  it.each([
    ["an empty file", Buffer.alloc(0)],
    ["a JPEG", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])],
  ])(
    "throws ERR_SMOKE_FRAME_NOT_PNG when the file written is %s",
    (_label, contents) => {
      fakeFrame(
        { status: 0, stdout: "wrote scene.frame-0.png\n", stderr: "" },
        contents,
      );
      const consumer = makeConsumer();

      expect(() =>
        checkEmptyFolderFrame(consumer, "fixture-package", manifest),
      ).toThrow(/ERR_SMOKE_FRAME_NOT_PNG/);
    },
  );

  it("throws ERR_SMOKE_FRAME_UNREPORTED when stdout does not name the PNG", () => {
    fakeFrame({ status: 0, stdout: "0 errors, 0 warnings\n", stderr: "" }, png);
    const consumer = makeConsumer();

    expect(() => checkEmptyFolderFrame(consumer, "fixture-package", manifest)).toThrow(
      /ERR_SMOKE_FRAME_UNREPORTED/,
    );
  });
});

describe("checkRequireInterop", () => {
  it("passes when require() resolves the package and its package.json subpath", () => {
    runNodeMock.mockReturnValue({ status: 0, stdout: "  ok\n", stderr: "" });
    const consumer = makeConsumer();

    expect(() => checkRequireInterop(consumer, "fixture-package")).not.toThrow();
    expect(stdoutSpy).toHaveBeenCalledWith("  ok\n");
  });

  it("throws ERR_SMOKE_REQUIRE_FAILED when require() cannot resolve the package", () => {
    runNodeMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "ERR_PACKAGE_PATH_NOT_EXPORTED",
    });
    const consumer = makeConsumer();

    expect(() => checkRequireInterop(consumer, "fixture-package")).toThrow(
      /ERR_SMOKE_REQUIRE_FAILED/,
    );
  });
});

describe("unexportedEntryPath", () => {
  it("returns the file behind the root export, which is not itself a subpath", () => {
    expect(
      unexportedEntryPath({
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./package.json": "./package.json",
        },
      }),
    ).toBe("dist/index.js");
  });

  it("skips a packed file that the manifest also exports by that exact path", () => {
    // Such a path is public, so probing it would assert the opposite of the
    // contract.
    expect(
      unexportedEntryPath({
        exports: {
          ".": "./dist/index.js",
          "./dist/index.js": "./dist/index.js",
        },
        bin: { tool: "./dist/cli.js" },
      }),
    ).toBe("dist/cli.js");
  });

  it("returns undefined when the manifest points at no packed .js file", () => {
    expect(unexportedEntryPath({ types: "./dist/index.d.ts" })).toBeUndefined();
  });
});

describe("checkDeepImportBlocked", () => {
  it("passes when the deep import is correctly refused", () => {
    runNodeMock.mockReturnValue({ status: 0, stdout: "  refused\n", stderr: "" });
    const consumer = makeConsumer();

    expect(() =>
      checkDeepImportBlocked(consumer, "fixture-package", "dist/index.js"),
    ).not.toThrow();
  });

  it("throws ERR_SMOKE_DEEP_IMPORT_ALLOWED when the packed file is reachable", () => {
    runNodeMock.mockReturnValue({ status: 1, stdout: "", stderr: "AssertionError" });
    const consumer = makeConsumer();

    expect(() =>
      checkDeepImportBlocked(consumer, "fixture-package", "dist/index.js"),
    ).toThrow(/ERR_SMOKE_DEEP_IMPORT_ALLOWED/);
  });

  it("skips the check, without spawning anything, when there is no path to probe", () => {
    const consumer = makeConsumer();

    expect(() =>
      checkDeepImportBlocked(consumer, "fixture-package", undefined),
    ).not.toThrow();
    expect(runNodeMock).not.toHaveBeenCalled();
  });
});

describe("compileTypeScriptConsumer", () => {
  it("returns the tsc --listFiles output on success", () => {
    runNodeMock.mockReturnValue({ status: 0, stdout: "/some/file.d.ts\n", stderr: "" });
    const consumer = makeConsumer();

    expect(compileTypeScriptConsumer(consumer, "fixture-package", "NodeNext")).toBe(
      "/some/file.d.ts\n",
    );
    expect(runNodeMock).toHaveBeenCalledWith(
      expect.stringContaining("typescript"),
      ["-p", "tsconfig.json", "--listFiles"],
      expect.objectContaining({ cwd: path.join(consumer, "ts-nodenext") }),
    );
  });

  it("throws ERR_SMOKE_CONSUMER_TSC_FAILED when the consumer does not compile", () => {
    runNodeMock.mockReturnValue({ status: 2, stdout: "", stderr: "error TS2307" });
    const consumer = makeConsumer();

    expect(() =>
      compileTypeScriptConsumer(consumer, "fixture-package", "NodeNext"),
    ).toThrow(/ERR_SMOKE_CONSUMER_TSC_FAILED/);
  });
});

describe("isUniversalProfile", () => {
  it("reflects this repository's own profile", () => {
    // tsconfig.build.json's compilerOptions.types is bootstrap's single
    // source of truth for the profile (see isUniversalProfile's doc comment),
    // and package.json#engines.node is deleted only for universal-library, so
    // the two must always agree on whichever profile this checkout — or a
    // repository generated from it — actually is.
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { engines?: { node?: string } };
    expect(isUniversalProfile()).toBe(manifest.engines?.node === undefined);
  });
});

describe("checkTypeScriptConsumers", () => {
  it("compiles the Bundler consumer only for this repository's own profile", () => {
    runNodeMock.mockReturnValue({
      status: 0,
      stdout: [
        path.join(repoRoot, "node_modules", "fixture-package", "dist", "index.d.ts"),
        path.join(repoRoot, "node_modules", "typescript", "lib", "lib.es2023.d.ts"),
      ].join("\n"),
      stderr: "",
    });
    const consumer = makeConsumer();

    expect(() => checkTypeScriptConsumers(consumer, "fixture-package")).not.toThrow();
    // Node profile: only the NodeNext consumer compiles. universal-library
    // additionally compiles a Bundler-resolution consumer.
    expect(runNodeMock).toHaveBeenCalledTimes(isUniversalProfile() ? 2 : 1);
  });

  it("throws ERR_SMOKE_CONSUMER_READ_REPOSITORY when the compiler read this repository's src/", () => {
    runNodeMock.mockReturnValue({
      status: 0,
      stdout: [
        path.join(repoRoot, "src", "index.ts"),
        path.join(repoRoot, "node_modules", "fixture-package", "dist", "index.d.ts"),
      ].join("\n"),
      stderr: "",
    });
    const consumer = makeConsumer();

    expect(() => checkTypeScriptConsumers(consumer, "fixture-package")).toThrow(
      /ERR_SMOKE_CONSUMER_READ_REPOSITORY/,
    );
  });

  it("throws ERR_SMOKE_CONSUMER_READ_REPOSITORY when the compiler read this repository's dist/", () => {
    runNodeMock.mockReturnValue({
      status: 0,
      stdout: path.join(repoRoot, "dist", "index.js"),
      stderr: "",
    });
    const consumer = makeConsumer();

    expect(() => checkTypeScriptConsumers(consumer, "fixture-package")).toThrow(
      /ERR_SMOKE_CONSUMER_READ_REPOSITORY/,
    );
  });

  it("propagates ERR_SMOKE_CONSUMER_TSC_FAILED when the NodeNext consumer fails to compile", () => {
    runNodeMock.mockReturnValue({ status: 2, stdout: "", stderr: "error TS2307" });
    const consumer = makeConsumer();

    expect(() => checkTypeScriptConsumers(consumer, "fixture-package")).toThrow(
      /ERR_SMOKE_CONSUMER_TSC_FAILED/,
    );
  });
});

describe("publicSubpaths", () => {
  it("returns the root only when the manifest declares no exports field", () => {
    expect(publicSubpaths({ name: "fixture-package" })).toEqual([""]);
  });

  it("returns the root only when exports is not an object", () => {
    expect(publicSubpaths({ exports: "./index.js" })).toEqual([""]);
  });

  it("returns the root only for a conditions-only exports map with no '.' key", () => {
    expect(publicSubpaths({ exports: { import: "./index.js" } })).toEqual([""]);
  });

  it("maps '.' to the empty string and sorts additional subpaths", () => {
    expect(
      publicSubpaths({
        exports: {
          "./sub": "./dist/sub.js",
          ".": "./dist/index.js",
          "./a": "./dist/a.js",
        },
      }),
    ).toEqual(["", "/a", "/sub"]);
  });

  it("excludes a wildcard pattern and a .json subpath", () => {
    expect(
      publicSubpaths({
        exports: {
          ".": "./dist/index.js",
          "./*": "./dist/*.js",
          "./package.json": "./package.json",
        },
      }),
    ).toEqual([""]);
  });
});

describe("installConsumer", () => {
  it("writes a consumer manifest and installs the tarball, returning the consumer directory", () => {
    runNodeMock.mockReturnValue({
      status: 0,
      stdout: "added 0 packages\n",
      stderr: "",
    });
    const workspace = makeConsumer();

    const consumer = installConsumer(workspace, "/pack/fixture-package-1.0.0.tgz");

    expect(consumer).toBe(path.join(workspace, "consumer"));
    expect(
      JSON.parse(readFileSync(path.join(consumer, "package.json"), "utf8")) as unknown,
    ).toMatchObject({ name: "smoke-consumer", type: "module" });
    expect(runNodeMock).toHaveBeenCalledWith(
      expect.stringContaining("npm"),
      expect.arrayContaining([
        "install",
        "/pack/fixture-package-1.0.0.tgz",
        "--ignore-scripts",
        "--legacy-peer-deps",
      ]),
      expect.objectContaining({ cwd: consumer }),
    );
  });

  it("throws ERR_SMOKE_INSTALL_FAILED when npm install fails", () => {
    runNodeMock.mockReturnValue({ status: 1, stdout: "", stderr: "network error" });
    const workspace = makeConsumer();

    expect(() => installConsumer(workspace, "/pack/fixture-package-1.0.0.tgz")).toThrow(
      /ERR_SMOKE_INSTALL_FAILED/,
    );
  });
});

// --- main ---------------------------------------------------------------------
//
// main() reads its own repository's package.json for the name of the package
// under test, then packs/installs/checks a tarball named on the command
// line. Building a small, synthetic gzip tarball here (rather than a real
// `npm pack`) keeps checkTarballContents' real, unmocked checks fast; the
// install and every subsequent check still go through runNode, mocked at the
// subprocess boundary exactly as the rest of this file does.

/** Build one 512-byte ustar header block with a valid checksum. */
function tarHeader(name: string, size: number): Buffer {
  const block = Buffer.alloc(512);
  const octal = (value: number, width: number): string =>
    `${value.toString(8).padStart(width - 1, "0")}\0`;

  block.write(name, 0, 100, "utf8");
  block.write(octal(0o644, 8), 100, 8, "ascii");
  block.write(octal(0, 8), 108, 8, "ascii");
  block.write(octal(0, 8), 116, 8, "ascii");
  block.write(octal(size, 12), 124, 12, "ascii");
  block.write(octal(0, 12), 136, 12, "ascii");
  block.write("        ", 148, 8, "ascii");
  block.write("0", 156, 1, "ascii");
  block.write("ustar\0", 257, 6, "ascii");
  block.write("00", 263, 2, "ascii");

  let sum = 0;
  for (const byte of block) {
    sum += byte;
  }
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return block;
}

/** Pad entry data out to the next 512-byte boundary. */
function tarBody(data: Buffer): Buffer {
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return padded;
}

/** Header plus padded body for one regular file, `package/`-prefixed as npm packs. */
function tarFile(name: string, contents: string): Buffer[] {
  const data = Buffer.from(contents, "utf8");
  return [tarHeader(`package/${name}`, data.length), tarBody(data)];
}

/** Write a minimal, valid gzip tarball satisfying checkTarballContents. */
function writeFixtureTarball(destination: string, manifest: unknown): void {
  const blocks = [
    ...tarFile("package.json", JSON.stringify(manifest)),
    ...tarFile("README.md", "# fixture\n"),
    ...tarFile("LICENSE", "MIT\n"),
    ...tarFile("dist/index.js", "export const a = 1;\n"),
    ...tarFile("dist/index.d.ts", "export declare const a: 1;\n"),
  ];
  writeFileSync(destination, gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)])));
}

describe("main", () => {
  let workspace: string;
  let errorSpy: MockInstance<typeof consoleModule.error>;

  beforeEach(() => {
    workspace = makeConsumer();
    errorSpy = vi.spyOn(consoleModule, "error").mockImplementation(() => undefined);
  });

  it("returns 2 without touching runNode when the arguments are wrong", () => {
    expect(main([])).toBe(2);
    expect(runNodeMock).not.toHaveBeenCalled();
  });

  it("returns 1 and reports ERR_SMOKE_UNEXPECTED when the tarball cannot be read", () => {
    const missing = path.join(workspace, "never-packed.tgz");

    expect(main(["--tarball", missing])).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("ERR_SMOKE_UNEXPECTED"),
    );
    expect(runNodeMock).not.toHaveBeenCalled();
  });

  it("returns 1 and reports ERR_SMOKE_TARBALL_CONTENTS without ever installing a missing-LICENSE tarball", () => {
    const tarball = path.join(workspace, "no-license.tgz");
    writeFileSync(
      tarball,
      gzipSync(
        Buffer.concat([
          ...tarFile("package.json", JSON.stringify({ name: "fixture" })),
          ...tarFile("README.md", "# fixture\n"),
          ...tarFile("dist/index.js", "export const a = 1;\n"),
          Buffer.alloc(1024),
        ]),
      ),
    );

    expect(main(["--tarball", tarball])).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("ERR_SMOKE_TARBALL_CONTENTS"),
    );
    expect(runNodeMock).not.toHaveBeenCalled();
  });

  it("installs, checks and returns 0 for a well-formed tarball", () => {
    const packageName = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { name?: string };
    const name = packageName.name;
    if (name === undefined) {
      throw new Error("this repository's own package.json has no name");
    }

    const tarball = path.join(workspace, "fixture-package-1.0.0.tgz");
    const runtimeDependency = "smoke-runtime-helper";
    writeFixtureTarball(tarball, {
      name: "smoke-fixture-package",
      version: "1.0.0",
      dependencies: { [runtimeDependency]: "1.0.0" },
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    });

    let installArgs: readonly string[] = [];

    // Simulate npm install's package and runtime-dependency side effects since
    // runNode never actually runs npm; every other check just needs to see exit
    // 0. The nested location mirrors --install-strategy=nested, which is what
    // makes this a dependency resolved for the installed package rather than an
    // undeclared top-level one.
    runNodeMock.mockImplementation((_script, args, options) => {
      if (args[0] === "install" && options?.cwd !== undefined) {
        installArgs = args;
        const installed = path.join(options.cwd, "node_modules", name);
        mkdirSync(installed, { recursive: true });
        writeFileSync(
          path.join(installed, "package.json"),
          JSON.stringify({
            name,
            version: "0.0.0",
            dependencies: { [runtimeDependency]: "1.0.0" },
            exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
          }),
        );
        const dependency = path.join(installed, "node_modules", runtimeDependency);
        mkdirSync(dependency, { recursive: true });
        writeFileSync(
          path.join(dependency, "package.json"),
          JSON.stringify({ name: runtimeDependency, version: "1.0.0" }),
        );
      }
      return { status: 0, stdout: "  ok\n", stderr: "" };
    });

    const exitCode = main(["--tarball", tarball]);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitCode).toBe(0);
    // Asserting the file the mock itself just wrote would only test the mock.
    // What this case can actually protect is the production argv: the nested
    // layout is the reason a declared runtime dependency has to resolve under
    // the installed package instead of being hoisted next to it, so dropping
    // the flag must fail here rather than quietly weakening the smoke test.
    expect(installArgs).toContain("--install-strategy=nested");
    // install + runtime imports + require interop + TypeScript consumer(s)
    // (an extra Bundler consumer only for the universal-library profile) +
    // the deep-import check.
    expect(runNodeMock).toHaveBeenCalledTimes(isUniversalProfile() ? 6 : 5);
  });

  it("runs the empty-folder frame step for a package with its own command", () => {
    const name = (
      JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
        name?: string;
      }
    ).name;
    if (name === undefined) {
      throw new Error("this repository's own package.json has no name");
    }
    const command = name.split("/").at(-1) ?? name;
    const tarball = path.join(workspace, "fixture-package-1.0.0.tgz");
    const packed = {
      name,
      version: "1.0.0",
      bin: { [command]: "./dist/index.js" },
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    };
    writeFixtureTarball(tarball, packed);

    const calls: string[] = [];
    runNodeMock.mockImplementation((_script, args, options) => {
      const cwd = options?.cwd ?? "";
      calls.push(args[0] ?? "");
      if (args[0] === "install") {
        const installed = path.join(cwd, "node_modules", name);
        mkdirSync(installed, { recursive: true });
        writeFileSync(path.join(installed, "package.json"), JSON.stringify(packed));
        mkdirSync(path.join(cwd, "node_modules", ".bin"), { recursive: true });
        writeFileSync(path.join(cwd, "node_modules", ".bin", command), "");
      }
      if (args[0] === "frame") {
        writeFileSync(
          path.join(cwd, "scene.frame-0.png"),
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        );
        return { status: 0, stdout: "wrote scene.frame-0.png\n", stderr: "" };
      }
      return { status: 0, stdout: "  ok\n", stderr: "" };
    });

    expect(main(["--tarball", tarball])).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(calls.slice(0, 4)).toEqual(["install", "", "--help", "frame"]);
  });
});
