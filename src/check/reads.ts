import type { Finding } from "./findings.js";

/** A global whose value differs from one run to the next. */
export type GlobalRead = "Date" | "performance.now" | "Math.random";

/** A watched function that returned `value`. */
export interface WatchedValue<T> {
  readonly ok: true;
  readonly value: T;
  readonly reads: readonly GlobalRead[];
}

/** A watched function that threw `error`; the reads it made before it threw are kept. */
export interface WatchedError {
  readonly ok: false;
  readonly error: unknown;
  readonly reads: readonly GlobalRead[];
}

/** How a watched function ended, and the globals it read either way. */
export type Watched<T> = WatchedValue<T> | WatchedError;

/**
 * Runs a function and says which of the clock and the unseeded random it read. What
 * the function throws is returned, not rethrown, so its reads are not lost with it. A
 * nested watch keeps its reads to itself.
 */
export type ReadWatch = <T>(run: () => T) => Watched<T>;

// The pure layers may not name those globals, so the replacement is handed in by the
// layer that may: the export layer installs its watch here for the length of a command.
let installed: ReadWatch | undefined;

// A build that throws makes no scene to freeze its findings into; they wait here, keyed
// by the thrown value itself, since a thrown value need not be an object to carry them.
let aborted: { readonly error: unknown; readonly build: AbortedBuild } | undefined;

/** The findings a failed build recorded, and whether the cap dropped later ones. */
export interface AbortedBuild {
  readonly findings: readonly Finding[];
  readonly truncated: boolean;
}

const NOTHING_KEPT: AbortedBuild = { findings: [], truncated: false };

/**
 * Sets the watch `scene()` and the frame checks run author functions under;
 * `undefined` removes it.
 *
 * @returns The watch that was installed before.
 */
export function installReadWatch(watch: ReadWatch | undefined): ReadWatch | undefined {
  const previous = installed;
  installed = watch;
  aborted = undefined;
  return previous;
}

/**
 * Keeps the findings a failed build recorded, for the command that ran it to take back
 * by what the build threw. Only while a watch is installed, and only one build's worth.
 */
export function noteAbortedBuild(error: unknown, build: AbortedBuild): void {
  aborted =
    installed === undefined || build.findings.length === 0
      ? undefined
      : { error, build };
}

/**
 * The findings kept for the build that threw `error`, or none when it is not the value
 * kept. Either way nothing is kept afterwards.
 */
export function takeAbortedBuild(error: unknown): AbortedBuild {
  const kept = aborted;
  aborted = undefined;
  return kept !== undefined && kept.error === error ? kept.build : NOTHING_KEPT;
}

/** Runs `run` under the installed watch; with none installed it reports no reads. */
export function watchReads<T>(run: () => T): Watched<T> {
  if (installed !== undefined) {
    return installed(run);
  }
  try {
    return { ok: true, value: run(), reads: [] };
  } catch (error) {
    return { ok: false, error, reads: [] };
  }
}

/** What the watched function returned, or what it threw, thrown again. */
export function valueOf<T>(watched: Watched<T>): T {
  if (!watched.ok) {
    throw watched.error;
  }
  return watched.value;
}

/** Where a read happened: `subject` begins the message, the rest locates the finding. */
export interface ReadSite {
  readonly subject: string;
  readonly row?: number;
  readonly target?: string;
}

/** The error finding for one read; the code says which kind, clock or random. */
export function readFinding(read: GlobalRead, site: ReadSite): Finding {
  const { subject, ...where } = site;
  return read === "Math.random"
    ? {
        code: "ERR_CHECK_UNSEEDED_RANDOM",
        severity: "error",
        message: `${subject} reads Math.random, so two runs of the scene differ.`,
        fix: "Use moment.random, the seeded source a drive or draw function is given as its second argument, or a fixed number.",
        ...where,
      }
    : {
        code: "ERR_CHECK_CLOCK_READ",
        severity: "error",
        message: `${subject} reads the clock (${read}), so two runs of the scene differ.`,
        fix: "Use the t argument or moment.time of a drive or draw function: frame n depends on the timeline and n alone.",
        ...where,
      };
}
