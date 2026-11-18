import consoleModule from "node:console";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";

import {
  INDEX_FILE,
  isIndexFresh,
  listItems,
  main,
  renderIndex,
  VOCABULARY_DIR,
  VocabularyIndexError,
} from "../scripts/build-vocabulary-index.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const workspaces: string[] = [];

/** A throwaway repository root holding a copy of the committed vocabulary. */
function copyOfVocabulary(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vocabulary-index-"));
  workspaces.push(root);
  cpSync(path.join(repoRoot, VOCABULARY_DIR), path.join(root, VOCABULARY_DIR), {
    recursive: true,
  });
  return root;
}

/** A throwaway repository root with the given item modules and no index. */
function rootWith(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "vocabulary-index-"));
  workspaces.push(root);
  mkdirSync(path.join(root, VOCABULARY_DIR), { recursive: true });
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(root, VOCABULARY_DIR, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return root;
}

function silence(method: "log" | "error"): MockInstance<(...args: unknown[]) => void> {
  return vi.spyOn(consoleModule, method).mockImplementation(() => undefined);
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof VocabularyIndexError ? error.code : undefined;
  }
  return undefined;
}

afterEach(() => {
  for (const dir of workspaces.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("the committed vocabulary index", () => {
  it("is byte-identical to what the script generates on a clean tree", () => {
    const committed = readFileSync(path.join(repoRoot, INDEX_FILE), "utf8");
    expect(renderIndex(listItems(repoRoot))).toBe(committed);
    expect(isIndexFresh(repoRoot)).toBe(true);
  });

  it("is left byte-identical when the script rewrites it", () => {
    const root = copyOfVocabulary();
    const log = silence("log");
    expect(main([], root)).toBe(0);
    expect(readFileSync(path.join(root, INDEX_FILE), "utf8")).toBe(
      readFileSync(path.join(repoRoot, INDEX_FILE), "utf8"),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining(INDEX_FILE));
  });

  it("is stale once a vocabulary module is added without rerunning the script", () => {
    const root = copyOfVocabulary();
    writeFileSync(
      path.join(root, VOCABULARY_DIR, "actions", "wave.ts"),
      "export const waveAction = 1;\n",
    );
    const error = silence("error");
    expect(isIndexFresh(root)).toBe(false);
    expect(main(["--check"], root)).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("ERR_VOCABULARY_INDEX_STALE"),
    );
  });

  it("is stale once a vocabulary module is removed without rerunning the script", () => {
    const root = copyOfVocabulary();
    rmSync(path.join(root, VOCABULARY_DIR, "props", "box.ts"));
    expect(isIndexFresh(root)).toBe(false);
  });

  it("is fresh again after the script reruns, and then names the new module", () => {
    const root = copyOfVocabulary();
    writeFileSync(
      path.join(root, VOCABULARY_DIR, "actions", "wave.ts"),
      "export const waveAction = 1;\n",
    );
    silence("log");
    expect(main([], root)).toBe(0);
    expect(main(["--check"], root)).toBe(0);
    const index = readFileSync(path.join(root, INDEX_FILE), "utf8");
    expect(index).toContain('import { waveAction } from "./actions/wave.js";');
    expect(index).toContain("  readonly wave: typeof waveAction;");
    expect(index).toContain("  wave: waveAction,");
  });

  it("is stale when it is missing", () => {
    const root = rootWith({ "props/ball.ts": "export const ballProp = 1;\n" });
    expect(isIndexFresh(root)).toBe(false);
  });
});

describe("listItems", () => {
  it("lists the kinds in a fixed order and the names of a kind sorted", () => {
    const root = rootWith({
      "props/box.ts": "export const boxProp = 1;\n",
      "props/Ball.ts": "export const BallProp = 1;\n",
      "effects/sweat.ts": "export const sweatEffect = 1;\n",
      "backdrops/court.ts": "export const courtBackdrop = 1;\n",
      "expressions/happy.ts": "export const happyExpression = 1;\n",
      "actions/walk.ts": "export const walkAction: number = 1;\n",
    });
    expect(listItems(root)).toEqual([
      {
        kind: "action",
        name: "walk",
        exportName: "walkAction",
        specifier: "./actions/walk.js",
      },
      {
        kind: "expression",
        name: "happy",
        exportName: "happyExpression",
        specifier: "./expressions/happy.js",
      },
      {
        kind: "prop",
        name: "Ball",
        exportName: "BallProp",
        specifier: "./props/Ball.js",
      },
      { kind: "prop", name: "box", exportName: "boxProp", specifier: "./props/box.js" },
      {
        kind: "backdrop",
        name: "court",
        exportName: "courtBackdrop",
        specifier: "./backdrops/court.js",
      },
      {
        kind: "effect",
        name: "sweat",
        exportName: "sweatEffect",
        specifier: "./effects/sweat.js",
      },
    ]);
  });

  it("ignores a directory that is not a kind, a nested directory and a file that is not TypeScript", () => {
    const root = rootWith({
      "props/ball.ts": "export const ballProp = 1;\n",
      "props/notes.md": "not an item\n",
      "props/shapes/round.ts": "export const round = 1;\n",
      "helpers/math.ts": "export const half = 0.5;\n",
      "index.ts": "stale\n",
    });
    expect(listItems(root).map((item) => item.name)).toEqual(["ball"]);
  });

  it("lists nothing when there is no vocabulary directory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vocabulary-index-"));
    workspaces.push(root);
    expect(listItems(root)).toEqual([]);
  });

  it.each([
    ["a hyphen", "props/beach-ball.ts"],
    ["a leading digit", "props/8ball.ts"],
    ["a dot", "props/ball.test.ts"],
  ])("rejects a module named with %s", (_label, file) => {
    const root = rootWith({ [file]: "export const ballProp = 1;\n" });
    expect(codeOf(() => listItems(root))).toBe("ERR_VOCABULARY_INVALID_NAME");
  });

  it.each([
    ["no export", "const ballProp = 1;\n"],
    ["an export named for another kind", "export const ballAction = 1;\n"],
    ["an export whose name only starts the same", "export const ballProperty = 1;\n"],
  ])("rejects a module with %s", (_label, source) => {
    const root = rootWith({ "props/ball.ts": source });
    expect(codeOf(() => listItems(root))).toBe("ERR_VOCABULARY_EXPORT_MISSING");
  });
});

describe("renderIndex", () => {
  it("writes an empty map and its lint exception for a kind with no item", () => {
    const index = renderIndex([]);
    expect(index).toContain(
      "// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- no built-in effect yet\nexport interface BuiltinEffects {}\n",
    );
    expect(index).toContain(
      "export const builtinEffects: BuiltinEffects = Object.freeze({});\n",
    );
    expect(index).toContain(" * @remarks\n * There is no built-in effect yet.\n");
    expect(index).not.toContain("import ");
  });

  it("keeps a reserved word as a name, since the export is named for the kind too", () => {
    const index = renderIndex([
      {
        kind: "action",
        name: "throw",
        exportName: "throwAction",
        specifier: "./actions/throw.js",
      },
    ]);
    expect(index).toContain("  readonly throw: typeof throwAction;\n");
    expect(index).toContain("  throw: throwAction,\n");
    expect(index).toContain(" * @remarks\n * They are `throw`.\n");
    expect(index).not.toContain("no built-in action yet");
  });

  it("wraps the list of names within the print width", () => {
    const items = Array.from({ length: 12 }, (_, i) => {
      const name = `expression${String(i).padStart(2, "0")}`;
      return {
        kind: "expression",
        name,
        exportName: `${name}Expression`,
        specifier: `./expressions/${name}.js`,
      };
    });
    const lines = renderIndex(items).split("\n");
    expect(lines).toContain(
      " * They are `expression00`, `expression01`, `expression02`, `expression03`,",
    );
    const prose = lines.filter((line) => line.startsWith(" * "));
    expect(prose).toContain(" * `expression09`, `expression10`, `expression11`.");
    expect(Math.max(...prose.map((line) => line.length))).toBeLessThanOrEqual(88);
  });

  it("wraps an import too long for one line the way the formatter would", () => {
    const name = "aVeryLongNameThatNoItemWillEverHaveButTheFormatterWouldWrap";
    const index = renderIndex([
      {
        kind: "expression",
        name,
        exportName: `${name}Expression`,
        specifier: `./expressions/${name}.js`,
      },
    ]);
    expect(index).toContain(
      `import {\n  ${name}Expression,\n} from "./expressions/${name}.js";\n`,
    );
  });
});

describe("main", () => {
  it("returns 2 for an argument it does not know, and writes nothing", () => {
    const root = rootWith({ "props/ball.ts": "export const ballProp = 1;\n" });
    const error = silence("error");
    expect(main(["--unknown-flag"], root)).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("ERR_VOCABULARY_USAGE"));
    expect(isIndexFresh(root)).toBe(false);
  });

  it.each([[[]], [["--check"]]])(
    "returns 1 with the module's code when an item module is malformed (%j)",
    (argv) => {
      const root = rootWith({ "props/ball.ts": "const ballProp = 1;\n" });
      const error = silence("error");
      expect(main(argv, root)).toBe(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("ERR_VOCABULARY_EXPORT_MISSING"),
      );
    },
  );

  it("lets a failure that is not its own through", () => {
    const root = rootWith({ "props/ball.ts": "export const ballProp = 1;\n" });
    // The index's path is taken by a directory, so writing it fails in the file system.
    mkdirSync(path.join(root, INDEX_FILE));
    expect(() => main([], root)).toThrow(/EISDIR/);
  });
});
