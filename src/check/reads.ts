import type { Finding } from "./findings.js";

/** A global whose value differs from one run to the next. */
export type GlobalRead = "Date" | "performance.now" | "Math.random";

/** What a watched function returned, and the globals it read. */
export interface Watched<T> {
  readonly value: T;
  readonly reads: readonly GlobalRead[];
}

/**
 * Runs a function and says which of the clock and the unseeded random it read. A
 * nested watch keeps its reads to itself.
 */
export type ReadWatch = <T>(run: () => T) => Watched<T>;

// The pure layers may not name those globals, so the replacement is handed in by the
// layer that may: the export layer installs its watch here for the length of a command.
let installed: ReadWatch | undefined;

/**
 * Sets the watch `scene()` and the frame checks run author functions under;
 * `undefined` removes it.
 *
 * @returns The watch that was installed before.
 */
export function installReadWatch(watch: ReadWatch | undefined): ReadWatch | undefined {
  const previous = installed;
  installed = watch;
  return previous;
}

/** Runs `run` under the installed watch; with none installed it reports no reads. */
export function watchReads<T>(run: () => T): Watched<T> {
  return installed === undefined ? { value: run(), reads: [] } : installed(run);
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
