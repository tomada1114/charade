import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createResolveHook,
  installResolveHook,
  localVersion,
  ownVersion,
  type ResolveFailure,
  versionNotice,
} from "../src/export/hook.js";
import {
  classifyLoadError,
  loadScene,
  packageNameOf,
  sceneFrom,
} from "../src/export/loader.js";
import { scene } from "../src/index.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function write(root: string, file: string, text: string): string {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
  return target;
}

/** Node's own error shapes, as measured on Node 24.22.1. */
function nodeError(
  code: string | undefined,
  extra: Record<string, unknown> = {},
  Kind: typeof Error = Error,
): Error {
  return Object.assign(new Kind("message wording is not read"), { code }, extra);
}

describe("createResolveHook", () => {
  const own = "file:///own/dist/index.js";
  const context = { conditions: [], importAttributes: {}, parentURL: "file:///s/a.ts" };

  it("maps the exact specifier charade to the CLI's own entry", () => {
    const hook = createResolveHook(own, []);
    expect(
      hook("charade", context, () => {
        throw new Error("must not be asked");
      }),
    ).toEqual({ url: own, format: "module", shortCircuit: true });
  });

  it.each(["charade/package.json", "charade-x", "./charade", "Charade"])(
    "passes %s on to Node",
    (specifier) => {
      const hook = createResolveHook(own, []);
      expect(hook(specifier, context, (s) => ({ url: `file:///next/${s}` }))).toEqual({
        url: `file:///next/${specifier}`,
      });
    },
  );

  it("records a failed resolution and rethrows the same error", () => {
    const failures: ResolveFailure[] = [];
    const hook = createResolveHook(own, failures);
    const error = nodeError("ERR_MODULE_NOT_FOUND");
    expect(() =>
      hook("./helper.js", context, () => {
        throw error;
      }),
    ).toThrow(error);
    expect(failures).toEqual([
      { specifier: "./helper.js", parentURL: "file:///s/a.ts", error },
    ]);
  });
});

describe("installResolveHook", () => {
  it("maps charade for require until it is deregistered", () => {
    const root = mkdtempSync(path.join(tmpdir(), "charade-hook-"));
    try {
      const entry = write(root, "own/index.js", "");
      const hook = installResolveHook(pathToFileURL(entry).href);
      const require = createRequire(path.join(root, "x.js"));
      try {
        expect(require.resolve("charade")).toBe(entry);
      } finally {
        hook.deregister();
      }
      expect(() => require.resolve("charade-not-installed")).toThrow();
      expect(hook.failures).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("versions", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "charade-version-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads this copy's version from its manifest", () => {
    expect(ownVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("reads the version the scene's folder would resolve", () => {
    write(
      root,
      "node_modules/charade/package.json",
      JSON.stringify({ name: "charade", version: "9.9.9" }),
    );
    expect(localVersion(path.join(root, "scene.ts"))).toBe("9.9.9");
  });

  it("finds no local version in a folder without charade", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "charade-empty-"));
    try {
      expect(localVersion(path.join(empty, "scene.ts"))).toBeUndefined();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("finds no version in a manifest without one", () => {
    const folder = path.join(root, "bare");
    write(
      folder,
      "node_modules/charade/package.json",
      JSON.stringify({ name: "charade" }),
    );
    expect(localVersion(path.join(folder, "scene.ts"))).toBeUndefined();
  });

  it.each([
    { label: "no local copy", local: undefined },
    { label: "the same version", local: "1.0.0" },
  ])("owes no notice for $label", ({ local }) => {
    expect(versionNotice(local, "1.0.0")).toBeUndefined();
  });

  it("names both versions when they differ", () => {
    const line = versionNotice("2.0.0", "1.0.0");
    expect(line).toContain("2.0.0");
    expect(line).toContain("1.0.0");
    expect(line).not.toContain("\n");
  });
});

describe("classifyLoadError", () => {
  const exists = (files: readonly string[]) => (file: string) => files.includes(file);

  it.each([
    {
      label: "a .ts helper imported as .js",
      specifier: "./helper.js",
      file: "/s/helper.js",
      present: ["/s/helper.ts"],
      suggestion: "./helper.ts",
    },
    {
      label: "a .mts helper imported as .mjs",
      specifier: "./h.mjs",
      file: "/s/h.mjs",
      present: ["/s/h.mts"],
      suggestion: "./h.mts",
    },
    {
      label: "a helper imported without an extension",
      specifier: "./helper",
      file: "/s/helper",
      present: ["/s/helper.ts"],
      suggestion: "./helper.ts",
    },
    {
      label: "a folder imported without its index",
      specifier: "./lib/",
      file: "/s/lib",
      present: ["/s/lib/index.ts"],
      suggestion: "./lib/index.ts",
    },
  ])("names the .ts path for $label", ({ specifier, file, present, suggestion }) => {
    const error = nodeError("ERR_MODULE_NOT_FOUND", { url: pathToFileURL(file).href });
    const failures = [{ specifier, parentURL: "file:///s/scene.ts", error }];
    expect(
      classifyLoadError(error, { failures, exists: exists(present) }),
    ).toMatchObject({
      code: "ERR_LOAD_HELPER_EXTENSION",
      specifier,
      suggestion,
    });
  });

  it.each([
    { label: "no .ts sibling", file: "/s/gone.js" },
    { label: "an extension with no TypeScript twin", file: "/s/data.json" },
  ])("reports a missing file for $label", ({ file }) => {
    const error = nodeError("ERR_MODULE_NOT_FOUND", { url: pathToFileURL(file).href });
    expect(
      classifyLoadError(error, { failures: [], exists: () => false }),
    ).toMatchObject({
      code: "ERR_LOAD_MODULE_NOT_FOUND",
      specifier: file,
    });
  });

  it.each([
    { label: "a subpath import", specifier: "#lib/x", file: "/s/lib/x.js" },
    { label: "a package main", specifier: "pkg", file: "/s/node_modules/pkg/index.js" },
  ])(
    "suggests no .ts spelling for $label mapped to a missing file",
    ({ specifier, file }) => {
      const error = nodeError("ERR_MODULE_NOT_FOUND", {
        url: pathToFileURL(file).href,
      });
      const failures = [{ specifier, parentURL: "file:///s/scene.ts", error }];
      expect(classifyLoadError(error, { failures, exists: () => true })).toMatchObject({
        code: "ERR_LOAD_MODULE_NOT_FOUND",
        specifier,
      });
    },
  );

  it.each([
    { specifier: "lodash", name: "lodash" },
    { specifier: "lodash/fp", name: "lodash" },
    { specifier: "@scope/pkg/sub", name: "@scope/pkg" },
  ])("reports a missing package for $specifier", ({ specifier, name }) => {
    const error = nodeError("ERR_MODULE_NOT_FOUND");
    const failures = [{ specifier, parentURL: "file:///s/scene.ts", error }];
    expect(classifyLoadError(error, { failures, exists: () => false })).toMatchObject({
      code: "ERR_LOAD_PACKAGE_NOT_FOUND",
      packageName: name,
    });
  });

  it("reports a missing package the hook did not see", () => {
    const error = nodeError("ERR_MODULE_NOT_FOUND");
    expect(
      classifyLoadError(error, { failures: [], exists: () => false }),
    ).toMatchObject({ code: "ERR_LOAD_PACKAGE_NOT_FOUND", packageName: undefined });
  });

  it.each([
    {
      label: "syntax that needs transformation",
      error: nodeError("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX", {}, SyntaxError),
      code: "ERR_LOAD_UNSUPPORTED_SYNTAX",
    },
    {
      label: "TypeScript under node_modules",
      error: nodeError("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING"),
      code: "ERR_LOAD_TS_IN_NODE_MODULES",
    },
    {
      label: "invalid TypeScript",
      error: nodeError("ERR_INVALID_TYPESCRIPT_SYNTAX", {}, SyntaxError),
      code: "ERR_LOAD_FAILED",
    },
    {
      label: "an unknown extension",
      error: nodeError("ERR_UNKNOWN_FILE_EXTENSION", {}, TypeError),
      code: "ERR_LOAD_FAILED",
    },
    {
      label: "a JavaScript syntax error",
      error: new SyntaxError("Unexpected token ';'"),
      code: "ERR_LOAD_FAILED",
    },
    {
      label: "a scene that throws",
      error: new Error("thrown by the scene"),
      code: "ERR_LOAD_FAILED",
    },
    { label: "a thrown non-error", error: "a string", code: "ERR_LOAD_FAILED" },
  ])("classifies $label", ({ error, code }) => {
    expect(classifyLoadError(error, { failures: [], exists: () => false }).code).toBe(
      code,
    );
  });

  it("reports a type imported as a value, with its name", () => {
    const error = new SyntaxError(
      "The requested module './types.ts' does not provide an export named 'Pose'",
    );
    expect(
      classifyLoadError(error, { failures: [], exists: () => false }),
    ).toMatchObject({
      code: "ERR_LOAD_MISSING_EXPORT",
      exportName: "Pose",
    });
  });

  it("wraps an error the scene throws, keeping it as the cause", () => {
    let caught: unknown;
    try {
      scene({ rows: 1 }, (stage) => {
        stage.row(5);
      });
    } catch (error) {
      caught = error;
    }
    const classified = classifyLoadError(caught, { failures: [], exists: () => false });
    expect(classified.code).toBe("ERR_LOAD_FAILED");
    expect(classified.cause).toBe(caught);
  });
});

describe("packageNameOf", () => {
  it.each([
    ["a", "a"],
    ["a/b/c", "a"],
    ["@s/p", "@s/p"],
    ["@s/p/q", "@s/p"],
  ])("reads %s as %s", (specifier, name) => {
    expect(packageNameOf(specifier)).toBe(name);
  });
});

describe("sceneFrom", () => {
  it("returns the default export when it is a scene", () => {
    const built = scene({}, () => undefined);
    expect(sceneFrom({ default: built })).toBe(built);
  });

  it.each([
    { label: "no default export", module: { scene: 1 } },
    { label: "a default of another kind", module: { default: { kind: "other" } } },
    { label: "a default function", module: { default: () => undefined } },
    { label: "a null default", module: { default: null } },
    { label: "a non-object module", module: 3 },
  ])("rejects $label", ({ module }) => {
    expect(() => sceneFrom(module)).toThrow(
      expect.objectContaining({ code: "ERR_LOAD_NOT_A_SCENE" }),
    );
  });
});

describe("loadScene", () => {
  const install = () => ({ failures: [], deregister: () => undefined });
  const built = scene({}, () => undefined);

  it("reports a scene file that does not exist", async () => {
    await expect(
      loadScene("missing.ts", {
        notice: () => undefined,
        install,
        exists: () => false,
      }),
    ).rejects.toMatchObject({ code: "ERR_LOAD_SCENE_NOT_FOUND", path: "missing.ts" });
  });

  it("reports a folder given as the scene path as no scene file", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "charade-folder-"));
    try {
      await expect(
        loadScene(folder, { notice: () => undefined, install }),
      ).rejects.toMatchObject({ code: "ERR_LOAD_SCENE_NOT_FOUND", path: folder });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("imports the scene by URL and returns its default export", async () => {
    const urls: string[] = [];
    const result = await loadScene("/s/scene.ts", {
      notice: () => undefined,
      install,
      exists: () => true,
      localVersion: () => undefined,
      importModule: (url) => {
        urls.push(url);
        return Promise.resolve({ default: built });
      },
    });
    expect(result).toBe(built);
    expect(urls).toEqual([pathToFileURL(path.resolve("/s/scene.ts")).href]);
  });

  it("prints the version notice once before importing", async () => {
    const notices: string[] = [];
    await loadScene("/s/scene.ts", {
      notice: (line) => notices.push(line),
      install,
      exists: () => true,
      ownVersion: "1.0.0",
      localVersion: () => "2.0.0",
      importModule: () => Promise.resolve({ default: built }),
    });
    expect(notices).toHaveLength(1);
  });

  it("translates an import failure", async () => {
    await expect(
      loadScene("/s/scene.ts", {
        notice: () => undefined,
        install,
        exists: () => true,
        localVersion: () => undefined,
        importModule: () =>
          Promise.reject(nodeError("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX")),
      }),
    ).rejects.toMatchObject({ code: "ERR_LOAD_UNSUPPORTED_SYNTAX" });
  });
});

// The resolve hook does not reach an in-process import under vitest, so these run the
// built CLI in a child. It is built into a temporary package folder, laid out as an
// installed copy (`package.json` beside `dist/`), with no node_modules anywhere above:
// a `--help` that loaded skia-canvas would fail there.
describe("the built CLI in a child process", () => {
  let root: string;
  let cli: string;
  let ownIndex: string;
  let work: string;

  beforeAll(() => {
    // Real path: the CLI's own URL comes from import.meta.url, which Node gives with
    // symlinks such as macOS's /var resolved.
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "charade-loader-")));
    const pkg = path.join(root, "pkg");
    mkdirSync(pkg);
    copyFileSync(path.join(repoRoot, "package.json"), path.join(pkg, "package.json"));
    execFileSync(
      process.execPath,
      [
        path.join(repoRoot, "node_modules/typescript/bin/tsc"),
        "-p",
        path.join(repoRoot, "tsconfig.build.json"),
        "--outDir",
        path.join(pkg, "dist"),
      ],
      { cwd: repoRoot, stdio: "pipe" },
    );
    cli = path.join(pkg, "dist/cli.js");
    ownIndex = pathToFileURL(path.join(pkg, "dist/index.js")).href;
    work = path.join(root, "work");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  function run(...args: string[]): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: work,
      encoding: "utf8",
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  function check(sceneFile: string): {
    code: string;
    stderr: string;
    status: number | null;
  } {
    const result = run("check", sceneFile, "--json");
    const document = JSON.parse(result.stdout) as {
      error: { code: string; fix: string };
    };
    return { code: document.error.code, stderr: result.stderr, status: result.status };
  }

  const SCENE =
    'import { scene } from "charade";\nexport default scene({}, () => {});\n';

  it("prints help without loading skia-canvas", () => {
    mkdirSync(work, { recursive: true });
    const result = run("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: charade <command>");
  });

  it("resolves charade to its own copy from every importer, despite another version (R3)", () => {
    write(
      work,
      "node_modules/charade/package.json",
      JSON.stringify({
        name: "charade",
        version: "9.9.9",
        type: "module",
        exports: { ".": "./index.js", "./package.json": "./package.json" },
      }),
    );
    write(
      work,
      "node_modules/charade/index.js",
      'throw new Error("LOCAL_COPY_IMPORTED");\n',
    );
    write(
      work,
      "node_modules/relay/package.json",
      JSON.stringify({ name: "relay", type: "module", exports: "./index.js" }),
    );
    write(work, "node_modules/relay/index.js", 'export { scene } from "charade";\n');
    write(
      work,
      "scene.ts",
      [
        'import { scene } from "relay";',
        'import { scene as direct } from "charade";',
        'console.error(`resolved ${import.meta.resolve("charade")}`);',
        "if (scene !== direct) throw new Error('two copies');",
        "export default scene({}, () => {});",
        "",
      ].join("\n"),
    );

    const result = check("scene.ts");
    expect(result.code).toBe("ERR_CLI_NOT_IMPLEMENTED");
    expect(result.stderr).toContain(`resolved ${ownIndex}`);
    expect(result.stderr).not.toContain("LOCAL_COPY_IMPORTED");
    const notices = result.stderr.split("\n").filter((line) => line.includes("9.9.9"));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain(ownVersion());
  });

  it("prints no version notice in a folder without charade", () => {
    write(work, "scene.ts", SCENE);
    const result = check("scene.ts");
    expect(result.code).toBe("ERR_CLI_NOT_IMPLEMENTED");
    expect(result.stderr).not.toContain("installed");
  });

  it.each([
    {
      label: "a helper imported as .js",
      files: { "helper.ts": "export const helper = 1;\n" },
      scene: 'import { helper } from "./helper.js";\n',
      code: "ERR_LOAD_HELPER_EXTENSION",
      fix: '"./helper.ts"',
    },
    {
      label: "a helper imported without an extension",
      files: { "helper.ts": "export const helper = 1;\n" },
      scene: 'import { helper } from "./helper";\n',
      code: "ERR_LOAD_HELPER_EXTENSION",
      fix: '"./helper.ts"',
    },
    {
      label: "a missing package",
      files: {},
      scene: 'import pad from "left-pad-not-installed";\n',
      code: "ERR_LOAD_PACKAGE_NOT_FOUND",
      fix: "npm install left-pad-not-installed",
    },
    {
      label: "an enum",
      files: {},
      scene: "enum Mood { Happy }\n",
      code: "ERR_LOAD_UNSUPPORTED_SYNTAX",
      fix: "enum",
    },
    {
      label: "a parameter property",
      files: {},
      scene: "class A { constructor(private x: number) {} }\n",
      code: "ERR_LOAD_UNSUPPORTED_SYNTAX",
      fix: "parameter property",
    },
    {
      label: "a runtime namespace",
      files: {},
      scene: "namespace N { export const a = 1; }\n",
      code: "ERR_LOAD_UNSUPPORTED_SYNTAX",
      fix: "namespace",
    },
    {
      label: "a type imported without import type",
      files: { "types.ts": "export interface Pose { a: number }\n" },
      scene: 'import { Pose } from "./types.ts";\n',
      code: "ERR_LOAD_MISSING_EXPORT",
      fix: "import type { Pose }",
    },
    {
      label: "a .ts file under node_modules",
      files: {
        "node_modules/tspkg/package.json": JSON.stringify({
          name: "tspkg",
          type: "module",
          exports: "./index.ts",
        }),
        "node_modules/tspkg/index.ts": "export const a: number = 1;\n",
      },
      scene: 'import { a } from "tspkg";\n',
      code: "ERR_LOAD_TS_IN_NODE_MODULES",
      fix: "node_modules",
    },
  ])(
    "reports $label with a distinct code and a fix (R4)",
    ({ files, scene: head, code, fix }) => {
      for (const [file, text] of Object.entries(files)) {
        write(work, file, text);
      }
      write(work, "scene.ts", head + SCENE);
      const result = run("check", "scene.ts", "--json");
      expect(result.status).toBe(2);
      const document = JSON.parse(result.stdout) as {
        error: { code: string; fix: string };
      };
      expect(document.error.code).toBe(code);
      expect(document.error.fix).toContain(fix);
    },
  );

  it("reports a default export that is not a scene", () => {
    write(work, "scene.ts", "export default { kind: 'other' };\n");
    expect(check("scene.ts").code).toBe("ERR_LOAD_NOT_A_SCENE");
  });

  it("reports a scene file that does not exist", () => {
    mkdirSync(work, { recursive: true });
    const result = check("missing.ts");
    expect(result.code).toBe("ERR_LOAD_SCENE_NOT_FOUND");
    expect(result.status).toBe(2);
  });

  it("reports the error as text without --json", () => {
    write(work, "scene.ts", 'import { helper } from "./helper.js";\n' + SCENE);
    write(work, "helper.ts", "export const helper = 1;\n");
    const result = run("check", "scene.ts");
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(
      /^error ERR_LOAD_HELPER_EXTENSION: .+\n {2}fix: .*\.\/helper\.ts/,
    );
  });
});
