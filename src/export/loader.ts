import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CharadeError } from "../errors.js";
import type { Scene } from "../scene/scene.js";
import {
  installResolveHook,
  type InstalledHook,
  localVersion,
  ownVersion,
  type ResolveFailure,
  versionNotice,
} from "./hook.js";

/** A scene file could not be loaded; `fix` is the line the author acts on. */
export abstract class SceneLoadError extends CharadeError {
  /** How to fix it. */
  abstract readonly fix: string;
}

/** The scene path names no file. */
export class SceneNotFoundError extends SceneLoadError {
  readonly code = "ERR_LOAD_SCENE_NOT_FOUND" as const;
  readonly fix =
    "Check the scene path; a relative path is read from the current directory.";

  /** The scene path as it was given. */
  readonly path: string;

  constructor(path: string) {
    super(`No scene file at ${path}.`);
    this.path = path;
  }
}

/** A TypeScript helper was imported as `.js` or without an extension. */
export class HelperExtensionError extends SceneLoadError {
  readonly code = "ERR_LOAD_HELPER_EXTENSION" as const;
  readonly fix: string;

  /** The specifier as the importing file wrote it. */
  readonly specifier: string;
  /** The specifier that names the `.ts` file. */
  readonly suggestion: string;

  constructor(specifier: string, suggestion: string, cause: unknown) {
    super(`${specifier} does not exist; the helper is a TypeScript file.`, { cause });
    this.specifier = specifier;
    this.suggestion = suggestion;
    this.fix = `Import "${suggestion}" instead of "${specifier}": Node loads a TypeScript file only by its .ts name.`;
  }
}

/** A relative or absolute import names no file. */
export class ModuleNotFoundError extends SceneLoadError {
  readonly code = "ERR_LOAD_MODULE_NOT_FOUND" as const;
  readonly fix =
    "Check the import's path: a relative import is read from the importing file's folder and needs its extension.";

  /** The specifier as the importing file wrote it, or the file Node looked for. */
  readonly specifier: string;

  constructor(specifier: string, cause: unknown) {
    super(`The scene imports ${specifier}, which does not exist.`, { cause });
    this.specifier = specifier;
  }
}

/** A bare import names a package that is not installed. */
export class PackageNotFoundError extends SceneLoadError {
  readonly code = "ERR_LOAD_PACKAGE_NOT_FOUND" as const;
  readonly fix: string;

  /** The package name, when the failed resolution was seen. */
  readonly packageName: string | undefined;

  constructor(packageName: string | undefined, cause: unknown) {
    const name = packageName ?? "the package";
    super(`The scene imports ${name}, which is not installed.`, { cause });
    this.packageName = packageName;
    this.fix =
      packageName === undefined
        ? "Install the package in the scene's folder, or remove the import."
        : `Install it in the scene's folder (npm install ${packageName}), or remove the import.`;
  }
}

/** The scene uses TypeScript syntax that type stripping cannot erase. */
export class UnsupportedSyntaxError extends SceneLoadError {
  readonly code = "ERR_LOAD_UNSUPPORTED_SYNTAX" as const;
  readonly fix =
    "Node strips types but transforms nothing: replace an enum with a const object, a parameter property with a field assigned in the constructor, and a namespace with module-level exports.";

  constructor(cause: unknown) {
    super("The scene uses TypeScript syntax that needs transformation.", { cause });
  }
}

/** An import names an export the module does not have, which is what a type looks like at runtime. */
export class MissingExportError extends SceneLoadError {
  readonly code = "ERR_LOAD_MISSING_EXPORT" as const;
  readonly fix: string;

  /** The imported name. */
  readonly exportName: string;

  constructor(name: string, cause: unknown) {
    super(`The scene imports ${name}, which the module does not export at runtime.`, {
      cause,
    });
    this.exportName = name;
    this.fix = `If ${name} is a type, import it with \`import type { ${name} }\`; otherwise check the name the module exports.`;
  }
}

/** A TypeScript file was imported from under `node_modules`, where Node strips no types. */
export class TypeScriptInNodeModulesError extends SceneLoadError {
  readonly code = "ERR_LOAD_TS_IN_NODE_MODULES" as const;
  readonly fix =
    "Node does not strip types under node_modules: import the package's built JavaScript, or move the TypeScript file out of node_modules.";

  constructor(cause: unknown) {
    super("The scene imports a TypeScript file under node_modules.", { cause });
  }
}

/** The file's default export is not a built scene. */
export class NotASceneError extends SceneLoadError {
  readonly code = "ERR_LOAD_NOT_A_SCENE" as const;
  readonly fix =
    "Make the file's default export the value scene() returns: export default scene({ ... }, (stage) => { ... }).";

  constructor() {
    super("The file's default export is not a charade scene.");
  }
}

/** Any other failure while the scene file loaded or ran; the original error is the `cause`. */
export class SceneFailedError extends SceneLoadError {
  readonly code = "ERR_LOAD_FAILED" as const;
  readonly fix = "Fix what the message names, then run the command again.";

  constructor(cause: unknown) {
    super(`The scene could not be loaded: ${describe(cause)}`, { cause });
  }
}

function describe(error: unknown): string {
  if (error instanceof CharadeError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  const property: unknown = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : undefined;
}

// The one case with no `code` to key on: V8 reports a missing named export as a bare
// SyntaxError, which a plain JavaScript syntax error also is.
const MISSING_EXPORT = /does not provide an export named '([^']+)'/;

const TS_FOR_JS: Readonly<Record<string, string>> = {
  ".js": ".ts",
  ".mjs": ".mts",
  ".cjs": ".cts",
};

/** Whether `file` names a regular file. */
function isFile(file: string): boolean {
  return statSync(file, { throwIfNoEntry: false })?.isFile() === true;
}

// A bare or `#` specifier reaches its file through a package's `exports` or `imports`
// map, so its spelling need not end the way the file's path does.
const PATH_SPECIFIER = /^(?:\.{1,2}\/|\/|file:)/;

/** The specifier that names the existing `.ts` file meant by `specifier`, if any. */
function tsSuggestion(
  specifier: string,
  file: string,
  exists: (file: string) => boolean,
): string | undefined {
  if (specifier !== file && !PATH_SPECIFIER.test(specifier)) {
    return undefined;
  }
  const extension = path.extname(file);
  const replacement = TS_FOR_JS[extension];
  if (replacement !== undefined && specifier.endsWith(extension)) {
    const candidate = file.slice(0, -extension.length) + replacement;
    return exists(candidate)
      ? specifier.slice(0, -extension.length) + replacement
      : undefined;
  }
  if (extension === "") {
    if (exists(`${file}.ts`)) {
      return `${specifier}.ts`;
    }
    if (exists(path.join(file, "index.ts"))) {
      return `${specifier.replace(/\/$/, "")}/index.ts`;
    }
  }
  return undefined;
}

/** `lodash/fp` → `lodash`, `@scope/pkg/sub` → `@scope/pkg`. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return (specifier.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)).join("/");
}

/** What {@link classifyLoadError} needs beyond the error itself. */
export interface ClassifyContext {
  /** The resolutions the hook saw fail. */
  readonly failures: readonly ResolveFailure[];
  /** Whether a file exists. */
  readonly exists: (file: string) => boolean;
}

/**
 * Translate what `import()` of a scene rejected with into this package's error, keyed
 * on Node's `code` and the failed specifier, never on message wording where a code
 * exists.
 */
export function classifyLoadError(
  error: unknown,
  context: ClassifyContext,
): SceneLoadError {
  if (error instanceof SceneLoadError) {
    return error;
  }
  const code = stringProperty(error, "code");
  switch (code) {
    case "ERR_MODULE_NOT_FOUND": {
      const failure = context.failures.find((seen) => seen.error === error);
      const url = stringProperty(error, "url");
      if (url === undefined) {
        return new PackageNotFoundError(
          failure === undefined ? undefined : packageNameOf(failure.specifier),
          error,
        );
      }
      const file = fileURLToPath(url);
      const specifier = failure?.specifier ?? file;
      const suggestion = tsSuggestion(specifier, file, context.exists);
      return suggestion === undefined
        ? new ModuleNotFoundError(specifier, error)
        : new HelperExtensionError(specifier, suggestion, error);
    }
    case "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX":
      return new UnsupportedSyntaxError(error);
    case "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING":
      return new TypeScriptInNodeModulesError(error);
    case undefined: {
      const missing =
        error instanceof SyntaxError ? MISSING_EXPORT.exec(error.message) : null;
      const name = missing?.[1];
      return name === undefined
        ? new SceneFailedError(error)
        : new MissingExportError(name, error);
    }
    default:
      return new SceneFailedError(error);
  }
}

/** The built scene a module exports as its default. */
export function sceneFrom(module: unknown): Scene {
  if (typeof module === "object" && module !== null && "default" in module) {
    const value: unknown = module.default;
    if (isScene(value)) {
      return value;
    }
  }
  throw new NotASceneError();
}

function isScene(value: unknown): value is Scene {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "charade.scene"
  );
}

/** How {@link loadScene} reaches Node; each part is replaceable in a test. */
export interface LoadOptions {
  /** Receives each notice line, without its newline. */
  readonly notice: (line: string) => void;
  /** Imports a module by URL. */
  readonly importModule?: (url: string) => Promise<unknown>;
  /** Registers the resolve hook. */
  readonly install?: () => InstalledHook;
  /** Whether a file exists. */
  readonly exists?: (file: string) => boolean;
  /** The running CLI's own version. */
  readonly ownVersion?: string;
  /** The version the scene's folder would resolve. */
  readonly localVersion?: (sceneFile: string) => string | undefined;
}

let installed: InstalledHook | undefined;

const installOnce = (): InstalledHook => (installed ??= installResolveHook());

/**
 * Import a scene file with `charade` mapped to this copy, and return its built scene.
 *
 * @throws A {@link SceneLoadError} for every failure.
 */
export async function loadScene(file: string, options: LoadOptions): Promise<Scene> {
  const exists = options.exists ?? isFile;
  const absolute = path.resolve(file);
  if (!exists(absolute)) {
    throw new SceneNotFoundError(file);
  }
  const notice = versionNotice(
    (options.localVersion ?? localVersion)(absolute),
    options.ownVersion ?? ownVersion(),
  );
  if (notice !== undefined) {
    options.notice(notice);
  }
  const hook = (options.install ?? installOnce)();
  const importModule = options.importModule ?? ((url: string) => import(url));
  let module: unknown;
  try {
    module = await importModule(pathToFileURL(absolute).href);
  } catch (error) {
    throw classifyLoadError(error, { failures: hook.failures, exists });
  }
  return sceneFrom(module);
}
