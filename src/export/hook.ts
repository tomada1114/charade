import { readFileSync } from "node:fs";
import { createRequire, registerHooks, type ResolveHookSync } from "node:module";

// `module.registerHooks()` is a release candidate in Node 24; everything that touches
// it stays in this module so a change in that API touches one file.

/** This copy's entry point: `dist/index.js` when this module is `dist/export/hook.js`. */
export const OWN_ENTRY: string = new URL("../index.js", import.meta.url).href;

/** This copy's manifest, two levels up from `dist/export/` (or `src/export/`). */
const OWN_MANIFEST = new URL("../../package.json", import.meta.url);

/** A resolution Node gave up on, as the hook saw it. */
export interface ResolveFailure {
  /** The specifier exactly as the importing file wrote it. */
  readonly specifier: string;
  /** The importing module's URL. */
  readonly parentURL: string | undefined;
  /** What `nextResolve` threw; `import()` rejects with this same instance. */
  readonly error: unknown;
}

/**
 * The resolve hook: the exact specifier `charade`, from any importer, becomes
 * `ownEntry`; every other specifier goes on to Node, and a failure is recorded in
 * `failures` before it is rethrown.
 */
export function createResolveHook(
  ownEntry: string,
  failures: ResolveFailure[],
): ResolveHookSync {
  return (specifier, context, nextResolve) => {
    if (specifier === "charade") {
      return { url: ownEntry, format: "module", shortCircuit: true };
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      failures.push({ specifier, parentURL: context.parentURL, error });
      throw error;
    }
  };
}

/** A registered resolve hook. */
export interface InstalledHook {
  /** Every resolution that failed since the hook was registered. */
  readonly failures: readonly ResolveFailure[];
  /** Remove the hook. */
  deregister(): void;
}

/** Register the resolve hook for this process. */
export function installResolveHook(ownEntry: string = OWN_ENTRY): InstalledHook {
  const failures: ResolveFailure[] = [];
  const hooks = registerHooks({ resolve: createResolveHook(ownEntry, failures) });
  return {
    failures,
    deregister: () => {
      hooks.deregister();
    },
  };
}

/** The `version` field of the manifest at `file`, or `undefined` when it has none. */
export function readVersion(file: string | URL): string | undefined {
  const manifest: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof manifest !== "object" || manifest === null || !("version" in manifest)) {
    return undefined;
  }
  return typeof manifest.version === "string" ? manifest.version : undefined;
}

/** The version of the running CLI's own copy. */
export function ownVersion(): string {
  return readVersion(OWN_MANIFEST) ?? "unknown";
}

/**
 * The version of `charade` that the folder of `sceneFile` would resolve, read from its
 * manifest without importing it; `undefined` when there is none.
 *
 * @remarks Call it before {@link installResolveHook}: a failed lookup would otherwise be
 * recorded as one of the scene's failures.
 */
export function localVersion(sceneFile: string): string | undefined {
  try {
    return readVersion(createRequire(sceneFile).resolve("charade/package.json"));
  } catch {
    return undefined;
  }
}

/** The one stderr line for a differing local version, or `undefined` when none is owed. */
export function versionNotice(
  local: string | undefined,
  own: string,
): string | undefined {
  if (local === undefined || local === own) {
    return undefined;
  }
  return `notice: this folder has charade ${local} installed; the scene runs on the CLI's own charade ${own}.`;
}
