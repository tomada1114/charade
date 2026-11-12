/**
 * Public entry point.
 *
 * @remarks
 * This module is the entire published contract. Anything not re-exported here
 * — in particular everything under `src/internal/` — is private and may change
 * in a patch release, and `package.json#exports` blocks consumers from reaching
 * it by deep import.
 *
 * Every symbol is exported by name on purpose: no `export *`, no default
 * export. Adding a line here is an API change and needs a release-impact note
 * in the pull request.
 *
 * @packageDocumentation
 */

export {
  checkReport,
  COULD_NOT_RUN,
  exitCodeFor,
  FINDING_CAP,
  FindingCollector,
} from "./check/findings.js";
export type {
  CheckReport,
  CheckReportOptions,
  CheckSummary,
  ExitCode,
  Finding,
  OutcomeOptions,
  Severity,
  SourceLocation,
} from "./check/findings.js";
export { CharadeError, UnknownFlagError } from "./errors.js";
