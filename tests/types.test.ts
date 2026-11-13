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
  type Actor,
  type ActorOptions,
  AsyncBuildError,
  type BlendMode,
  type ChannelName,
  CharadeError,
  type CheckReport,
  checkReport,
  COULD_NOT_RUN,
  type DrawFunction,
  type DrawingContext,
  type DrawOptions,
  type DriveOptions,
  type EffectorName,
  type ExitCode,
  exitCodeFor,
  type Finding,
  type FindingCollector,
  type Gradient,
  type Moment,
  type MotionFunction,
  type Point,
  type PoseChannels,
  type PoseOptions,
  type RandomSource,
  type ReachOptions,
  type Row,
  type Scene,
  scene,
  type SceneClosedError,
  type SceneOptions,
  type Severity,
  type ShapeContext,
  type SourceLocation,
  type Span,
  type Stage,
  type TextMeasurement,
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

  it("makes the full interface the shape context plus text", () => {
    expectTypeOf<DrawingContext>().toExtend<ShapeContext>();
    expectTypeOf<Exclude<keyof DrawingContext, keyof ShapeContext>>().toEqualTypeOf<
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

  it("gives a row an id, an index, an actor and free drawing", () => {
    expectTypeOf<keyof Row>().toEqualTypeOf<"id" | "index" | "actor" | "draw">();
    expectTypeOf<Row["actor"]>().toEqualTypeOf<(options?: ActorOptions) => Actor>();
    expectTypeOf<Row["draw"]>().toEqualTypeOf<
      (draw: DrawFunction, options?: DrawOptions) => Span
    >();
  });

  it("gives an actor an id and its four calls", () => {
    expectTypeOf<keyof Actor>().toEqualTypeOf<
      "id" | "pose" | "reach" | "drive" | "wait"
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
        expectTypeOf(moment).toEqualTypeOf<Moment>();
      });
    expectTypeOf(drawn).returns.toEqualTypeOf<Span>();
    expectTypeOf<Parameters<DrawFunction>[0]>().not.toHaveProperty("fillText");
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
