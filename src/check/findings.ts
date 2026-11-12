/**
 * How serious a finding is. An `error` fails the run; a `warning` fails it
 * only under strict.
 *
 * @public
 */
export type Severity = "error" | "warning";

/**
 * Where in the scene file a finding's call was made, read from a stack trace.
 *
 * @public
 */
export interface SourceLocation {
  /** The file path or URL as the stack trace names it. */
  readonly file: string;
  /** One-based line number. */
  readonly line: number;
  /** One-based column number. */
  readonly column: number;
}

/**
 * One problem found in a scene, as plain data.
 *
 * @remarks
 * `code` and `severity` are contract; `message` and `fix` are wording and may
 * change in a patch release. Every location field is optional, because not
 * every finding has a row, a target, a joint or a time.
 *
 * Unlike a thrown error, a finding may carry the measured values and the
 * nearest valid names, since showing the author what was measured is its
 * purpose.
 *
 * @example
 * ```ts
 * const finding: Finding = {
 *   code: "ERR_CHECK_JOINT_LIMIT",
 *   severity: "error",
 *   message: "kneeR bends past its limit",
 *   fix: "Reduce the bend or shorten the pose",
 *   row: 0,
 *   joint: "kneeR",
 *   time: [1.2, 1.5],
 *   frames: [36, 45],
 * };
 * ```
 *
 * @public
 */
export interface Finding {
  /** `ERR_<AREA>_<FAILURE>`, shared by errors and warnings. */
  readonly code: string;
  /** Whether the finding fails the run. */
  readonly severity: Severity;
  /** What is wrong. */
  readonly message: string;
  /** How to fix it. */
  readonly fix: string;
  /** Zero-based row of the scene the finding applies to. */
  readonly row?: number;
  /** Id of the actor, prop or other target the finding applies to. */
  readonly target?: string;
  /** Name of the joint the finding applies to. */
  readonly joint?: string;
  /** Start and end of the affected time, in seconds. */
  readonly time?: readonly [start: number, end: number];
  /** First and last affected frame, matching `time`. */
  readonly frames?: readonly [first: number, last: number];
  /** Where the offending call was made, when it could be captured. */
  readonly source?: SourceLocation;
  /** Measured values, keyed by what was measured. */
  readonly measured?: Readonly<Record<string, number>>;
  /** The valid names nearest to an unknown one, closest first. */
  readonly nearest?: readonly string[];
}

/**
 * The number of findings one run records; later findings are dropped.
 *
 * @public
 */
export const FINDING_CAP = 20;

/**
 * Collects findings up to {@link FINDING_CAP}, keeping the first ones.
 *
 * @example
 * ```ts
 * const collector = new FindingCollector();
 * collector.add({
 *   code: "ERR_SCENE_UNKNOWN_ACTION",
 *   severity: "error",
 *   message: "No action is named wavee",
 *   fix: "Use wave",
 *   nearest: ["wave"],
 * });
 * console.log(collector.findings.length, collector.truncated);
 * // => 1 false
 * ```
 *
 * @public
 */
export class FindingCollector {
  readonly #findings: Finding[] = [];
  #truncated = false;

  /** The recorded findings, in the order they were added. */
  get findings(): readonly Finding[] {
    return this.#findings;
  }

  /** Whether at least one finding was dropped because the cap was reached. */
  get truncated(): boolean {
    return this.#truncated;
  }

  /**
   * Record a finding unless the cap has been reached.
   *
   * @param finding - The finding to record.
   * @returns Whether it was recorded.
   */
  add(finding: Finding): boolean {
    if (this.#findings.length >= FINDING_CAP) {
      this.#truncated = true;
      return false;
    }
    this.#findings.push(finding);
    return true;
  }
}

/**
 * A process exit code: 0 clean, 1 error findings, 2 could not run.
 *
 * @public
 */
export type ExitCode = 0 | 1 | 2;

/**
 * The exit code of a run that could not run at all: usage, loading or
 * environment.
 *
 * @public
 */
export const COULD_NOT_RUN = 2 as const;

/**
 * Options that change how findings map to an outcome.
 *
 * @public
 */
export interface OutcomeOptions {
  /** Make warnings fail the run as errors do. Defaults to `false`. */
  readonly strict?: boolean;
}

/**
 * The exit code for a run that produced `findings`.
 *
 * @param findings - The findings of the run.
 * @param options - Whether warnings fail.
 * @returns 1 when a finding fails the run, otherwise 0.
 *
 * @example
 * ```ts
 * const warning = {
 *   code: "ERR_CHECK_OFF_FRAME",
 *   severity: "warning",
 *   message: "hero leaves the frame",
 *   fix: "Ignore it if the exit is meant",
 * } as const;
 * console.log(exitCodeFor([warning]), exitCodeFor([warning], { strict: true }));
 * // => 0 1
 * ```
 *
 * @public
 */
export function exitCodeFor(
  findings: readonly Finding[],
  options: OutcomeOptions = {},
): 0 | 1 {
  const strict = options.strict === true;
  const fails = findings.some((finding) => finding.severity === "error" || strict);
  return fails ? 1 : 0;
}

/**
 * The counts at the end of a report.
 *
 * @public
 */
export interface CheckSummary {
  /** Findings with severity `error`. */
  readonly errors: number;
  /** Findings with severity `warning`. */
  readonly warnings: number;
  /** Whether findings past {@link FINDING_CAP} were dropped. */
  readonly truncated: boolean;
}

/**
 * The document `--json` prints.
 *
 * @public
 */
export interface CheckReport {
  /** Version of this document's shape. */
  readonly version: 1;
  /** Whether the run passes, under the same strictness as its exit code. */
  readonly ok: boolean;
  /** The recorded findings, in the order they were found. */
  readonly findings: readonly Finding[];
  /** Counts of the findings. */
  readonly summary: CheckSummary;
}

/**
 * Options for {@link checkReport}.
 *
 * @public
 */
export interface CheckReportOptions extends OutcomeOptions {
  /** Whether findings past the cap were dropped. Defaults to `false`. */
  readonly truncated?: boolean;
}

/**
 * Build the JSON report for a run's findings.
 *
 * @param findings - The recorded findings.
 * @param options - Strictness, and whether findings were dropped.
 * @returns The report; `ok` agrees with {@link exitCodeFor}.
 *
 * @example
 * ```ts
 * const report = checkReport([]);
 * console.log(report.ok, report.summary.errors);
 * // => true 0
 * ```
 *
 * @public
 */
export function checkReport(
  findings: readonly Finding[],
  options: CheckReportOptions = {},
): CheckReport {
  const errors = findings.filter((finding) => finding.severity === "error").length;
  return {
    version: 1,
    ok: exitCodeFor(findings, options) === 0,
    findings,
    summary: {
      errors,
      warnings: findings.length - errors,
      truncated: options.truncated === true,
    },
  };
}
