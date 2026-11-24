import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const src = fileURLToPath(new URL("../src", import.meta.url));

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
}

/** The file a relative specifier names, as a path under src/ with a .ts extension. */
function target(from: string, specifier: string): string {
  return path
    .relative(src, path.resolve(path.dirname(from), specifier))
    .split(path.sep)
    .join("/")
    .replace(/\.js$/, ".ts");
}

interface RootExport {
  readonly module: string;
  readonly typeOnly: boolean;
}

/** A name as its defining module spells it → the root export of it. */
function rootExports(): Map<string, RootExport> {
  const index = path.join(src, "index.ts");
  const names = new Map<string, RootExport>();
  for (const statement of parse(index).statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.set((element.propertyName ?? element.name).text, {
          module: target(index, statement.moduleSpecifier.text),
          typeOnly: statement.isTypeOnly || element.isTypeOnly,
        });
      }
    }
  }
  return names;
}

const items = readdirSync(path.join(src, "vocabulary"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((kind) =>
    readdirSync(path.join(src, "vocabulary", kind.name)).map((name) =>
      path.join(src, "vocabulary", kind.name, name),
    ),
  );

interface Import {
  readonly module: string;
  readonly names:
    readonly { readonly name: string; readonly typeOnly: boolean }[] | null;
  readonly typeOnly: boolean;
}

function importsOf(file: string): Import[] {
  const found: Import[] = [];
  for (const statement of parse(file).statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith(".")
    ) {
      const bindings = ts.isImportDeclaration(statement)
        ? statement.importClause?.namedBindings
        : statement.exportClause;
      const named =
        bindings !== undefined &&
        (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
        (ts.isExportDeclaration(statement) ||
          statement.importClause?.name === undefined);
      const whole = ts.isImportDeclaration(statement)
        ? statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
        : statement.isTypeOnly;
      found.push({
        module: target(file, statement.moduleSpecifier.text),
        names: named
          ? bindings.elements.map((e) => ({
              name: (e.propertyName ?? e.name).text,
              typeOnly: whole || e.isTypeOnly,
            }))
          : null,
        typeOnly:
          whole ||
          (named &&
            bindings.elements.length > 0 &&
            bindings.elements.every((e) => e.isTypeOnly)),
      });
    }
  }
  return found;
}

describe("a built-in item's imports", () => {
  const root = rootExports();

  it.each(items.map((file) => [path.relative(src, file), file]))(
    "%s takes only root exports, each from its defining module",
    (_label, file) => {
      const outside = importsOf(file).filter(
        (entry) => !entry.module.startsWith("vocabulary/"),
      );
      const strays = outside.flatMap((entry) =>
        entry.names === null
          ? [`${entry.module}: not a named import`]
          : entry.names
              .filter(({ name, typeOnly }) => {
                const exported = root.get(name);
                return (
                  exported?.module !== entry.module || (exported.typeOnly && !typeOnly)
                );
              })
              .map(({ name }) => `${name} from ${entry.module}`),
      );
      expect(strays).toEqual([]);
    },
  );

  it("never reach the built-in maps or the root entry at run time", () => {
    const seen = new Set<string>();
    const queue = items.map((file) => path.relative(src, file));
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      if (seen.has(file)) continue;
      seen.add(file);
      for (const entry of importsOf(path.join(src, file))) {
        if (!entry.typeOnly) queue.push(entry.module);
      }
    }
    for (const module of ["index.ts", "vocabulary/index.ts", "scene/builtins.ts"]) {
      expect(seen.has(module)).toBe(false);
    }
    expect(seen.has("scene/define.ts")).toBe(true);
  });

  it("load an item module on its own, before anything else", async () => {
    vi.resetModules();
    const { carryAction } = await import("../src/vocabulary/actions/carry.js");
    expect(carryAction).toMatchObject({ kind: "action", name: "carry" });
  });
});
