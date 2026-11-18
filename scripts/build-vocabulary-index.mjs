#!/usr/bin/env node
// Rebuild src/vocabulary/index.ts, the built-in vocabulary index, from the item
// modules beside it. Nothing registers itself on import (the package declares no
// side effects), so this list is the only place a built-in becomes a name.
//
// An item is one module, src/vocabulary/<kind>s/<name>.ts, whose export is named
// for the item and its kind: actions/throw.ts exports `throwAction`. The file name
// is the name a scene uses, so `a.do("throw")` needs nothing but the file.
import console from "node:console";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { isMain } from "./lib/is-main.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where the index and the item modules live, relative to the repository root. */
export const VOCABULARY_DIR = "src/vocabulary";

/** The generated file, relative to the repository root. */
export const INDEX_FILE = `${VOCABULARY_DIR}/index.ts`;

/** Prettier's `printWidth` here: a longer import is written the way it wraps one. */
const PRINT_WIDTH = 88;

/**
 * @typedef {object} Kind
 * @property {string} kind - The kind as a definition's `kind` spells it.
 * @property {string} directory - The directory of its item modules.
 * @property {string} suffix - What an item's export ends with.
 * @property {string} map - The name of the built-in map and, capitalised, its type.
 * @property {string} accepts - What takes a name of this kind, for the TSDoc.
 */

/** @type {readonly Kind[]} */
const KINDS = [
  {
    kind: "action",
    directory: "actions",
    suffix: "Action",
    map: "builtinActions",
    accepts: '`a.do("name")` accepts',
  },
  {
    kind: "expression",
    directory: "expressions",
    suffix: "Expression",
    map: "builtinExpressions",
    accepts: '`a.express("name")` and `mood` accept',
  },
  {
    kind: "prop",
    directory: "props",
    suffix: "Prop",
    map: "builtinProps",
    accepts: '`row.prop("name")` accepts',
  },
  {
    kind: "backdrop",
    directory: "backdrops",
    suffix: "Backdrop",
    map: "builtinBackdrops",
    accepts: '`row.backdrop("name")` accepts',
  },
  {
    kind: "effect",
    directory: "effects",
    suffix: "Effect",
    map: "builtinEffects",
    accepts: '`row.effect("name")` accepts',
  },
];

/**
 * @typedef {object} Item
 * @property {string} kind - The item's kind.
 * @property {string} name - The name a scene uses: the module's file name.
 * @property {string} exportName - The module's export: the name and the kind.
 * @property {string} specifier - The module, as the index imports it.
 */

/** A failure of this script, with the code its stderr line starts with. */
export class VocabularyIndexError extends Error {
  /**
   * @param {string} code - The `ERR_VOCABULARY_*` code.
   * @param {string} message - What failed, expected against actual, and what to run.
   */
  constructor(code, message) {
    super(message);
    this.name = "VocabularyIndexError";
    /** @type {string} */
    this.code = code;
  }
}

/**
 * List the item modules under `root`'s vocabulary directory, kind by kind in the
 * fixed order of the kinds and by name within a kind, so the index does not depend
 * on the order a file system lists a directory in.
 *
 * @param {string} [root] - The repository root.
 * @returns {Item[]} Every item.
 * @throws {VocabularyIndexError} When a module's name is not an identifier or it
 * lacks the export its name and kind call for.
 */
export function listItems(root = repoRoot) {
  /** @type {Item[]} */
  const items = [];
  for (const { kind, directory, suffix } of KINDS) {
    const absolute = path.join(root, VOCABULARY_DIR, directory);
    if (!existsSync(absolute)) {
      continue;
    }
    const files = readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => entry.name)
      .sort();
    for (const file of files) {
      const name = file.slice(0, -".ts".length);
      const relative = `${VOCABULARY_DIR}/${directory}/${file}`;
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
        throw new VocabularyIndexError(
          "ERR_VOCABULARY_INVALID_NAME",
          `${relative} is not named for an item.\nExpected: letters and digits starting with a letter, such as sitDown.ts\nNext: rename the file, then run \`pnpm vocabulary:index\`.`,
        );
      }
      const exportName = `${name}${suffix}`;
      const source = readFileSync(path.join(absolute, file), "utf8");
      if (!new RegExp(`^export const ${exportName}\\b`, "m").test(source)) {
        throw new VocabularyIndexError(
          "ERR_VOCABULARY_EXPORT_MISSING",
          `${relative} does not export its ${kind}.\nExpected: export const ${exportName}\nNext: name the export for the item and its kind, then run \`pnpm vocabulary:index\`.`,
        );
      }
      items.push({ kind, name, exportName, specifier: `./${directory}/${name}.js` });
    }
  }
  return items;
}

/**
 * @param {string} name
 * @returns {string}
 */
function capitalised(name) {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * A sentence as the lines of a TSDoc block, wrapped the way the formatter leaves prose
 * in a comment alone: at a space, within the print width.
 *
 * @param {string} text - The sentence.
 * @returns {string[]} The lines, each starting with the block's ` * `.
 */
function wrapComment(text) {
  /** @type {string[]} */
  const lines = [];
  let line = " *";
  for (const word of text.split(" ")) {
    if (line.length + 1 + word.length > PRINT_WIDTH && line !== " *") {
      lines.push(line);
      line = " *";
    }
    line += ` ${word}`;
  }
  return [...lines, line];
}

/**
 * The text of the index for `items`, already in the form Prettier leaves it in.
 *
 * @param {readonly Item[]} items - The items, as {@link listItems} orders them.
 * @returns {string} The module's source.
 */
export function renderIndex(items) {
  const lines = [
    "// Generated by scripts/build-vocabulary-index.mjs from the item modules in this",
    "// directory. Do not edit: add, rename or remove a module, then run",
    "// `pnpm vocabulary:index`.",
    "",
    ...items.map(({ exportName, specifier }) => {
      const line = `import { ${exportName} } from "${specifier}";`;
      return line.length <= PRINT_WIDTH
        ? line
        : `import {\n  ${exportName},\n} from "${specifier}";`;
    }),
  ];
  for (const { kind, map, accepts } of KINDS) {
    const own = items.filter((item) => item.kind === kind);
    const type = capitalised(map);
    const names = own.map(({ name }) => `\`${name}\``).join(", ");
    lines.push(
      "",
      "/**",
      ` * The built-in ${kind}s by name: what ${accepts}.`,
      " *",
      " * @remarks",
      ...wrapComment(
        own.length === 0 ? `There is no built-in ${kind} yet.` : `They are ${names}.`,
      ),
      " *",
      " * @public",
      " */",
    );
    if (own.length === 0) {
      lines.push(
        `// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- no built-in ${kind} yet`,
        `export interface ${type} {}`,
      );
    } else {
      lines.push(
        `export interface ${type} {`,
        ...own.flatMap(({ name, exportName }) => [
          // Hidden from the API reference, which would otherwise print each item's
          // parameter specification as an undocumented type; the remarks name them.
          `  /** @hidden */`,
          `  readonly ${name}: typeof ${exportName};`,
        ]),
        "}",
      );
    }
    lines.push(
      "",
      "/**",
      ` * The built-in ${kind}s, by name.`,
      " *",
      " * @public",
      " */",
    );
    if (own.length === 0) {
      lines.push(`export const ${map}: ${type} = Object.freeze({});`);
    } else {
      lines.push(
        `export const ${map}: ${type} = Object.freeze({`,
        ...own.map(({ name, exportName }) => `  ${name}: ${exportName},`),
        "});",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Whether the committed index under `root` is what {@link renderIndex} gives now.
 *
 * @param {string} [root] - The repository root.
 * @returns {boolean} True when the index is byte-identical to a fresh one.
 * @throws {VocabularyIndexError} When an item module is malformed.
 */
export function isIndexFresh(root = repoRoot) {
  // The items first: a malformed module is reported as that, not as a stale index.
  const fresh = renderIndex(listItems(root));
  const file = path.join(root, INDEX_FILE);
  return existsSync(file) && readFileSync(file, "utf8") === fresh;
}

/**
 * Rebuild the index, or with `--check` only report whether it is stale.
 *
 * @param {readonly string[]} argv - Arguments after the script name.
 * @param {string} [root] - The repository root.
 * @returns {number} Process exit code: 0 done or fresh, 1 stale or an item module is
 * malformed, 2 bad usage.
 */
export function main(argv, root = repoRoot) {
  const unknown = argv.find((argument) => argument !== "--check");
  if (unknown !== undefined) {
    console.error(
      `ERR_VOCABULARY_USAGE: unknown argument ${unknown}.\nExpected: no argument, or --check\nNext: run \`pnpm vocabulary:index\`.`,
    );
    return 2;
  }
  try {
    if (argv.includes("--check")) {
      if (isIndexFresh(root)) {
        return 0;
      }
      console.error(
        `ERR_VOCABULARY_INDEX_STALE: ${INDEX_FILE} does not match the item modules.\nExpected: the output of scripts/build-vocabulary-index.mjs\nNext: run \`pnpm vocabulary:index\` and commit the result.`,
      );
      return 1;
    }
    const items = listItems(root);
    writeFileSync(path.join(root, INDEX_FILE), renderIndex(items));
    console.log(`${INDEX_FILE}: ${String(items.length)} items`);
    return 0;
  } catch (error) {
    if (error instanceof VocabularyIndexError) {
      console.error(`${error.code}: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
