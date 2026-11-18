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
export { svgPath } from "./draw/path-data.js";
export type { SvgPathOptions } from "./draw/path-data.js";
export { drawText } from "./draw/text.js";
export type { DrawTextOptions, TextSize } from "./draw/text.js";
export {
  AsyncBuildError,
  CharadeError,
  InvalidDefaultError,
  InvalidDefinitionError,
  InvalidPathDataError,
  ReservedParameterError,
  SceneClosedError,
  UnknownFlagError,
  UnknownRowError,
} from "./errors.js";
export type { ItemKind } from "./errors.js";
export type { Point } from "./rig/kinematics.js";
export type { ChannelName, EffectorName } from "./rig/rig.js";
export {
  defineAction,
  defineBackdrop,
  defineEffect,
  defineExpression,
  defineProp,
} from "./scene/define.js";
export type {
  ActionDefinition,
  ActionInput,
  BackdropDefinition,
  Definition,
  DrawnDefinition,
  DrawnInput,
  EffectDefinition,
  ExpressionDefinition,
  ExpressionInput,
  FaceChannels,
  NoParams,
  PropDefinition,
} from "./scene/define.js";
// After `define…`: the built-in items import this entry, and they load while it does.
export {
  builtinActions,
  builtinBackdrops,
  builtinEffects,
  builtinExpressions,
  builtinProps,
} from "./scene/builtins.js";
export type {
  BuiltinActions,
  BuiltinBackdrops,
  BuiltinEffects,
  BuiltinExpressions,
  BuiltinName,
  BuiltinProps,
} from "./scene/builtins.js";
export type {
  ActionOptions,
  Actor,
  ActorOptions,
  Clip,
  DrawFunction,
  DrawOptions,
  DriveOptions,
  ExpressOptions,
  HoldOptions,
  ItemOptions,
  LabelOptions,
  MotionFunction,
  MoveOptions,
  PlaceOptions,
  PoseChannels,
  PoseOptions,
  Prop,
  ReachOptions,
  Row,
  SayOptions,
  Span,
  Stage,
} from "./scene/handles.js";
export type {
  BooleanParam,
  ColorParam,
  EnumParam,
  ItemArgs,
  NumberParam,
  Param,
  ParamArgs,
  ParamSpec,
  ParamValue,
  PointParam,
  PropParam,
  RequiredParamKeys,
  ResolvedParams,
  TextParam,
} from "./scene/params.js";
export { scene } from "./scene/scene.js";
export type { Scene, SceneOptions } from "./scene/scene.js";
export type { RandomSource } from "./timeline/random.js";
export type { BlendMode, Moment, TextAlign } from "./timeline/segments.js";
export type {
  Timeline,
  TimelineRow,
  TimelineSegment,
  TimelineTrack,
} from "./timeline/timeline.js";
