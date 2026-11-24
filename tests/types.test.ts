// The DOM lib is already in this program by default; naming it keeps R6's check working
// if `lib` is ever set. The build config (lib ES2023, src only) still has no DOM.
/// <reference lib="dom" />
import type {
  CanvasGradient as SkiaGradient,
  CanvasRenderingContext2D as SkiaContext,
  TextMetrics as SkiaTextMetrics,
} from "skia-canvas";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type ActionDefinition,
  type ActionOptions,
  type Actor,
  type AnchorPart,
  type EffectAnchor,
  type EffectOptions,
  type ActorOptions,
  AsyncBuildError,
  type BackdropDefinition,
  type BuiltinActions,
  builtinActions,
  type BuiltinBackdrops,
  builtinBackdrops,
  type BuiltinEffects,
  builtinEffects,
  type BuiltinExpressions,
  builtinExpressions,
  type BuiltinName,
  type BuiltinProps,
  builtinProps,
  type Clip,
  defineAction,
  defineBackdrop,
  defineEffect,
  defineExpression,
  defineProp,
  type Definition,
  type EffectDefinition,
  type ExpressionDefinition,
  type ExpressOptions,
  type FaceChannels,
  type HoldOptions,
  InvalidDefaultError,
  InvalidDefinitionError,
  InvalidPathDataError,
  type ItemKind,
  type ItemOptions,
  type MoveOptions,
  type NoParams,
  type ParamArgs,
  type ParamSpec,
  type PlaceOptions,
  type Prop,
  type PropDefinition,
  ReservedParameterError,
  type ResolvedParams,
  type BlendMode,
  type ChannelName,
  CharadeError,
  type CheckReport,
  checkReport,
  COULD_NOT_RUN,
  type CycleKey,
  type CycleOptions,
  type DrawFunction,
  type DrawingContext,
  type DrawOptions,
  drawText,
  type DrawTextOptions,
  type DriveOptions,
  type EffectorName,
  type ExitCode,
  exitCodeFor,
  type Finding,
  type FindingCollector,
  type Gradient,
  type LabelOptions,
  type DrawMoment,
  type Moment,
  type MotionFunction,
  type Point,
  type PoseChannels,
  type PoseOptions,
  type RandomSource,
  type ReachOptions,
  type Row,
  type RowView,
  type SayOptions,
  type Scene,
  scene,
  type SceneClosedError,
  type SceneOptions,
  type Severity,
  type ShapeContext,
  type SourceLocation,
  type Span,
  svgPath,
  type SvgPathOptions,
  type Stage,
  type TextAlign,
  type TextMeasurement,
  type TextSize,
  type Timeline,
  type TimelineRow,
  type TimelineSegment,
  type TimelineTrack,
  UnknownFlagError,
  UnknownRowError,
} from "../src/index.js";

class FirstError extends CharadeError {
  readonly code = "ERR_FIRST" as const;
}

class SecondError extends CharadeError {
  readonly code = "ERR_SECOND" as const;
  readonly limit = 1;
}

// These are compile-time assertions about the public surface. They run under
// Vitest so a broken type contract fails the same gate as a broken behavior,
// while tests/package.test.ts checks the *published declarations* from a
// consumer's point of view.
describe("public API types", () => {
  it("types CharadeError's code as a string", () => {
    expectTypeOf<CharadeError["code"]>().toEqualTypeOf<string>();
  });

  it("keeps a subclass's code as its literal type", () => {
    expectTypeOf<FirstError["code"]>().toEqualTypeOf<"ERR_FIRST">();
  });

  it("narrows a union of subclasses by code", () => {
    // Taken as a parameter so the union is not narrowed by an initializer.
    const classify = (error: FirstError | SecondError): void => {
      if (error.code === "ERR_SECOND") {
        expectTypeOf(error).toEqualTypeOf<SecondError>();
        expectTypeOf(error.limit).toEqualTypeOf<number>();
      } else {
        expectTypeOf(error).toEqualTypeOf<FirstError>();
      }
    };
    classify(new FirstError("first"));
    classify(new SecondError("second"));
  });

  it("accepts a message and standard error options", () => {
    expectTypeOf(FirstError).toBeConstructibleWith("message");
    expectTypeOf(FirstError).toBeConstructibleWith("message", { cause: new Error() });
  });

  it("is abstract, so only a subclass is constructible", () => {
    expectTypeOf<typeof CharadeError>().not.toExtend<
      new (message: string) => CharadeError
    >();
    expectTypeOf<typeof FirstError>().toExtend<new (message: string) => CharadeError>();
  });

  it("refuses a subclass that declares no code", () => {
    // Declared but never invoked: the assertion is that this body fails to
    // compile without the `@ts-expect-error` comment.
    const rejected = (): void => {
      // @ts-expect-error a subclass must declare its code
      class Uncoded extends CharadeError {}
      expectTypeOf(Uncoded).toBeObject();
    };
    expect(rejected).toBeTypeOf("function");
  });
});

describe("finding types", () => {
  it("types severity as error or warning", () => {
    expectTypeOf<Severity>().toEqualTypeOf<"error" | "warning">();
  });

  it("requires code, severity, message and fix", () => {
    expectTypeOf<
      Pick<Finding, "code" | "severity" | "message" | "fix">
    >().toEqualTypeOf<{
      readonly code: string;
      readonly severity: Severity;
      readonly message: string;
      readonly fix: string;
    }>();
  });

  it("makes every location field optional", () => {
    expectTypeOf<Finding["row"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Finding["target"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Finding["joint"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Finding["time"]>().toEqualTypeOf<
      readonly [start: number, end: number] | undefined
    >();
    expectTypeOf<Finding["frames"]>().toEqualTypeOf<
      readonly [first: number, last: number] | undefined
    >();
    expectTypeOf<Finding["source"]>().toEqualTypeOf<SourceLocation | undefined>();
    expectTypeOf<{
      code: "ERR_CHECK_X";
      severity: "error";
      message: string;
      fix: string;
    }>().toExtend<Finding>();
  });

  it("allows measured values and nearest names", () => {
    expectTypeOf<Finding["measured"]>().toEqualTypeOf<
      Readonly<Record<string, number>> | undefined
    >();
    expectTypeOf<Finding["nearest"]>().toEqualTypeOf<readonly string[] | undefined>();
  });

  it("rejects a severity outside the two", () => {
    const rejected = (): Finding => ({
      code: "ERR_CHECK_X",
      // @ts-expect-error severity is error or warning
      severity: "info",
      message: "m",
      fix: "f",
    });
    expect(rejected).toBeTypeOf("function");
  });

  it("maps findings to 0 or 1, and could-not-run to 2", () => {
    expectTypeOf(exitCodeFor).returns.toEqualTypeOf<0 | 1>();
    expectTypeOf(exitCodeFor).returns.toExtend<ExitCode>();
    expectTypeOf(COULD_NOT_RUN).toEqualTypeOf<2>();
    expectTypeOf<ExitCode>().toEqualTypeOf<0 | 1 | 2>();
  });

  it("types the report as version, ok, findings and summary", () => {
    expectTypeOf(checkReport).returns.toEqualTypeOf<CheckReport>();
    expectTypeOf<keyof CheckReport>().toEqualTypeOf<
      "version" | "ok" | "findings" | "summary"
    >();
    expectTypeOf<CheckReport["version"]>().toEqualTypeOf<1>();
  });

  it("exposes the collected findings read-only", () => {
    expectTypeOf<FindingCollector["findings"]>().toEqualTypeOf<readonly Finding[]>();
    expectTypeOf<FindingCollector["add"]>().returns.toEqualTypeOf<boolean>();
  });
});

describe("thrown error types", () => {
  it("keeps UnknownFlagError's code as its literal", () => {
    expectTypeOf<UnknownFlagError["code"]>().toEqualTypeOf<"ERR_CLI_UNKNOWN_FLAG">();
  });

  it("holds the flag's path and no rejected value", () => {
    expectTypeOf<Exclude<keyof UnknownFlagError, keyof Error>>().toEqualTypeOf<
      "code" | "path"
    >();
    expectTypeOf<UnknownFlagError["path"]>().toEqualTypeOf<string>();
  });

  it("is constructed from the path alone", () => {
    expectTypeOf(UnknownFlagError).toBeConstructibleWith("check.strict");
    expectTypeOf(UnknownFlagError).toBeConstructibleWith("check.strict", {
      cause: new Error(),
    });
    const rejected = (): UnknownFlagError =>
      // @ts-expect-error the constructor takes no value argument
      new UnknownFlagError("check.strict", "--strict=maybe");
    expect(rejected).toBeTypeOf("function");
  });
});

describe("drawing context types", () => {
  it("accepts the DOM's 2D context as the full interface", () => {
    expectTypeOf<CanvasRenderingContext2D>().toExtend<DrawingContext>();
    expectTypeOf<CanvasGradient>().toExtend<Gradient>();
    expectTypeOf<TextMetrics>().toExtend<TextMeasurement>();
  });

  it("accepts skia-canvas's 2D context as the full interface", () => {
    expectTypeOf<SkiaContext>().not.toBeAny();
    expectTypeOf<SkiaContext>().toExtend<DrawingContext>();
    expectTypeOf<SkiaGradient>().toExtend<Gradient>();
    expectTypeOf<SkiaTextMetrics>().toExtend<TextMeasurement>();
  });

  it("makes the full interface the shape context plus reset and text", () => {
    expectTypeOf<DrawingContext>().toExtend<ShapeContext>();
    expectTypeOf<Exclude<keyof DrawingContext, keyof ShapeContext>>().toEqualTypeOf<
      | "reset"
      | "fillText"
      | "strokeText"
      | "measureText"
      | "font"
      | "textAlign"
      | "textBaseline"
      | "direction"
      | "letterSpacing"
      | "wordSpacing"
      | "fontKerning"
      | "fontStretch"
      | "textRendering"
    >();
  });

  it("leaves text out of the shape context", () => {
    expectTypeOf<
      Extract<
        keyof ShapeContext,
        | "fillText"
        | "strokeText"
        | "measureText"
        | "font"
        | "textAlign"
        | "textBaseline"
        | "direction"
        | "letterSpacing"
        | "wordSpacing"
        | "fontKerning"
        | "fontStretch"
        | "textRendering"
        | "fontVariantCaps"
      >
    >().toEqualTypeOf<never>();
  });

  it("leaves images, patterns, pixel readback and the canvas out", () => {
    expectTypeOf<
      Extract<
        keyof DrawingContext,
        | "drawImage"
        | "createPattern"
        | "getImageData"
        | "putImageData"
        | "createImageData"
        | "imageSmoothingEnabled"
        | "canvas"
      >
    >().toEqualTypeOf<never>();
  });

  it("reads a style as any paint and writes a colour or a gradient", () => {
    const paint = (ctx: ShapeContext, gradient: Gradient): void => {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = gradient;
    };
    expectTypeOf<ShapeContext["fillStyle"]>().toEqualTypeOf<string | object>();
    expect(paint).toBeTypeOf("function");
    const rejected = (ctx: ShapeContext): void => {
      // @ts-expect-error a style takes a colour or a gradient, not any object
      ctx.fillStyle = { color: "red" };
    };
    expect(rejected).toBeTypeOf("function");
  });

  it("reads a keyword property as a string and writes a standard keyword", () => {
    const align = (ctx: DrawingContext): void => {
      ctx.textAlign = "center";
    };
    expectTypeOf<DrawingContext["textAlign"]>().toEqualTypeOf<string>();
    expect(align).toBeTypeOf("function");
    const rejected = (ctx: DrawingContext): void => {
      // @ts-expect-error justify is not a standard value
      ctx.textAlign = "justify";
    };
    expect(rejected).toBeTypeOf("function");
  });

  it("returns gradients and measurements as this package's types", () => {
    expectTypeOf<
      ReturnType<ShapeContext["createLinearGradient"]>
    >().toEqualTypeOf<Gradient>();
    expectTypeOf<
      ReturnType<DrawingContext["measureText"]>
    >().toEqualTypeOf<TextMeasurement>();
  });
});

describe("scene types", () => {
  it("returns a Scene from both call forms", () => {
    const built = scene({ duration: 1 }, () => undefined);
    expectTypeOf(built).toEqualTypeOf<Scene>();
    expectTypeOf(scene(() => undefined)).toEqualTypeOf<Scene>();
    expectTypeOf(scene).parameter(0).toExtend<object>();
  });

  it("keeps the kind and the version as literals", () => {
    expectTypeOf<Scene["kind"]>().toEqualTypeOf<"charade.scene">();
    expectTypeOf<Scene["version"]>().toEqualTypeOf<1>();
    expectTypeOf<keyof Scene>().toEqualTypeOf<
      | "kind"
      | "version"
      | "width"
      | "height"
      | "font"
      | "timeline"
      | "findings"
      | "truncated"
    >();
    expectTypeOf<Scene["findings"]>().toEqualTypeOf<readonly Finding[]>();
    expectTypeOf<Scene["font"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Scene["timeline"]>().toEqualTypeOf<Timeline>();
  });

  it("makes the scene read-only", () => {
    const rejected = (built: Scene): void => {
      // @ts-expect-error a built scene is frozen data
      built.width = 1920;
    };
    expect(rejected).toBeTypeOf("function");
  });

  it("makes every scene option an optional number, but for the font", () => {
    expectTypeOf<SceneOptions>().toEqualTypeOf<{
      readonly width?: number;
      readonly height?: number;
      readonly fps?: number;
      readonly rows?: number;
      readonly seed?: number;
      readonly font?: string;
      readonly duration?: number;
    }>();
    expectTypeOf<{ readonly fps: number }>().toExtend<SceneOptions>();
  });

  it("hands build the stage and ignores what it returns", () => {
    const built = scene({ rows: 4, duration: 1 }, (stage) => {
      expectTypeOf(stage).toEqualTypeOf<Stage>();
      return stage.row(3);
    });
    expectTypeOf(built).toEqualTypeOf<Scene>();
  });

  it("rejects an option the scene does not have, and a missing build", () => {
    const rejected = (): void => {
      // @ts-expect-error fsp is not a scene option
      scene({ fsp: 24 }, () => undefined);
      // @ts-expect-error options alone are not a scene
      scene({ fps: 24 });
    };
    expect(rejected).toBeTypeOf("function");
    expectTypeOf(scene({ fps: 24 }, () => undefined)).toEqualTypeOf<Scene>();
  });

  it("exposes the timeline as rows of tracks of segments", () => {
    expectTypeOf<Timeline["rows"]>().toEqualTypeOf<readonly TimelineRow[]>();
    expectTypeOf<TimelineRow["tracks"]>().toEqualTypeOf<readonly TimelineTrack[]>();
    expectTypeOf<TimelineTrack["segments"]>().toEqualTypeOf<
      readonly TimelineSegment[]
    >();
    expectTypeOf<TimelineSegment>().toEqualTypeOf<{
      readonly start: number;
      readonly end: number | null;
      readonly data: unknown;
    }>();
    expectTypeOf<Timeline["duration"]>().toEqualTypeOf<number | null>();
  });
});

describe("span types", () => {
  it("is four read-only fields in seconds", () => {
    expectTypeOf<keyof Span>().toEqualTypeOf<"start" | "end" | "duration" | "marks">();
    expectTypeOf<Span["start"]>().toEqualTypeOf<number>();
    expectTypeOf<Span["end"]>().toEqualTypeOf<number>();
    expectTypeOf<Span["duration"]>().toEqualTypeOf<number>();
  });

  it("has no marks unless the call states some", () => {
    expectTypeOf<keyof Span["marks"]>().toEqualTypeOf<never>();
    expectTypeOf<Span["marks"]>().not.toHaveProperty("release");
  });

  it("types the marks a call states by name", () => {
    const release = (span: Span<"release" | "catch">): number => span.marks.release;
    expectTypeOf(release).returns.toEqualTypeOf<number>();
    expectTypeOf<Span<"release">["marks"]>().toEqualTypeOf<
      Readonly<Record<"release", number>>
    >();
  });

  it("accepts a span with marks where a plain span is asked for", () => {
    expectTypeOf<Span<"release">>().toExtend<Span>();
    expectTypeOf<Span>().not.toExtend<Span<"release">>();
  });

  it("is what every recording call returns", () => {
    expectTypeOf<Actor["pose"]>().returns.toEqualTypeOf<Span>();
    expectTypeOf<Actor["reach"]>().returns.toEqualTypeOf<Span>();
    expectTypeOf<Actor["drive"]>().returns.toEqualTypeOf<Span>();
    expectTypeOf<Actor["wait"]>().returns.toEqualTypeOf<Span>();
    expectTypeOf<Row["draw"]>().returns.toEqualTypeOf<Span>();
  });
});

describe("handle types", () => {
  it("makes the stage a row with row() and sync()", () => {
    expectTypeOf<Stage>().toExtend<Row>();
    expectTypeOf<Exclude<keyof Stage, keyof Row>>().toEqualTypeOf<"row" | "sync">();
    expectTypeOf<Stage["row"]>().toEqualTypeOf<(index: number) => Row>();
    expectTypeOf<Stage["sync"]>().toEqualTypeOf<() => number>();
  });

  it("gives a row an id, an index, an actor, free drawing and its items", () => {
    expectTypeOf<keyof Row>().toEqualTypeOf<
      "id" | "index" | "actor" | "draw" | "label" | "prop" | "backdrop" | "effect"
    >();
    expectTypeOf<Row["actor"]>().toEqualTypeOf<(options?: ActorOptions) => Actor>();
    expectTypeOf<Row["draw"]>().toEqualTypeOf<
      (draw: DrawFunction, options?: DrawOptions) => Span
    >();
  });

  it("gives an actor an id, its four calls, and do and express", () => {
    expectTypeOf<keyof Actor>().toEqualTypeOf<
      "id" | "pose" | "reach" | "drive" | "cycle" | "wait" | "say" | "do" | "express"
    >();
    expectTypeOf<Actor["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Actor["pose"]>().parameters.toEqualTypeOf<
      [channels: PoseChannels, options?: PoseOptions | undefined]
    >();
    expectTypeOf<Actor["reach"]>().parameters.toEqualTypeOf<
      [effector: EffectorName, target: Point, options?: ReachOptions | undefined]
    >();
    expectTypeOf<Actor["drive"]>().parameters.toEqualTypeOf<
      [motion: MotionFunction, options?: DriveOptions | undefined]
    >();
    expectTypeOf<Actor["wait"]>().parameters.toEqualTypeOf<[seconds: number]>();
  });

  it("takes a cycle as keyed values and a period, and returns a span", () => {
    expectTypeOf<Actor["cycle"]>().toEqualTypeOf<
      (keys: readonly CycleKey[], options: CycleOptions) => Span
    >();
    expectTypeOf<Clip["cycle"]>().toEqualTypeOf<Actor["cycle"]>();
    expectTypeOf<CycleKey>().toEqualTypeOf<{
      readonly at: number;
      readonly channels: PoseChannels;
    }>();
    expectTypeOf<keyof CycleOptions>().toEqualTypeOf<
      "period" | "at" | "duration" | "blend" | "mode"
    >();
    expectTypeOf<CycleOptions["period"]>().toEqualTypeOf<number>();
    const rejected = (actor: Actor): void => {
      // @ts-expect-error a cycle needs its period
      actor.cycle([{ at: 0, channels: { chest: 0 } }]);
      // @ts-expect-error a cycle needs its period, also beside other options
      actor.cycle([{ at: 0, channels: { chest: 0 } }], { duration: 1 });
      // @ts-expect-error chst is not a channel
      actor.cycle([{ at: 0, channels: { chst: 0 } }], { period: 1 });
      // @ts-expect-error a cycle takes keys, not a function
      actor.cycle((t: number) => ({ chest: t }), { period: 1 });
    };
    expect(rejected).toBeTypeOf("function");
  });

  it("names the channels and the effectors", () => {
    expectTypeOf<"kneeR" | "pelvisX" | "mouthCurve">().toExtend<ChannelName>();
    expectTypeOf<EffectorName>().toEqualTypeOf<"handL" | "handR" | "footL" | "footR">();
    expectTypeOf<EffectorName>().not.toExtend<ChannelName>();
    expectTypeOf<Point>().toEqualTypeOf<{ readonly x: number; readonly y: number }>();
  });

  it("takes a pose as numbers by channel name", () => {
    const posed = (actor: Actor): Span => actor.pose({ kneeR: 1.2, eyeOpen: 0.5 });
    expectTypeOf(posed).returns.toEqualTypeOf<Span>();
    expectTypeOf<PoseChannels["kneeR"]>().toEqualTypeOf<number | undefined>();
    const rejected = (actor: Actor): void => {
      // @ts-expect-error kneR is not a channel
      actor.pose({ kneR: 1.2 });
      // @ts-expect-error a hand is a target for reach, not a channel
      actor.pose({ handR: 1 });
      // @ts-expect-error a pose takes numbers, not functions
      actor.pose({ kneeR: (t: number) => t });
    };
    expect(rejected).toBeTypeOf("function");
  });

  it("takes a drive as one function of time returning numbers by channel name", () => {
    const driven = (actor: Actor): Span =>
      actor.drive((t, moment) => {
        expectTypeOf(t).toEqualTypeOf<number>();
        expectTypeOf(moment).toEqualTypeOf<Moment>();
        return { spine: Math.sin(t * 3) * 0.1 };
      });
    expectTypeOf(driven).returns.toEqualTypeOf<Span>();
    expectTypeOf<MotionFunction>().toEqualTypeOf<
      (t: number, moment: Moment) => PoseChannels
    >();
    const rejected = (actor: Actor): void => {
      // @ts-expect-error a drive takes a function, not a map of values
      actor.drive({ spine: 0.1 });
      // @ts-expect-error spin is not a channel
      actor.drive((t: number) => ({ spin: t }));
      // @ts-expect-error a hand is a target for reach, not a channel
      actor.drive(() => ({ handR: 1 }));
    };
    expect(rejected).toBeTypeOf("function");
  });

  it("takes a reach as an effector and a point", () => {
    const reached = (actor: Actor): Span =>
      actor.reach("handR", { x: 0.2, y: 0.8 }, { at: 1.2 });
    expectTypeOf(reached).returns.toEqualTypeOf<Span>();
    const rejected = (actor: Actor): void => {
      // @ts-expect-error a knee is an angle, not a target
      actor.reach("kneeR", { x: 0.2, y: 0.8 });
      // @ts-expect-error a reach has no mode
      actor.reach("handR", { x: 0.2, y: 0.8 }, { mode: "add" });
    };
    expect(rejected).toBeTypeOf("function");
  });

  it("types mode as replace or add", () => {
    expectTypeOf<BlendMode>().toEqualTypeOf<"replace" | "add">();
    expectTypeOf<PoseOptions["mode"]>().toEqualTypeOf<BlendMode | undefined>();
    expectTypeOf<DriveOptions["mode"]>().toEqualTypeOf<BlendMode | undefined>();
    expectTypeOf<keyof PoseOptions>().toEqualTypeOf<
      "at" | "duration" | "blend" | "mode" | "anticipation" | "followThrough"
    >();
    expectTypeOf<keyof ReachOptions>().toEqualTypeOf<
      "at" | "duration" | "blend" | "anticipation" | "followThrough"
    >();
    expectTypeOf<keyof DriveOptions>().toEqualTypeOf<
      "at" | "duration" | "blend" | "mode"
    >();
    expectTypeOf<keyof DrawOptions>().toEqualTypeOf<"at" | "duration" | "name">();
    const rejected = (actor: Actor): void => {
      // @ts-expect-error multiply is not a mode
      actor.pose({ spine: 0.1 }, { mode: "multiply" });
    };
    expect(rejected).toBeTypeOf("function");
  });

  it("hands a depth 4 drawing the shape context, the time and the moment", () => {
    const drawn = (row: Row): Span =>
      row.draw((ctx, t, moment) => {
        expectTypeOf(ctx).toEqualTypeOf<ShapeContext>();
        expectTypeOf(t).toEqualTypeOf<number>();
        expectTypeOf(moment).toEqualTypeOf<DrawMoment>();
      });
    expectTypeOf(drawn).returns.toEqualTypeOf<Span>();
    expectTypeOf<DrawFunction>().toEqualTypeOf<
      (ctx: ShapeContext, t: number, moment: DrawMoment) => void
    >();
    expectTypeOf<Parameters<DrawFunction>[0]>().not.toHaveProperty("fillText");
  });

  it("gives a depth 4 drawing no reset, while the engine's full context keeps it", () => {
    expectTypeOf<Parameters<DrawFunction>[0]>().not.toHaveProperty("reset");
    expectTypeOf<DrawingContext>().toHaveProperty("reset");
    const kept = (row: Row): Span =>
      row.draw((ctx) => {
        ctx.save();
        ctx.resetTransform();
        ctx.restore();
      });
    expectTypeOf(kept).returns.toEqualTypeOf<Span>();
    const reset = (ctx: { reset(): void }): void => {
      ctx.reset();
    };
    const engine = (ctx: DrawingContext): void => {
      reset(ctx);
    };
    expect(engine).toBeTypeOf("function");
    const rejected = (row: Row): Span =>
      row.draw((ctx) => {
        // @ts-expect-error a depth 4 drawing cannot reset the frame's context
        reset(ctx);
      });
    expect(rejected).toBeTypeOf("function");
  });

  it("gives a function the scene time, its segment and the random source", () => {
    expectTypeOf<Moment>().toEqualTypeOf<{
      readonly time: number;
      readonly duration: number;
      readonly progress: number;
      readonly random: RandomSource;
    }>();
    expectTypeOf<RandomSource["float"]>().toEqualTypeOf<(draw?: number) => number>();
    expectTypeOf<RandomSource["uint32"]>().toEqualTypeOf<(draw?: number) => number>();
  });

  it("gives a drawing function the moment, its time in the segment and the row's visible area", () => {
    expectTypeOf<RowView>().toEqualTypeOf<{
      readonly left: number;
      readonly right: number;
      readonly bottom: number;
      readonly top: number;
    }>();
    expectTypeOf<DrawMoment>().toExtend<Moment>();
    expectTypeOf<DrawMoment["view"]>().toEqualTypeOf<RowView>();
    expectTypeOf<DrawMoment["t"]>().toEqualTypeOf<number>();
    expectTypeOf<keyof DrawMoment>().toEqualTypeOf<keyof Moment | "t" | "view">();
    // A drive has no row to see and its `t` as an argument: its moment is the plain one.
    expectTypeOf<Parameters<MotionFunction>[1]>().not.toHaveProperty("view");
    expectTypeOf<Parameters<MotionFunction>[1]>().not.toHaveProperty("t");
    defineBackdrop({
      name: "wide",
      description: "A backdrop that reads the row's edges.",
      draw(ctx, _params, moment) {
        expectTypeOf(moment).toEqualTypeOf<DrawMoment>();
        ctx.fillRect(moment.view.left, 0, moment.view.right - moment.view.left, 1);
      },
    });
    // A draw written against the plain moment is still a draw.
    const older = (_ctx: ShapeContext, _params: object, moment: Moment): void => {
      expect(moment.time).toBeTypeOf("number");
    };
    expectTypeOf(
      defineProp({ name: "older", description: "Written before view.", draw: older }),
    ).toExtend<PropDefinition>();
  });
});

describe("scene error types", () => {
  it("keeps each code as its literal", () => {
    expectTypeOf<AsyncBuildError["code"]>().toEqualTypeOf<"ERR_SCENE_ASYNC_BUILD">();
    expectTypeOf<UnknownRowError["code"]>().toEqualTypeOf<"ERR_SCENE_UNKNOWN_ROW">();
    expectTypeOf<SceneClosedError["code"]>().toEqualTypeOf<"ERR_SCENE_CLOSED">();
  });

  it("narrows the three by code", () => {
    const classify = (
      error: AsyncBuildError | UnknownRowError | SceneClosedError,
    ): void => {
      if (error.code === "ERR_SCENE_UNKNOWN_ROW") {
        expectTypeOf(error).toEqualTypeOf<UnknownRowError>();
        expectTypeOf(error.rows).toEqualTypeOf<number>();
      } else {
        expectTypeOf(error).toEqualTypeOf<AsyncBuildError | SceneClosedError>();
      }
    };
    classify(new UnknownRowError(4));
    classify(new AsyncBuildError());
  });

  it("holds the row count and no rejected index", () => {
    expectTypeOf<Exclude<keyof UnknownRowError, keyof Error>>().toEqualTypeOf<
      "code" | "rows"
    >();
    expectTypeOf(UnknownRowError).toBeConstructibleWith(4);
    expectTypeOf(UnknownRowError).toBeConstructibleWith(4, { cause: new Error() });
    const rejected = (): UnknownRowError =>
      // @ts-expect-error the constructor takes the row count, not a message
      new UnknownRowError("row 4");
    expect(rejected).toBeTypeOf("function");
  });
});

const speedParams = {
  speed: { type: "number", default: 1, min: 0.5, max: 2, doc: "How fast." },
  side: { type: "enum", values: ["left", "right"], doc: "Which side." },
  target: { type: "prop", doc: "What is moved." },
} as const;

describe("parameter types", () => {
  // R5
  it("makes a key without a default required and one with a default optional", () => {
    expectTypeOf<ParamArgs<typeof speedParams>>().toEqualTypeOf<
      {
        readonly side: "left" | "right";
        readonly target: Prop;
      } & { readonly speed?: number }
    >();
    const accepted: ParamArgs<typeof speedParams>[] = [];
    const reject = (prop: Prop): void => {
      // @ts-expect-error side has no default, so it is required
      accepted.push({ target: prop });
      accepted.push({ side: "left", target: prop });
    };
    expect(reject).toBeTypeOf("function");
  });

  it("gives build every parameter, defaults filled in", () => {
    expectTypeOf<ResolvedParams<typeof speedParams>>().toEqualTypeOf<{
      readonly speed: number;
      readonly side: "left" | "right";
      readonly target: Prop;
    }>();
  });

  it("types every parameter kind's value", () => {
    defineProp({
      name: "all",
      description: "",
      params: {
        a: { type: "boolean", default: true, doc: "d" },
        b: { type: "color", default: "#000", doc: "d" },
        c: { type: "point", doc: "d" },
        d: { type: "text", doc: "d" },
      },
      draw(_ctx, params) {
        expectTypeOf(params).toEqualTypeOf<{
          readonly a: boolean;
          readonly b: string;
          readonly c: Point;
          readonly d: string;
        }>();
      },
    });
  });
});

describe("definition types", () => {
  const params = { speed: speedParams.speed } as const;
  const wave = defineAction({
    name: "wave",
    description: "",
    params,
    marks: ["peak"],
    build(clip, resolved) {
      expectTypeOf(clip).toEqualTypeOf<Clip<"peak">>();
      expectTypeOf(resolved).toEqualTypeOf<ResolvedParams<typeof params>>();
    },
  });

  it("infers the parameters and the marks, unwidened", () => {
    expectTypeOf(wave).toEqualTypeOf<ActionDefinition<typeof params, "peak">>();
    expectTypeOf(
      defineAction({ name: "x", description: "", build: () => undefined }),
    ).toEqualTypeOf<ActionDefinition<NoParams, never>>();
  });

  it("keeps a specific definition assignable to the general type", () => {
    expectTypeOf(wave).toExtend<ActionDefinition>();
    expectTypeOf(wave).toExtend<Definition>();
    const smug = defineExpression({ name: "s", description: "", build: () => ({}) });
    expectTypeOf(smug).toEqualTypeOf<ExpressionDefinition<NoParams>>();
    expectTypeOf(smug).toExtend<ExpressionDefinition>();
    const drawn = { name: "p", description: "", draw: (): void => undefined };
    expectTypeOf(defineProp(drawn)).toEqualTypeOf<PropDefinition<NoParams>>();
    expectTypeOf(defineBackdrop(drawn)).toEqualTypeOf<BackdropDefinition<NoParams>>();
    expectTypeOf(defineEffect(drawn)).toEqualTypeOf<EffectDefinition<NoParams>>();
    expectTypeOf<PropDefinition<typeof params>>().toExtend<PropDefinition>();
  });

  it("types an expression's result as face channels", () => {
    expectTypeOf<ExpressionDefinition["build"]>().returns.toEqualTypeOf<FaceChannels>();
    expectTypeOf<keyof FaceChannels>().toEqualTypeOf<
      | "eyeOpen"
      | "gazeX"
      | "gazeY"
      | "browHeight"
      | "browTilt"
      | "mouthCurve"
      | "mouthOpen"
      | "mouthWidth"
    >();
  });

  it("names the five kinds", () => {
    expectTypeOf<Definition["kind"]>().toEqualTypeOf<ItemKind>();
    expectTypeOf<ItemKind>().toEqualTypeOf<
      "action" | "expression" | "prop" | "backdrop" | "effect"
    >();
  });

  it("rejects a parameter specification that is not plain data", () => {
    const rejected = (): unknown =>
      defineAction({
        name: "x",
        description: "",
        // @ts-expect-error "date" is not a parameter type
        params: { when: { type: "date", doc: "d" } },
        build: () => undefined,
      });
    expect(rejected).toBeTypeOf("function");
    expectTypeOf<{
      readonly a: { readonly type: "text"; readonly doc: "d" };
    }>().toExtend<ParamSpec>();
  });
});

describe("using definitions", () => {
  const params = { speed: speedParams.speed, side: speedParams.side } as const;
  const sway = defineAction({
    name: "sway",
    description: "",
    params,
    marks: ["peak"],
    build: () => undefined,
  });
  const free = defineAction({ name: "free", description: "", build: () => undefined });

  it("returns a span with the action's marks", () => {
    const record = (actor: Actor): void => {
      expectTypeOf(actor.do(sway, { side: "left" })).toEqualTypeOf<Span<"peak">>();
      expectTypeOf(actor.do(free)).toEqualTypeOf<Span>();
      actor.do(free, { at: 1, duration: 2, blend: 0.1, mode: "add" });
    };
    expect(record).toBeTypeOf("function");
  });

  it("requires the bag when a parameter is required, and rejects an unknown key", () => {
    const rejected = (actor: Actor): void => {
      // @ts-expect-error side is required
      actor.do(sway);
      // @ts-expect-error sped is neither a parameter nor an option
      actor.do(sway, { side: "left", sped: 1 });
      // @ts-expect-error 2 is not one of the side's values
      actor.do(sway, { side: 2 });
    };
    expect(rejected).toBeTypeOf("function");
  });

  it("names the built-ins in the maps, and none where a kind has no item yet", () => {
    expectTypeOf<keyof BuiltinActions>().toEqualTypeOf<
      | "carry"
      | "cheer"
      | "pickUp"
      | "point"
      | "push"
      | "run"
      | "sitDown"
      | "slump"
      | "stand"
      | "think"
      | "throw"
      | "walk"
    >();
    expectTypeOf<keyof BuiltinExpressions>().toEqualTypeOf<
      "angry" | "dejected" | "focused" | "happy" | "neutral" | "surprised"
    >();
    expectTypeOf<keyof BuiltinProps>().toEqualTypeOf<
      | "ball"
      | "box"
      | "cart"
      | "desk"
      | "hoop"
      | "ladder"
      | "laptop"
      | "lever"
      | "lightbulb"
      | "rock"
    >();
    expectTypeOf<keyof BuiltinBackdrops>().toEqualTypeOf<
      "court" | "hill" | "night" | "office" | "plain"
    >();
    expectTypeOf<BuiltinName<BuiltinProps>>().toEqualTypeOf<
      | "ball"
      | "box"
      | "cart"
      | "desk"
      | "hoop"
      | "ladder"
      | "laptop"
      | "lever"
      | "lightbulb"
      | "rock"
    >();
    expectTypeOf<BuiltinName<{ readonly a: 1; readonly 2: 2 }>>().toEqualTypeOf<"a">();
    expectTypeOf<BuiltinName<BuiltinEffects>>().toEqualTypeOf<
      "impact" | "sparkle" | "speedLines" | "sweat"
    >();
    expectTypeOf(builtinActions).toEqualTypeOf<BuiltinActions>();
    expectTypeOf(builtinExpressions).toEqualTypeOf<BuiltinExpressions>();
    expectTypeOf(builtinProps).toEqualTypeOf<BuiltinProps>();
    expectTypeOf(builtinBackdrops).toEqualTypeOf<BuiltinBackdrops>();
    expectTypeOf(builtinEffects).toEqualTypeOf<BuiltinEffects>();
    expectTypeOf(builtinActions.throw).toExtend<ActionDefinition>();
    expectTypeOf(builtinExpressions.neutral).toEqualTypeOf<
      ExpressionDefinition<NoParams>
    >();
    expectTypeOf(builtinProps.ball).toExtend<PropDefinition>();
  });

  it("types a built-in action's parameters and marks by its name", () => {
    const record = (actor: Actor, row: Row): void => {
      const ball = row.prop("ball");
      expectTypeOf(ball).toEqualTypeOf<Prop>();
      expectTypeOf(actor.do("throw", { ball })).toEqualTypeOf<Span<"release">>();
      expectTypeOf(
        actor.do("throw", {
          ball,
          to: { x: 1, y: 0.5 },
          loft: 0.4,
          bounce: false,
          mood: "focused",
          at: 1,
        }).marks.release,
      ).toEqualTypeOf<number>();
      expectTypeOf(actor.do("sitDown")).toEqualTypeOf<Span>();
      expectTypeOf(
        actor.do("sitDown", { seat: 0.3, mood: "dejected" }),
      ).toEqualTypeOf<Span>();
      expectTypeOf(actor.do("sitDown", { from: 1 })).toEqualTypeOf<Span>();
      expectTypeOf(
        actor.do("throw", { ball, from: 1, to: { x: 1.6, y: 0 } }),
      ).toEqualTypeOf<Span<"release">>();
      expectTypeOf(
        actor.do("slump", { depth: 0.5, duration: 2 }),
      ).toEqualTypeOf<Span>();
      expectTypeOf(actor.express("dejected", { intensity: 0.5 })).toEqualTypeOf<Span>();
      expectTypeOf(actor.express("neutral")).toEqualTypeOf<Span>();
      expectTypeOf(actor.express("happy")).toEqualTypeOf<Span>();
      expectTypeOf(actor.express("angry", { intensity: 0.5 })).toEqualTypeOf<Span>();
      expectTypeOf(actor.do("sitDown", { mood: "surprised" })).toEqualTypeOf<Span>();
      // #26 R6
      expectTypeOf(actor.do("walk")).toEqualTypeOf<Span>();
      expectTypeOf(
        actor.do("walk", { distance: 1.2, from: -0.6, mood: "happy", duration: 3 }),
      ).toEqualTypeOf<Span>();
      expectTypeOf(actor.do("run", { distance: 2, from: -1 })).toEqualTypeOf<Span>();
      expectTypeOf(actor.do("stand")).toEqualTypeOf<Span>();
      expectTypeOf(
        actor.do("stand", { duration: 2, mood: "dejected" }),
      ).toEqualTypeOf<Span>();
      expectTypeOf(actor.do("think", { ponder: 2 })).toEqualTypeOf<Span>();
      expectTypeOf(actor.do("cheer", { times: 3 })).toEqualTypeOf<Span<"up">>();
      expectTypeOf(actor.do("cheer").marks.up).toEqualTypeOf<number>();
      expectTypeOf(
        actor.do("point", { to: { x: 1, y: 1.5 }, from: 0.9, hold: 1 }).marks.aimed,
      ).toEqualTypeOf<number>();
      expectTypeOf(row.prop("box", { width: 0.5, at: 1 })).toEqualTypeOf<Prop>();
      // #24 R4
      expectTypeOf(row.backdrop("night")).toEqualTypeOf<Span>();
      expectTypeOf(
        row.backdrop("night", { moon: "full", sky: "#202850", duration: 2 }),
      ).toEqualTypeOf<Span>();
      expectTypeOf(row.backdrop("plain", { color: "#ffffff" })).toEqualTypeOf<Span>();
      expectTypeOf(row.backdrop("office", { blinds: false })).toEqualTypeOf<Span>();
      expectTypeOf(row.backdrop("court")).toEqualTypeOf<Span>();
      expectTypeOf(row.backdrop("hill", { grass: "#88bb77" })).toEqualTypeOf<Span>();
      // R5
      expectTypeOf(row.prop("ladder")).toEqualTypeOf<Prop>();
      expectTypeOf(row.prop("ladder", { height: 1.2, lean: 0 })).toEqualTypeOf<Prop>();
      expectTypeOf(
        row.prop("lever", { tilt: 0.4, swing: -0.5, swingAt: 1, handle: "right" }),
      ).toEqualTypeOf<Prop>();
      expectTypeOf(
        row.prop("cart", { roll: 1, rollAt: 1, rollFor: 2 }),
      ).toEqualTypeOf<Prop>();
      expectTypeOf(row.prop("lightbulb", { lit: false, at: 1 })).toEqualTypeOf<Prop>();
      expectTypeOf(row.prop("laptop", { faces: "right" })).toEqualTypeOf<Prop>();
    };
    expect(record).toBeTypeOf("function");
  });

  // #27 R6
  it("types the three actions that move a prop: their prop, parameters and marks", () => {
    const record = (actor: Actor, row: Row): void => {
      const box = row.prop("box");
      expectTypeOf(actor.do("carry", { prop: box })).toEqualTypeOf<
        Span<"loaded" | "off" | "stop">
      >();
      expectTypeOf(
        actor.do("carry", {
          prop: box,
          by: "cart",
          distance: 2,
          from: -1,
          grip: { x: 0, y: 0 },
          deck: { x: 0.7, y: 0.24 },
          handle: { x: 0.3, y: 0.5 },
          mood: "dejected",
          duration: 4,
        }).marks.off,
      ).toEqualTypeOf<number>();
      expectTypeOf(actor.do("pickUp", { prop: box })).toEqualTypeOf<
        Span<"grip" | "up">
      >();
      actor.do("pickUp", { prop: box, where: { x: 0.3, y: 0.5 }, from: 1, at: 2 });
      expectTypeOf(
        actor.do("push", { prop: box, distance: 0.15, by: "lever", tries: 1 }),
      ).toEqualTypeOf<Span<"contact" | "heave" | "stop">>();
      actor.do("push", { prop: box, press: { x: 0, y: -0.3 }, from: -1 });
      // @ts-expect-error cart is neither a parameter of carry nor an option
      actor.do("carry", { prop: box, cart: box });
      // @ts-expect-error prop is required
      actor.do("carry", { distance: 1 });
      // @ts-expect-error prop is required
      actor.do("carry");
      // @ts-expect-error a prop handle is expected, not a number
      actor.do("pickUp", { prop: 3 });
      // @ts-expect-error by is arms or cart
      actor.do("carry", { prop: box, by: "lever" });
      // @ts-expect-error push has no parameter named force
      actor.do("push", { prop: box, force: 2 });
    };
    expect(record).toBeTypeOf("function");
  });

  it("rejects an unknown key, a missing prop and an unknown name of a built-in", () => {
    const rejected = (actor: Actor, row: Row): void => {
      const ball = row.prop("ball");
      // @ts-expect-error bal is neither a parameter of throw nor an option
      actor.do("throw", { ball, bal: ball });
      // @ts-expect-error ball is required
      actor.do("throw");
      // @ts-expect-error ball is required, also beside other keys
      actor.do("throw", { loft: 0.4 });
      // @ts-expect-error a prop handle is expected, not a name
      actor.do("throw", { ball: "ball" });
      // @ts-expect-error loft is a number
      actor.do("throw", { ball, loft: "high" });
      // @ts-expect-error slum is not a built-in action
      actor.do("slum");
      // @ts-expect-error sitDown has no parameter named height
      actor.do("sitDown", { height: 0.3 });
      // #26 R6
      // @ts-expect-error walk has no parameter named speed
      actor.do("walk", { speed: 2 });
      // @ts-expect-error distance is a number
      actor.do("walk", { distance: "far" });
      // @ts-expect-error stand takes no parameter
      actor.do("stand", { breath: 2 });
      // @ts-expect-error to is a point
      actor.do("point", { to: 1 });
      // @ts-expect-error sad is not a built-in expression
      actor.do("slump", { mood: "sad" });
      // @ts-expect-error angy is not a built-in expression
      actor.express("angy");
      // @ts-expect-error happy has no parameter named strength
      actor.express("happy", { strength: 1 });
      // @ts-expect-error neutral takes no parameter
      actor.express("neutral", { intensity: 1 });
      // @ts-expect-error bal is not a built-in prop
      row.prop("bal");
      // @ts-expect-error a placement is behind or in front, not on top
      row.prop("desk").place({ x: 0, y: 0 }, { layer: "top" });
      // @ts-expect-error latop is not a built-in prop
      row.prop("latop");
      // @ts-expect-error ladder has no parameter named rungs
      row.prop("ladder", { rungs: 4 });
      // @ts-expect-error a hoop faces left or right
      row.prop("hoop", { faces: "up" });
      // @ts-expect-error nite is not a built-in backdrop
      row.backdrop("nite");
      // @ts-expect-error a moon is crescent, full or none
      row.backdrop("night", { moon: "half" });
      // @ts-expect-error plain has no parameter named sky
      row.backdrop("plain", { sky: "#000000" });
    };
    expect(rejected).toBeTypeOf("function");
  });

  it("takes a mood as a built-in expression's name or an expression definition", () => {
    const smug = defineExpression({ name: "smug", description: "", build: () => ({}) });
    expectTypeOf<ActionOptions["mood"]>().toEqualTypeOf<
      | "angry"
      | "dejected"
      | "focused"
      | "happy"
      | "neutral"
      | "surprised"
      | ExpressionDefinition
      | undefined
    >();
    expectTypeOf(smug).toExtend<NonNullable<ActionOptions["mood"]>>();
  });

  it("types express, prop, backdrop, effect and place", () => {
    const grin = defineExpression({
      name: "grin",
      description: "",
      params: { width: { type: "number", default: 1, doc: "d" } },
      build: ({ width }) => ({ mouthWidth: width }),
    });
    const ball = defineProp({
      name: "ball",
      description: "",
      params: { radius: { type: "number", doc: "d" } },
      draw: () => undefined,
    });
    const record = (actor: Actor, row: Row): void => {
      expectTypeOf(
        actor.express(grin, { width: 1.2, blend: 0.1 }),
      ).toEqualTypeOf<Span>();
      expectTypeOf(row.prop(ball, { radius: 0.1, at: 1 })).toEqualTypeOf<Prop>();
      // @ts-expect-error radius is required
      row.prop(ball);
      const plain = defineBackdrop({
        name: "plain",
        description: "",
        draw: () => undefined,
      });
      expectTypeOf(row.backdrop(plain, { duration: 2 })).toEqualTypeOf<Span>();
      const sweat = defineEffect({
        name: "sweat",
        description: "",
        draw: () => undefined,
      });
      expectTypeOf(row.effect(sweat)).toEqualTypeOf<Span>();
      expectTypeOf(row.effect(sweat, { on: actor })).toEqualTypeOf<Span>();
      expectTypeOf(row.effect(sweat, { on: { x: 1, y: 0 } })).toEqualTypeOf<Span>();
      expectTypeOf(
        row.effect(sweat, {
          on: { actor, part: "handR", offset: { x: 0, y: 0.1 } },
          at: 1,
          duration: 2,
        }),
      ).toEqualTypeOf<Span>();
      // @ts-expect-error a part is one of six names
      row.effect(sweat, { on: { actor, part: "elbowR" } });
      // @ts-expect-error a prop is not a place for an effect
      row.effect(sweat, { on: row.prop(ball, { radius: 0.1 }) });
      // @ts-expect-error on is an option of an effect, not of a backdrop
      row.backdrop(plain, { on: actor });
      // #25 R6: a built-in effect's name types its parameters.
      expectTypeOf(
        row.effect("sweat", { drops: 4, side: "both", on: actor, duration: 1 }),
      ).toEqualTypeOf<Span>();
      expectTypeOf(
        row.effect("impact", { size: 0.2, spikes: 9 }),
      ).toEqualTypeOf<Span>();
      expectTypeOf(
        row.effect("speedLines", { moving: "left", on: { actor, part: "pelvis" } }),
      ).toEqualTypeOf<Span>();
      expectTypeOf(row.effect("sparkle")).toEqualTypeOf<Span>();
      // @ts-expect-error spakle is not a built-in effect
      row.effect("spakle");
      // @ts-expect-error sweat has no parameter named drop
      row.effect("sweat", { drop: 4 });
      // @ts-expect-error side is one of back, front and both
      row.effect("sweat", { side: "left" });
      expectTypeOf(
        row.prop(ball, { radius: 0.1 }).place({ x: 1, y: 0 }, { at: 1 }),
      ).toEqualTypeOf<Span>();
      expectTypeOf(
        row.prop(ball, { radius: 0.1 }).place({ x: 1, y: 0 }, { layer: "front" }),
      ).toEqualTypeOf<Span>();
    };
    expect(record).toBeTypeOf("function");
    expectTypeOf<keyof ExpressOptions>().toEqualTypeOf<
      "at" | "duration" | "blend" | "mode"
    >();
    expectTypeOf<keyof ItemOptions>().toEqualTypeOf<"at" | "duration">();
    expectTypeOf<keyof EffectOptions>().toEqualTypeOf<"at" | "duration" | "on">();
    expectTypeOf<EffectOptions>().toExtend<ItemOptions>();
    expectTypeOf<EffectOptions["on"]>().toEqualTypeOf<
      Point | Actor | EffectAnchor | undefined
    >();
    expectTypeOf<keyof EffectAnchor>().toEqualTypeOf<"actor" | "part" | "offset">();
    expectTypeOf<AnchorPart>().toEqualTypeOf<
      "head" | "pelvis" | "handL" | "handR" | "footL" | "footR"
    >();
    expectTypeOf<EffectorName>().toExtend<AnchorPart>();
    expectTypeOf<keyof PlaceOptions>().toEqualTypeOf<"at" | "layer">();
    expectTypeOf<PlaceOptions["layer"]>().toEqualTypeOf<
      "behind" | "front" | undefined
    >();
    expectTypeOf<keyof HoldOptions>().toEqualTypeOf<"at" | "offset">();
    expectTypeOf<keyof MoveOptions>().toEqualTypeOf<"at" | "duration" | "arc">();
    const moved = (prop: Prop): void => {
      expectTypeOf(
        prop.hold("handR", { offset: { x: 0, y: -0.05 } }),
      ).toEqualTypeOf<Span>();
      expectTypeOf(prop.move({ x: 1, y: 0 }, { arc: 0.3 })).toEqualTypeOf<Span>();
      // @ts-expect-error spine is a channel, not a hand or a foot
      prop.hold("spine");
    };
    expect(moved).toBeTypeOf("function");
    expectTypeOf<keyof ActionOptions>().toEqualTypeOf<
      "at" | "duration" | "mood" | "blend" | "mode"
    >();
  });

  it("gives a clip the actor's depth 2 and 3 calls and mark", () => {
    expectTypeOf<keyof Clip>().toEqualTypeOf<
      | "id"
      | "duration"
      | "mood"
      | "pose"
      | "reach"
      | "drive"
      | "cycle"
      | "wait"
      | "mark"
    >();
    expectTypeOf<Clip["duration"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Clip<"release">["mark"]>().parameters.toEqualTypeOf<
      [name: "release", at: number]
    >();
    expectTypeOf<keyof Prop>().toEqualTypeOf<"id" | "place" | "hold" | "move">();
  });
});

describe("definition errors", () => {
  it("carries the kind and the path, never the rejected value", () => {
    for (const error of [
      new ReservedParameterError("action", "params.at"),
      new InvalidDefaultError("action", "params.a.default"),
      new InvalidDefinitionError("prop", "draw"),
    ]) {
      expectTypeOf(error.kind).toEqualTypeOf<ItemKind>();
      expectTypeOf(error.path).toEqualTypeOf<string>();
    }
    expectTypeOf<
      ReservedParameterError["code"]
    >().toEqualTypeOf<"ERR_DEFINE_RESERVED_PARAMETER">();
    expectTypeOf<
      InvalidDefaultError["code"]
    >().toEqualTypeOf<"ERR_DEFINE_INVALID_DEFAULT">();
    expectTypeOf<
      InvalidDefinitionError["code"]
    >().toEqualTypeOf<"ERR_DEFINE_INVALID_DEFINITION">();
    expectTypeOf<Exclude<keyof InvalidDefaultError, keyof Error>>().toEqualTypeOf<
      "code" | "kind" | "path"
    >();
  });
});

describe("text types", () => {
  it("gives a row label(text, options) and an actor say(text, options), each a span", () => {
    expectTypeOf<Row["label"]>().toEqualTypeOf<
      (text: string, options?: LabelOptions) => Span
    >();
    expectTypeOf<Stage["label"]>().toEqualTypeOf<Row["label"]>();
    expectTypeOf<Actor["say"]>().toEqualTypeOf<
      (text: string, options?: SayOptions) => Span
    >();
  });

  it("states the options of a label and of a bubble", () => {
    expectTypeOf<TextAlign>().toEqualTypeOf<"left" | "center" | "right">();
    expectTypeOf<LabelOptions>().toEqualTypeOf<{
      readonly at?: number;
      readonly duration?: number;
      readonly x?: number;
      readonly y?: number;
      readonly size?: number;
      readonly align?: TextAlign;
      readonly width?: number;
      readonly name?: string;
    }>();
    expectTypeOf<SayOptions>().toEqualTypeOf<{
      readonly at?: number;
      readonly duration?: number;
      readonly size?: number;
      readonly width?: number;
    }>();
  });

  it("rejects text that is not a string and an unknown alignment", () => {
    const valid = (row: Row, actor: Actor): Span[] => [
      row.label("Before", { at: 0, align: "left" }),
      actor.say("こんにちは", { width: 1.5 }),
    ];
    expectTypeOf(valid).returns.toEqualTypeOf<Span[]>();
    const rejected = (row: Row, actor: Actor): void => {
      // @ts-expect-error text is a string, not a number
      row.label(5);
      // @ts-expect-error the alignment is left, center or right
      row.label("Before", { align: "centre" });
      // @ts-expect-error a bubble is placed by its speaker, not by a point
      actor.say("こんにちは", { x: 1 });
    };
    expect(rejected).toBeTypeOf("function");
  });

  it("draws text on a shape context and returns the block's size", () => {
    expectTypeOf(drawText).toEqualTypeOf<
      (ctx: ShapeContext, text: string, options?: DrawTextOptions) => TextSize
    >();
    expectTypeOf<DrawTextOptions>().toEqualTypeOf<{
      readonly x?: number;
      readonly y?: number;
      readonly size?: number;
      readonly align?: TextAlign;
      readonly width?: number;
    }>();
    expectTypeOf<TextSize>().toEqualTypeOf<{
      readonly width: number;
      readonly height: number;
    }>();
    const valid = (ctx: DrawingContext): TextSize => drawText(ctx, "止まれ", { y: 1 });
    expectTypeOf(valid).returns.toEqualTypeOf<TextSize>();
    const rejected = (ctx: ShapeContext): void => {
      // @ts-expect-error size is a number, not a string
      drawText(ctx, "止まれ", { size: "big" });
    };
    expect(rejected).toBeTypeOf("function");
  });
});

describe("path data types", () => {
  it("takes a shape context, the d string and optional options, and returns nothing", () => {
    expectTypeOf(svgPath).toEqualTypeOf<
      (ctx: ShapeContext, d: string, options?: SvgPathOptions) => void
    >();
    expectTypeOf<SvgPathOptions>().toEqualTypeOf<{
      readonly scale?: number;
      readonly origin?: Point;
    }>();
  });

  it("accepts the full drawing context", () => {
    const draw = (ctx: DrawingContext): void => {
      svgPath(ctx, "M0 0 L1 1", { scale: 0.01, origin: { x: 50, y: 100 } });
    };
    expect(draw).toBeTypeOf("function");
    const rejected = (ctx: ShapeContext): void => {
      // @ts-expect-error scale is a number, not a string
      svgPath(ctx, "M0 0", { scale: "0.01" });
    };
    expect(rejected).toBeTypeOf("function");
  });

  it("carries the offset and no rejected value", () => {
    expectTypeOf<
      InvalidPathDataError["code"]
    >().toEqualTypeOf<"ERR_SCENE_INVALID_PATH_DATA">();
    expectTypeOf<Exclude<keyof InvalidPathDataError, keyof Error>>().toEqualTypeOf<
      "code" | "offset"
    >();
    expectTypeOf(InvalidPathDataError).toBeConstructibleWith(8);
  });
});
