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
export type {
  DrawingContext,
  Gradient,
  ShapeContext,
  TextMeasurement,
} from "./draw/context.js";
export {
  AsyncBuildError,
  CharadeError,
  SceneClosedError,
  UnknownFlagError,
  UnknownRowError,
} from "./errors.js";
export type { Point } from "./rig/kinematics.js";
export type { ChannelName, EffectorName } from "./rig/rig.js";
export type {
  Actor,
  ActorOptions,
  DrawFunction,
  DrawOptions,
  DriveChannels,
  DriveOptions,
  PoseChannels,
  PoseOptions,
  ReachOptions,
  Row,
  Span,
  Stage,
} from "./scene/handles.js";
export { scene } from "./scene/scene.js";
export type { Scene, SceneOptions } from "./scene/scene.js";
export type { RandomSource } from "./timeline/random.js";
export type { BlendMode, Moment, MotionFunction } from "./timeline/segments.js";
export type {
  Timeline,
  TimelineRow,
  TimelineSegment,
  TimelineTrack,
} from "./timeline/timeline.js";
