import { describe, expect, it } from "vitest";

import {
  type ActionDefinition,
  type Clip,
  defineAction,
  defineBackdrop,
  defineEffect,
  defineExpression,
  defineProp,
  type Finding,
  InvalidDefaultError,
  InvalidDefinitionError,
  type Prop,
  ReservedParameterError,
  type Scene,
  scene,
  SceneClosedError,
  type Stage,
} from "../src/index.js";
import type { Vocabulary } from "../src/scene/builtins.js";
import { buildScene } from "../src/scene/scene.js";

const noop = (): void => undefined;

const waveParams = {
  speed: {
    type: "number",
    default: 1,
    min: 0.5,
    max: 2,
    unit: "x",
    doc: "How fast the hand waves.",
  },
} as const;

const waveAction: ActionDefinition<typeof waveParams> = defineAction({
  name: "wave",
  description: "Raises the near hand and waves it.",
  params: waveParams,
  build(clip, { speed }) {
    clip.pose({ shoulderR: 2.6 }, { duration: 0.5 / speed });
  },
});

const sitDownAction = defineAction({
  name: "sitDown",
  description: "Sits on the ground.",
  build(clip) {
    clip.pose({ hipR: 1.5, kneeR: 1.5 }, { duration: 1 });
  },
});

const dejectedExpression = defineExpression({
  name: "dejected",
  description: "Sad.",
  build: () => ({ mouthCurve: -0.6, browTilt: 0.5 }),
});

const ballProp = defineProp({
  name: "ball",
  description: "A ball.",
  params: { radius: { type: "number", default: 0.1, min: 0, doc: "Its radius." } },
  draw: noop,
});

const vocabulary: Vocabulary = {
  action: { sitDown: sitDownAction, wave: waveAction },
  expression: { dejected: dejectedExpression },
  prop: { ball: ballProp },
  backdrop: {},
  effect: {},
};

/** Runs `build` against the test vocabulary, which has names the built-ins lack yet. */
function withNames(build: (stage: Stage) => void): Scene {
  return buildScene({ duration: 5 }, build, vocabulary);
}

function codes(built: Scene): string[] {
  return built.findings.map((finding) => finding.code);
}

function only(built: Scene, code: string): Finding {
  const found = built.findings.filter((finding) => finding.code === code);
  expect(found).toHaveLength(1);
  const [finding] = found;
  if (finding === undefined) {
    throw new Error("unreachable");
  }
  return finding;
}

function segments(built: Scene, kind = "actor"): readonly { data: unknown }[] {
  return (
    built.timeline.rows[0]?.tracks.find((track) => track.kind === kind)?.segments ?? []
  );
}

/** Calls an untyped method, as a scene file does once its types are erased. */
function loose(value: object): Record<string, (...args: unknown[]) => unknown> {
  return value as unknown as Record<string, (...args: unknown[]) => unknown>;
}

describe("defineAction", () => {
  it("returns a frozen action definition with its members", () => {
    expect(waveAction.kind).toBe("action");
    expect(waveAction.name).toBe("wave");
    expect(waveAction.marks).toEqual([]);
    expect(waveAction.moods).toEqual([]);
    expect(waveAction.params).toEqual(waveParams);
    expect(Object.isFrozen(waveAction)).toBe(true);
    expect(Object.isFrozen(waveAction.params.speed)).toBe(true);
  });

  it("copies the specification, leaving the author's object unfrozen", () => {
    const params = { size: { type: "number", default: 1, doc: "Size." } } as const;
    const defined = defineProp({ name: "thing", description: "", params, draw: noop });
    expect(Object.isFrozen(params)).toBe(false);
    expect(defined.params).not.toBe(params);
  });

  // R1
  it.each(["at", "duration", "mood", "blend", "mode"])(
    "rejects a parameter named %s",
    (name) => {
      const define = (): unknown =>
        defineAction({
          name: "bad",
          description: "",
          params: { [name]: { type: "number", default: 0, doc: "Taken." } },
          build: noop,
        });
      expect(define).toThrow(ReservedParameterError);
      try {
        define();
      } catch (error) {
        expect(error).toMatchObject({
          code: "ERR_DEFINE_RESERVED_PARAMETER",
          kind: "action",
          path: `params.${name}`,
        });
      }
    },
  );

  it("rejects a reserved name on every kind", () => {
    expect(() =>
      defineBackdrop({
        name: "bad",
        description: "",
        params: { at: { type: "text", doc: "Taken." } },
        draw: noop,
      }),
    ).toThrow(ReservedParameterError);
  });

  // R2
  it.each([
    ["a number below min", { type: "number", default: 0.4, min: 0.5, doc: "d" }],
    ["a number above max", { type: "number", default: 2.01, max: 2, doc: "d" }],
    ["a non-finite number", { type: "number", default: Number.NaN, doc: "d" }],
    [
      "an enum value not listed",
      { type: "enum", values: ["a"], default: "b", doc: "d" },
    ],
    ["a boolean that is a string", { type: "boolean", default: "yes", doc: "d" }],
    ["an empty colour", { type: "color", default: "", doc: "d" }],
    ["a point without y", { type: "point", default: { x: 0 }, doc: "d" }],
    ["text that is a number", { type: "text", default: 1, doc: "d" }],
    ["a prop with a default", { type: "prop", default: null, doc: "d" }],
  ])("rejects a default that is %s", (_label, spec) => {
    const define = (): unknown =>
      defineAction({
        name: "bad",
        description: "",
        params: { value: spec as never },
        build: noop,
      });
    expect(define).toThrow(InvalidDefaultError);
    try {
      define();
    } catch (error) {
      expect(error).toMatchObject({
        code: "ERR_DEFINE_INVALID_DEFAULT",
        path: "params.value.default",
      });
    }
  });

  it.each([
    ["at min", 0.5],
    ["at max", 2],
  ])("accepts a default %s", (_label, value) => {
    const defined = defineAction({
      name: "ok",
      description: "",
      params: { speed: { type: "number", default: value, min: 0.5, max: 2, doc: "d" } },
      build: noop,
    });
    expect(defined.params.speed.default).toBe(value);
  });

  it.each([
    ["no definition", null, "definition"],
    ["an empty name", { name: "", description: "", build: noop }, "name"],
    ["no description", { name: "x", build: noop }, "description"],
    ["no build", { name: "x", description: "" }, "build"],
    [
      "a sample that is not a function",
      { name: "x", description: "", build: noop, sample: 1 },
      "sample",
    ],
    [
      "params that are not an object",
      { name: "x", description: "", build: noop, params: [] },
      "params",
    ],
    [
      "a parameter that is not an object",
      { name: "x", description: "", build: noop, params: { a: 1 } },
      "params.a",
    ],
    [
      "an unknown type",
      {
        name: "x",
        description: "",
        build: noop,
        params: { a: { type: "date", doc: "d" } },
      },
      "params.a.type",
    ],
    [
      "no doc",
      { name: "x", description: "", build: noop, params: { a: { type: "text" } } },
      "params.a.doc",
    ],
    [
      "a min that is not a number",
      {
        name: "x",
        description: "",
        build: noop,
        params: { a: { type: "number", min: "0", doc: "d" } },
      },
      "params.a.min",
    ],
    [
      "a max below min",
      {
        name: "x",
        description: "",
        build: noop,
        params: { a: { type: "number", min: 1, max: 0, doc: "d" } },
      },
      "params.a.max",
    ],
    [
      "a unit that is not a string",
      {
        name: "x",
        description: "",
        build: noop,
        params: { a: { type: "number", unit: 1, doc: "d" } },
      },
      "params.a.unit",
    ],
    [
      "no enum values",
      {
        name: "x",
        description: "",
        build: noop,
        params: { a: { type: "enum", values: [], doc: "d" } },
      },
      "params.a.values",
    ],
    [
      "duplicate enum values",
      {
        name: "x",
        description: "",
        build: noop,
        params: { a: { type: "enum", values: ["a", "a"], doc: "d" } },
      },
      "params.a.values",
    ],
    [
      "marks that repeat",
      { name: "x", description: "", build: noop, marks: ["a", "a"] },
      "marks",
    ],
    [
      "an empty mark",
      { name: "x", description: "", build: noop, marks: [""] },
      "marks",
    ],
    [
      "moods that are not strings",
      { name: "x", description: "", build: noop, moods: [1] },
      "moods",
    ],
  ])("rejects %s", (_label, definition, path) => {
    const define = (): unknown => defineAction(definition as never);
    expect(define).toThrow(InvalidDefinitionError);
    try {
      define();
    } catch (error) {
      expect(error).toMatchObject({ code: "ERR_DEFINE_INVALID_DEFINITION", path });
    }
  });

  it("keeps a parameter named __proto__ as a parameter", () => {
    const defined = defineAction({
      name: "x",
      description: "",
      params: JSON.parse(
        '{"__proto__":{"type":"text","default":"","doc":"d"}}',
      ) as never,
      build: noop,
    });
    expect(Object.keys(defined.params)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(defined.params)).toBe(Object.prototype);
  });

  it("rejects a prop parameter outside an action", () => {
    const define = (): unknown =>
      defineEffect({
        name: "x",
        description: "",
        params: { target: { type: "prop", doc: "d" } } as never,
        draw: noop,
      });
    expect(define).toThrow(InvalidDefinitionError);
  });

  it("rejects a drawn item without draw", () => {
    expect(() => defineProp({ name: "x", description: "" } as never)).toThrow(
      InvalidDefinitionError,
    );
  });

  it("keeps only the members a parameter's type has", () => {
    const defined = defineExpression({
      name: "x",
      description: "",
      params: {
        tone: {
          type: "enum",
          values: ["a", "b"],
          default: "b",
          doc: "d",
          min: 1,
        } as never,
        spot: { type: "point", default: { x: 1, y: 2 }, doc: "d" },
      },
      build: () => ({}),
    });
    expect(defined.params).toEqual({
      tone: { type: "enum", values: ["a", "b"], default: "b", doc: "d" },
      spot: { type: "point", default: { x: 1, y: 2 }, doc: "d" },
    });
  });
});

describe("a.do with a definition", () => {
  // R4
  it("runs the definition's build without any registration", () => {
    const built = scene((stage) => {
      stage.actor().do(waveAction, { speed: 2 });
    });
    expect(built.findings).toEqual([]);
    expect(segments(built)).toHaveLength(1);
    expect(built.timeline.rows[0]?.tracks[0]?.segments[0]).toMatchObject({
      start: 0,
      end: 250_000,
      data: { kind: "pose", channels: { shoulderR: 2.6 } },
    });
  });

  it("passes every parameter with its default filled in", () => {
    const seen: unknown[] = [];
    const action = defineAction({
      name: "probe",
      description: "",
      params: {
        speed: { type: "number", default: 1, doc: "d" },
        side: { type: "enum", values: ["left", "right"], default: "right", doc: "d" },
        loud: { type: "boolean", default: false, doc: "d" },
        tint: { type: "color", default: "#ff0000", doc: "d" },
        spot: { type: "point", default: { x: 1, y: 0 }, doc: "d" },
        words: { type: "text", default: "hi", doc: "d" },
      },
      build(_clip, params) {
        seen.push(params);
      },
    });
    scene({ duration: 1 }, (stage) => {
      stage.actor().do(action, { side: "left", spot: { x: -0, y: 2 } });
    });
    expect(seen).toEqual([
      {
        speed: 1,
        side: "left",
        loud: false,
        tint: "#ff0000",
        spot: { x: 0, y: 2 },
        words: "hi",
      },
    ]);
  });

  it("starts the clip at the action's start, in the action's own time", () => {
    const spans: unknown[] = [];
    const action = defineAction({
      name: "steps",
      description: "",
      build(clip) {
        spans.push(clip.pose({ kneeR: 1 }, { duration: 0.5 }));
        spans.push(clip.pose({ kneeR: 0 }, { at: 1, duration: 0.5 }));
        spans.push(clip.wait(0.25));
      },
    });
    const built = scene((stage) => {
      const hero = stage.actor();
      hero.wait(2);
      const span = hero.do(action);
      expect(span).toMatchObject({ start: 2, end: 3.75, duration: 1.75 });
      expect(hero.wait(1)).toMatchObject({ start: 3.75 });
    });
    expect(spans).toMatchObject([
      { start: 0, end: 0.5 },
      { start: 1, end: 1.5 },
      { start: 1.5, end: 1.75 },
    ]);
    expect(segments(built).map((segment) => segment)).toMatchObject([
      { start: 0, end: 2_000_000 },
      { start: 2_000_000, end: 2_500_000 },
      { start: 3_000_000, end: 3_500_000 },
      { start: 3_500_000, end: 3_750_000 },
      { start: 3_750_000, end: 4_750_000 },
    ]);
  });

  it("reaches in the action's time", () => {
    const action = defineAction({
      name: "grab",
      description: "",
      build(clip) {
        expect(clip.reach("handR", { x: 0.3, y: 0.5 }, { at: 0.5 })).toMatchObject({
          start: 0.5,
          end: 0.7,
        });
      },
    });
    const built = scene((stage) => {
      stage.actor().do(action, { at: 1 });
    });
    expect(segments(built)[0]).toMatchObject({
      start: 1_500_000,
      end: 1_700_000,
      data: { kind: "reach", effector: "handR", target: { x: 0.3, y: 0.5 } },
    });
  });

  it("places the action at `at` and moves the cursor past it", () => {
    scene((stage) => {
      const hero = stage.actor();
      expect(hero.do(sitDownAction, { at: 1.5 })).toMatchObject({
        start: 1.5,
        end: 2.5,
      });
      expect(hero.wait(1)).toMatchObject({ start: 2.5 });
    });
  });

  it("gives the clip the asked duration and occupies it", () => {
    const durations: unknown[] = [];
    const action = defineAction({
      name: "fill",
      description: "",
      build(clip) {
        durations.push(clip.duration);
        clip.wait(clip.duration ?? 0.5);
      },
    });
    scene((stage) => {
      const hero = stage.actor();
      expect(hero.do(action)).toMatchObject({ duration: 0.5 });
      expect(hero.do(action, { duration: 3 })).toMatchObject({ start: 0.5, end: 3.5 });
      expect(hero.do(sitDownAction, { duration: 0.25 })).toMatchObject({ end: 3.75 });
      expect(hero.wait(1)).toMatchObject({ start: 3.75 });
    });
    expect(durations).toEqual([null, 3]);
  });

  it("uses the action's blend and mode for calls that set none", () => {
    const action = defineAction({
      name: "soft",
      description: "",
      build(clip) {
        clip.pose({ spine: 0.2 });
        clip.pose({ spine: 0.1 }, { blend: 0.1, mode: "replace" });
        clip.drive(() => ({ chest: 0 }), { duration: 1 });
      },
    });
    const built = scene((stage) => {
      stage.actor().do(action, { blend: 0.5, mode: "add" });
    });
    expect(segments(built).map((segment) => segment.data)).toMatchObject([
      { kind: "pose", mode: "add", blend: 500_000 },
      { kind: "pose", mode: "replace", blend: 100_000 },
      { kind: "drive", mode: "add", blend: 500_000 },
    ]);
  });

  it("makes an open-ended action leave the actor without a cursor", () => {
    const action = defineAction({
      name: "sway",
      description: "",
      build(clip) {
        clip.drive(() => ({ spine: 0 }));
      },
    });
    const built = scene({ duration: 2 }, (stage) => {
      const hero = stage.actor();
      expect(hero.do(action)).toMatchObject({ end: Infinity });
      hero.wait(1);
    });
    expect(codes(built)).toEqual(["ERR_SCENE_NO_CURSOR"]);
  });

  it("reports a clip call after an open-ended one in the action", () => {
    const action = defineAction({
      name: "sway",
      description: "",
      build(clip) {
        clip.drive(() => ({ spine: 0 }));
        clip.pose({ spine: 0 });
      },
    });
    const built = scene({ duration: 2 }, (stage) => {
      stage.actor().do(action);
    });
    expect(codes(built)).toEqual(["ERR_SCENE_NO_CURSOR"]);
  });

  it("shows the mood on the face for the action's length, under the action's own calls", () => {
    const moods: unknown[] = [];
    const action = defineAction({
      name: "slump",
      description: "",
      moods: ["dejected"],
      build(clip) {
        moods.push(clip.mood);
        clip.pose({ spine: 0.5 }, { duration: 1 });
      },
    });
    const built = scene((stage) => {
      stage.actor().do(action, { mood: dejectedExpression });
      stage.actor({ name: "second" });
    });
    expect(moods).toEqual(["dejected"]);
    expect(segments(built)).toMatchObject([
      {
        start: 0,
        end: 1_000_000,
        data: { kind: "pose", channels: { mouthCurve: -0.6, browTilt: 0.5 } },
      },
      { data: { kind: "pose", channels: { spine: 0.5 } } },
    ]);
  });

  it("gives a clip no mood when the scene names none", () => {
    const moods: unknown[] = [];
    const action = defineAction({
      name: "x",
      description: "",
      build(clip) {
        moods.push(clip.mood);
      },
    });
    scene({ duration: 1 }, (stage) => {
      stage.actor().do(action);
    });
    expect(moods).toEqual([null]);
  });

  it("returns the marks the action sets, in scene time", () => {
    const throwAction = defineAction({
      name: "throw",
      description: "",
      marks: ["release", "settle"],
      build(clip) {
        clip.pose({ shoulderR: 2 }, { duration: 1 });
        clip.mark("release", 0.6);
        clip.mark("settle", 1);
      },
    });
    scene((stage) => {
      const hero = stage.actor();
      hero.wait(1);
      const span = hero.do(throwAction);
      expect(span.marks).toEqual({ release: 1.6, settle: 2 });
      expect(Object.isFrozen(span.marks)).toBe(true);
    });
  });

  it("reports a stated mark the build did not set, and uses the action's end", () => {
    const action = defineAction({
      name: "throw",
      description: "",
      marks: ["release"],
      build(clip) {
        clip.wait(1);
      },
    });
    const built = scene((stage) => {
      expect(stage.actor().do(action).marks).toEqual({ release: 1 });
    });
    expect(codes(built)).toEqual(["ERR_SCENE_MISSING_MARK"]);
  });

  it("uses the action's start for a missing mark of an open-ended action", () => {
    const action = defineAction({
      name: "throw",
      description: "",
      marks: ["release"],
      build(clip) {
        clip.drive(() => ({ spine: 0 }));
      },
    });
    const built = scene({ duration: 1 }, (stage) => {
      expect(stage.actor().do(action, { at: 0.5 }).marks).toEqual({ release: 0.5 });
    });
    expect(codes(built)).toEqual(["ERR_SCENE_MISSING_MARK"]);
  });

  it.each([
    ["a mark the action does not state", "releaseAt", 0.5, ["release"]],
    ["a mark that is not a string", 1, 0.5, []],
  ])("reports %s", (_label, name, at, nearest) => {
    const action = defineAction({
      name: "throw",
      description: "",
      marks: ["release"],
      build(clip) {
        loose(clip)["mark"]?.(name, at);
        clip.mark("release", 0);
      },
    });
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor().do(action);
    });
    expect(only(built, "ERR_SCENE_UNKNOWN_MARK").nearest).toEqual(nearest);
  });

  it("reports a mark on an action that states none", () => {
    const action = defineAction({
      name: "x",
      description: "",
      build(clip) {
        loose(clip)["mark"]?.("release", 0);
      },
    });
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor().do(action);
    });
    expect(codes(built)).toEqual(["ERR_SCENE_UNKNOWN_MARK"]);
  });

  it("reports a mark time the timeline cannot store", () => {
    const action = defineAction({
      name: "throw",
      description: "",
      marks: ["release"],
      build(clip) {
        clip.mark("release", -1);
      },
    });
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor().do(action);
    });
    expect(codes(built)).toEqual(["ERR_SCENE_OUT_OF_RANGE", "ERR_SCENE_MISSING_MARK"]);
  });
});

describe("a.do's parameters", () => {
  it("accepts a number at its max", () => {
    const built = withNames((stage) => {
      stage.actor().do(waveAction, { speed: 2 });
    });
    expect(built.findings).toEqual([]);
  });

  it("reports a number past its max with the measured value and the range", () => {
    const seen: unknown[] = [];
    const probe = defineAction({
      name: "probe",
      description: "",
      params: waveParams,
      build(_clip, { speed }) {
        seen.push(speed);
      },
    });
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor().do(probe, { speed: 2.01 });
    });
    const finding = only(built, "ERR_SCENE_OUT_OF_RANGE");
    expect(finding.measured).toEqual({ value: 2.01, min: 0.5, max: 2 });
    expect(finding).toMatchObject({ row: 0, target: "row0/actor/actor/0" });
    expect(seen).toEqual([2]);
  });

  it("reports a number below a range with only a min", () => {
    const probe = defineAction({
      name: "probe",
      description: "",
      params: { size: { type: "number", min: 0, doc: "d" } },
      build: noop,
    });
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor().do(probe, { size: -1 });
    });
    expect(only(built, "ERR_SCENE_OUT_OF_RANGE").measured).toEqual({
      value: -1,
      min: 0,
    });
  });

  it.each([
    ["a number that is a string", { type: "number", doc: "d" }, "1", 0],
    ["a number that is NaN", { type: "number", default: 3, doc: "d" }, Number.NaN, 3],
  ])(
    "reports %s as out of range and uses a placeholder",
    (_label, spec, value, used) => {
      const seen: unknown[] = [];
      const probe = defineAction({
        name: "probe",
        description: "",
        params: { value: spec as never },
        build(_clip, params) {
          seen.push(params.value);
        },
      });
      const built = scene({ duration: 1 }, (stage) => {
        loose(stage.actor())["do"]?.(probe, { value });
      });
      expect(codes(built)).toEqual(["ERR_SCENE_OUT_OF_RANGE"]);
      expect(only(built, "ERR_SCENE_OUT_OF_RANGE").measured).toBeUndefined();
      expect(seen).toEqual([used]);
    },
  );

  it.each([
    [
      "an enum value not listed",
      { type: "enum", values: ["left", "right"], doc: "d" },
      "rihgt",
      "left",
      ["right"],
    ],
    [
      "an enum value that is a number",
      { type: "enum", values: ["a"], default: "a", doc: "d" },
      1,
      "a",
      undefined,
    ],
    [
      "a boolean that is a string",
      { type: "boolean", doc: "d" },
      "true",
      false,
      undefined,
    ],
    ["an empty colour", { type: "color", doc: "d" }, "", "#111111", undefined],
    [
      "a point with a string",
      { type: "point", doc: "d" },
      { x: "1", y: 0 },
      { x: 0, y: 0 },
      undefined,
    ],
    [
      "text that is a number",
      { type: "text", default: "a", doc: "d" },
      5,
      "a",
      undefined,
    ],
  ])("reports %s as an invalid value", (_label, spec, value, used, nearest) => {
    const seen: unknown[] = [];
    const probe = defineAction({
      name: "probe",
      description: "",
      params: { value: spec as never },
      build(_clip, params) {
        seen.push(params.value);
      },
    });
    const built = scene({ duration: 1 }, (stage) => {
      loose(stage.actor())["do"]?.(probe, { value });
    });
    expect(only(built, "ERR_SCENE_INVALID_VALUE").nearest).toEqual(nearest);
    expect(seen).toEqual([used]);
  });

  it.each([
    ["number", { type: "number", min: 1, max: 3, doc: "d" }, 1],
    ["number with no range", { type: "number", doc: "d" }, 0],
    ["number with only a max", { type: "number", max: -1, doc: "d" }, -1],
    ["enum", { type: "enum", values: ["b", "a"], doc: "d" }, "b"],
    ["boolean", { type: "boolean", doc: "d" }, false],
    ["colour", { type: "color", doc: "d" }, "#111111"],
    ["point", { type: "point", doc: "d" }, { x: 0, y: 0 }],
    ["text", { type: "text", doc: "d" }, ""],
  ])("reports a missing %s and uses a placeholder", (_label, spec, used) => {
    const seen: unknown[] = [];
    const probe = defineAction({
      name: "probe",
      description: "",
      params: { value: spec as never },
      build(_clip, params) {
        seen.push(params.value);
      },
    });
    const built = scene({ duration: 1 }, (stage) => {
      loose(stage.actor())["do"]?.(probe);
    });
    expect(codes(built)).toEqual(["ERR_SCENE_MISSING_PARAMETER"]);
    expect(seen).toEqual([used]);
  });

  it("reports an unknown key with the nearest parameter or option", () => {
    const built = scene({ duration: 1 }, (stage) => {
      loose(stage.actor())["do"]?.(waveAction, { sped: 1 });
    });
    expect(only(built, "ERR_SCENE_UNKNOWN_OPTION").nearest).toEqual(["speed"]);
  });

  it("reports options that are not an object", () => {
    const built = scene({ duration: 1 }, (stage) => {
      loose(stage.actor())["do"]?.(waveAction, 3);
    });
    expect(codes(built)).toEqual(["ERR_SCENE_INVALID_VALUE"]);
  });

  it.each([
    ["at", { at: -1 }, "ERR_SCENE_OUT_OF_RANGE"],
    ["duration", { duration: Number.NaN }, "ERR_SCENE_OUT_OF_RANGE"],
    ["blend", { blend: "slow" }, "ERR_SCENE_OUT_OF_RANGE"],
    ["mode", { mode: "mix" }, "ERR_SCENE_UNKNOWN_MODE"],
  ])("reports a bad %s option", (_label, options, code) => {
    const built = scene({ duration: 1 }, (stage) => {
      loose(stage.actor())["do"]?.(sitDownAction, options);
    });
    expect(codes(built)).toEqual([code]);
  });
});

describe("a.do with a name", () => {
  // R3
  it("reports an unknown action with the nearest names, and continues", () => {
    const built = withNames((stage) => {
      const hero = stage.actor();
      loose(hero)["do"]?.("sitDwon");
      hero.do(sitDownAction);
    });
    const finding = only(built, "ERR_SCENE_UNKNOWN_ACTION");
    expect(finding.nearest).toEqual(["sitDown"]);
    expect(finding).toMatchObject({ row: 0, target: "row0/actor/actor/0" });
    expect(finding.message).toContain("action");
    expect(finding.message).toContain("sitDwon");
    expect(segments(built)).toHaveLength(2);
  });

  it("resolves a built-in name to its definition", () => {
    const built = withNames((stage) => {
      loose(stage.actor())["do"]?.("wave", { speed: 0.5 });
    });
    expect(built.findings).toEqual([]);
    expect(segments(built)[0]).toMatchObject({ end: 1_000_000 });
  });

  it("does not take a name from the object prototype", () => {
    const built = withNames((stage) => {
      loose(stage.actor())["do"]?.("toString");
    });
    expect(codes(built)).toEqual(["ERR_SCENE_UNKNOWN_ACTION"]);
  });

  it("keeps the time an unknown action asked for, as a wait", () => {
    const built = withNames((stage) => {
      const hero = stage.actor();
      expect(loose(hero)["do"]?.("sitDwon", { duration: 2 })).toMatchObject({ end: 2 });
      expect(hero.wait(1)).toMatchObject({ start: 2 });
    });
    expect(segments(built)[0]).toMatchObject({ data: { kind: "wait" } });
  });

  it("says there are no built-in effects yet while none exist", () => {
    const built = scene({ duration: 1 }, (stage) => {
      loose(stage)["effect"]?.("sweat");
    });
    const finding = only(built, "ERR_SCENE_UNKNOWN_EFFECT");
    expect(finding.nearest).toEqual([]);
  });

  it("reports only the unknown name, not the keys it was given", () => {
    const built = withNames((stage) => {
      loose(stage.actor())["do"]?.("sitDwon", { speed: 2, side: "L" });
      loose(stage)["prop"]?.("bal", { radius: 1 });
    });
    expect(codes(built)).toEqual([
      "ERR_SCENE_UNKNOWN_ACTION",
      "ERR_SCENE_UNKNOWN_PROP",
    ]);
  });

  it.each([
    [
      "a hand-built object with a malformed parameter",
      {
        kind: "action",
        name: "x",
        params: { a: null },
        build: noop,
        marks: [],
        moods: [],
      },
    ],
    ["a definition of another kind", ballProp],
    ["a number", 3],
    ["an object that never went through defineAction", { kind: "action", name: "x" }],
  ])("reports %s as an invalid value", (_label, item) => {
    const built = withNames((stage) => {
      loose(stage.actor())["do"]?.(item);
    });
    expect(codes(built)).toEqual(["ERR_SCENE_INVALID_VALUE"]);
  });

  it.each([
    ["an unknown mood name", "dejectd", "ERR_SCENE_UNKNOWN_EXPRESSION", ["dejected"]],
    ["a mood that is an action", sitDownAction, "ERR_SCENE_INVALID_VALUE", undefined],
  ])("reports %s", (_label, mood, code, nearest) => {
    const built = withNames((stage) => {
      loose(stage.actor())["do"]?.(sitDownAction, { mood });
    });
    expect(only(built, code).nearest).toEqual(nearest);
    expect(segments(built)).toHaveLength(1);
  });

  it("resolves a mood by name", () => {
    const built = withNames((stage) => {
      loose(stage.actor())["do"]?.("sitDown", { mood: "dejected" });
    });
    expect(built.findings).toEqual([]);
    expect(segments(built)[0]).toMatchObject({
      data: { channels: { mouthCurve: -0.6 } },
    });
  });
});

describe("a.express", () => {
  it("records the expression's face values as a pose", () => {
    const built = scene((stage) => {
      const hero = stage.actor();
      expect(hero.express(dejectedExpression, { duration: 1 })).toMatchObject({
        end: 1,
      });
    });
    expect(segments(built)).toMatchObject([
      {
        start: 0,
        end: 1_000_000,
        data: {
          kind: "pose",
          channels: { mouthCurve: -0.6, browTilt: 0.5 },
          mode: "replace",
          blend: 200_000,
        },
      },
    ]);
  });

  it("passes its parameters to build", () => {
    const grin = defineExpression({
      name: "grin",
      description: "",
      params: { width: { type: "number", default: 1, min: 0.5, max: 1.5, doc: "d" } },
      build: ({ width }) => ({ mouthWidth: width, mouthCurve: 0.5 }),
    });
    const built = scene((stage) => {
      stage.actor().express(grin, { width: 1.2, blend: 0.1, mode: "add" });
    });
    expect(segments(built)[0]).toMatchObject({
      data: {
        channels: { mouthWidth: 1.2, mouthCurve: 0.5 },
        mode: "add",
        blend: 100_000,
      },
    });
  });

  it.each([
    ["a body channel", { spine: 1 }, "ERR_SCENE_UNKNOWN_CHANNEL"],
    [
      "a value that is not finite",
      { mouthCurve: Number.NaN },
      "ERR_SCENE_OUT_OF_RANGE",
    ],
    ["something that is not a map", 3, "ERR_SCENE_INVALID_VALUE"],
  ])("reports an expression that returns %s", (_label, returned, code) => {
    const broken = defineExpression({
      name: "broken",
      description: "",
      build: () => returned as never,
    });
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor().express(broken);
    });
    expect(codes(built)).toEqual([code]);
    expect(segments(built)[0]).toMatchObject({ data: { channels: {} } });
  });

  it("reports an unknown expression and still takes its time", () => {
    const built = withNames((stage) => {
      const hero = stage.actor();
      loose(hero)["express"]?.("dejeted", { duration: 1 });
      expect(hero.wait(1)).toMatchObject({ start: 1 });
    });
    expect(only(built, "ERR_SCENE_UNKNOWN_EXPRESSION").nearest).toEqual(["dejected"]);
  });

  it("resolves a built-in name", () => {
    const built = withNames((stage) => {
      loose(stage.actor())["express"]?.("dejected");
    });
    expect(built.findings).toEqual([]);
  });

  it("reports an unknown option, never reading it as a pose phase", () => {
    const built = scene({ duration: 1 }, (stage) => {
      loose(stage.actor())["express"]?.(dejectedExpression, { anticipation: 1 });
    });
    expect(codes(built)).toEqual(["ERR_SCENE_UNKNOWN_OPTION"]);
    expect(segments(built)[0]).toMatchObject({ data: { anticipation: 0 } });
  });
});

describe("row.prop, row.backdrop and row.effect", () => {
  const plainBackdrop = defineBackdrop({
    name: "plain",
    description: "",
    params: { tint: { type: "color", default: "#eeeeee", doc: "d" } },
    draw: noop,
  });
  const sweatEffect = defineEffect({ name: "sweat", description: "", draw: noop });

  it("records a prop's track with its resolved parameters", () => {
    const built = scene({ duration: 2 }, (stage) => {
      const ball = stage.prop(ballProp, { radius: 0.2, at: 0.5 });
      expect(ball.id).toBe("row0/prop/ball/0");
    });
    const [track] = built.timeline.rows[0]?.tracks ?? [];
    expect(track).toMatchObject({ kind: "prop", name: "ball", occurrence: 0 });
    expect(track?.segments).toEqual([
      {
        start: 500_000,
        end: null,
        data: {
          kind: "prop",
          name: "ball",
          definition: ballProp,
          params: { radius: 0.2 },
        },
      },
    ]);
  });

  it("keeps no definition for a built-in named by a string", () => {
    const built = withNames((stage) => {
      loose(stage)["prop"]?.("ball");
    });
    expect(segments(built, "prop")[0]).toMatchObject({
      data: { name: "ball", definition: null, params: { radius: 0.1 } },
    });
  });

  it("shows a backdrop and an effect for their duration, extending the scene", () => {
    const built = scene((stage) => {
      expect(stage.backdrop(plainBackdrop, { duration: 2 })).toMatchObject({ end: 2 });
      expect(stage.effect(sweatEffect, { at: 1, duration: 2 })).toMatchObject({
        start: 1,
        end: 3,
      });
    });
    expect(built.findings).toEqual([]);
    expect(built.timeline.rows[0]?.tracks.map((track) => track.kind)).toEqual([
      "backdrop",
      "effect",
    ]);
    expect(segments(built, "backdrop")[0]).toMatchObject({
      data: { params: { tint: "#eeeeee" } },
    });
  });

  it("works on any row", () => {
    const built = scene({ rows: 2, duration: 1 }, (stage) => {
      const row = stage.row(1);
      row.prop(ballProp);
      row.backdrop(plainBackdrop);
      row.effect(sweatEffect);
    });
    expect(built.findings).toEqual([]);
    expect(built.timeline.rows[1]?.tracks).toHaveLength(3);
  });

  it.each([
    ["prop", "bal", "ERR_SCENE_UNKNOWN_PROP"],
    ["backdrop", "plane", "ERR_SCENE_UNKNOWN_BACKDROP"],
    ["effect", "swet", "ERR_SCENE_UNKNOWN_EFFECT"],
  ])("reports an unknown %s name", (method, name, code) => {
    const built = withNames((stage) => {
      loose(stage)[method]?.(name);
    });
    expect(codes(built)).toEqual([code]);
  });

  it("still hands out a prop handle for an unknown prop", () => {
    const built = withNames((stage) => {
      const prop = loose(stage)["prop"]?.("bal") as Prop;
      expect(prop.id).toBe("row0/prop/bal/0");
      prop.place({ x: 1, y: 0 });
      const other = loose(stage)["prop"]?.(42) as Prop;
      expect(other.id).toBe("row0/prop/prop/0");
    });
    expect(codes(built)).toEqual(["ERR_SCENE_UNKNOWN_PROP", "ERR_SCENE_INVALID_VALUE"]);
  });

  it("reports a bad parameter of a prop", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.prop(ballProp, { radius: -1 });
    });
    expect(only(built, "ERR_SCENE_OUT_OF_RANGE").target).toBe("row0/prop/ball/0");
  });

  it("reports the stage's item calls on a scene with more rows", () => {
    const built = scene({ rows: 2, duration: 1 }, (stage) => {
      stage.prop(ballProp);
    });
    expect(codes(built)).toEqual(["ERR_SCENE_ROW_REQUIRED"]);
  });
});

describe("prop.place and prop parameters", () => {
  const pushParams = { target: { type: "prop", doc: "What is pushed." } } as const;
  const pushAction: ActionDefinition<typeof pushParams> = defineAction({
    name: "push",
    description: "",
    params: pushParams,
    build(clip: Clip, { target }) {
      clip.wait(1);
      target.place({ x: 0.5, y: 0 }, { at: 0.5 });
    },
  });

  it("records a placement on the prop's track, open-ended", () => {
    const built = scene({ duration: 2 }, (stage) => {
      const ball = stage.prop(ballProp);
      expect(ball.place({ x: 1, y: -0 }, { at: 1 })).toMatchObject({
        start: 1,
        end: Infinity,
      });
      ball.place({ x: 2, y: 0 });
    });
    expect(segments(built, "prop").slice(1)).toEqual([
      {
        start: 1_000_000,
        end: null,
        data: { kind: "place", x: 1, y: 0, layer: "behind" },
      },
      { start: 0, end: null, data: { kind: "place", x: 2, y: 0, layer: "behind" } },
    ]);
  });

  it.each([
    ["front", "front"],
    ["behind", "behind"],
    [undefined, "behind"],
  ])("records a placement's layer %s as %s", (layer, recorded) => {
    const built = scene({ duration: 1 }, (stage) => {
      loose(stage.prop(ballProp))["place"]?.({ x: 1, y: 0 }, { layer });
    });
    expect(built.findings).toEqual([]);
    expect(segments(built, "prop")[1]).toMatchObject({ data: { layer: recorded } });
  });

  it.each([
    ["frnt", ["front"]],
    ["FRONT", ["front"]],
    ["top", []],
    [1, []],
    [null, []],
  ])("reports the layer %s and places the prop behind", (layer, nearest) => {
    const built = scene({ duration: 1 }, (stage) => {
      loose(stage.prop(ballProp))["place"]?.({ x: 1, y: 0 }, { layer });
    });
    expect(codes(built)).toEqual(["ERR_SCENE_INVALID_VALUE"]);
    expect(built.findings[0]?.nearest).toEqual(nearest);
    expect(segments(built, "prop")[1]).toMatchObject({
      data: { kind: "place", x: 1, y: 0, layer: "behind" },
    });
  });

  it("lets an action move a prop it is given, in the action's time", () => {
    const built = scene((stage) => {
      const box = stage.prop(ballProp);
      const hero = stage.actor();
      hero.wait(2);
      hero.do(pushAction, { target: box });
    });
    expect(built.findings).toEqual([]);
    expect(segments(built, "prop")[1]).toEqual({
      start: 2_500_000,
      end: null,
      data: { kind: "place", x: 0.5, y: 0, layer: "behind" },
    });
  });

  it.each([
    ["missing", undefined, "ERR_SCENE_MISSING_PARAMETER"],
    ["not a handle", { id: "row0/prop/ball/0" }, "ERR_SCENE_INVALID_VALUE"],
  ])("does not do an action whose prop is %s", (_label, target, code) => {
    const built = scene({ duration: 1 }, (stage) => {
      loose(stage.actor())["do"]?.(pushAction, { target });
    });
    expect(codes(built)).toEqual([code]);
    expect(segments(built)).toEqual([{ start: 0, end: 0, data: { kind: "wait" } }]);
  });

  it.each([
    ["a point without y", [{ x: 1 }], "ERR_SCENE_OUT_OF_RANGE"],
    ["a bad at", [{ x: 1, y: 0 }, { at: -1 }], "ERR_SCENE_OUT_OF_RANGE"],
    ["an unknown option", [{ x: 1, y: 0 }, { when: 1 }], "ERR_SCENE_UNKNOWN_OPTION"],
  ])("reports a placement with %s", (_label, args, code) => {
    const built = scene({ duration: 1 }, (stage) => {
      loose(stage.prop(ballProp))["place"]?.(...args);
    });
    expect(codes(built)).toEqual([code]);
  });
});

describe("prop.hold and prop.move", () => {
  const tossParams = { thing: { type: "prop", doc: "What is tossed." } } as const;
  const tossAction: ActionDefinition<typeof tossParams> = defineAction({
    name: "toss",
    description: "",
    params: tossParams,
    build(clip: Clip, { thing }) {
      clip.wait(1);
      thing.hold("handL", { offset: { x: 0, y: -0.05 } });
      thing.move({ x: 1, y: 0 }, { at: 0.5, duration: 0.25, arc: 0.2 });
    },
  });

  it("records a hold by the row's actor, open-ended", () => {
    const built = scene({ duration: 2 }, (stage) => {
      const ball = stage.prop(ballProp);
      stage.actor({ name: "hero" });
      expect(ball.hold("handR", { at: 1 })).toMatchObject({ start: 1, end: Infinity });
    });
    expect(built.findings).toEqual([]);
    expect(segments(built, "prop").slice(1)).toEqual([
      {
        start: 1_000_000,
        end: null,
        data: {
          kind: "hold",
          effector: "handR",
          actor: { name: "hero", occurrence: 0 },
          offset: { x: 0, y: 0 },
        },
      },
    ]);
  });

  it("records a move with its arc, half a second long unless told otherwise", () => {
    const built = scene((stage) => {
      const ball = stage.prop(ballProp);
      expect(ball.move({ x: 1, y: -0 })).toMatchObject({ start: 0, end: 0.5 });
      ball.move({ x: 2, y: 0.5 }, { at: 1, duration: 2, arc: -0 });
    });
    expect(built.findings).toEqual([]);
    expect(segments(built, "prop").slice(1)).toEqual([
      { start: 0, end: 500_000, data: { kind: "move", x: 1, y: 0, arc: 0 } },
      {
        start: 1_000_000,
        end: 3_000_000,
        data: { kind: "move", x: 2, y: 0.5, arc: 0 },
      },
    ]);
  });

  it("counts a move towards the scene's length", () => {
    const built = scene((stage) => {
      stage.prop(ballProp).move({ x: 1, y: 0 }, { at: 1, duration: 1 });
      expect(stage.sync()).toBe(2);
    });
    expect(codes(built)).toEqual([]);
  });

  it("lets an action hold and move a prop, in its own time and by its own actor", () => {
    const built = scene({ rows: 1 }, (stage) => {
      const ball = stage.prop(ballProp);
      stage.actor({ name: "first" });
      const hero = stage.actor({ name: "second" });
      hero.wait(2);
      hero.do(tossAction, { thing: ball });
    });
    expect(codes(built)).toEqual(["ERR_SCENE_ROW_HAS_ACTOR"]);
    expect(segments(built, "prop").slice(1)).toEqual([
      {
        start: 2_000_000,
        end: null,
        data: {
          kind: "hold",
          effector: "handL",
          actor: { name: "second", occurrence: 0 },
          offset: { x: 0, y: -0.05 },
        },
      },
      {
        start: 2_500_000,
        end: 2_750_000,
        data: { kind: "move", x: 1, y: 0, arc: 0.2 },
      },
    ]);
  });

  it("reports a hold in a row without an actor, and does not record it", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.prop(ballProp).hold("handR");
    });
    const finding = only(built, "ERR_SCENE_NO_ACTOR");
    expect(finding).toMatchObject({
      severity: "error",
      row: 0,
      target: "row0/prop/ball/0",
    });
    expect(segments(built, "prop")).toHaveLength(1);
  });

  it("reports a hold inside an action by an actor of another row, and does not record it", () => {
    const built = scene({ duration: 2, rows: 2 }, (stage) => {
      const ball = stage.row(1).prop(ballProp);
      stage.row(1).actor();
      stage.row(0).actor().do(tossAction, { thing: ball });
    });
    expect(only(built, "ERR_SCENE_NO_ACTOR")).toMatchObject({
      row: 1,
      target: "row1/prop/ball/0",
    });
    const kinds = built.timeline.rows[1]?.tracks
      .find((track) => track.kind === "prop")
      ?.segments.map(({ data }) => (data as { kind: string }).kind);
    expect(kinds).toEqual(["prop", "move"]);
  });

  it("reports both a bad offset and a bad effector in one hold", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor();
      loose(stage.prop(ballProp))["hold"]?.("handr", { offset: { x: 1 } });
    });
    expect(codes(built)).toEqual([
      "ERR_SCENE_OUT_OF_RANGE",
      "ERR_SCENE_UNKNOWN_EFFECTOR",
    ]);
    expect(segments(built, "prop")).toHaveLength(1);
  });

  it("reports a hold by something that is not a hand or a foot, with the nearest", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor();
      loose(stage.prop(ballProp))["hold"]?.("handr");
      loose(stage.prop(ballProp))["hold"]?.(3);
    });
    expect(codes(built)).toEqual([
      "ERR_SCENE_UNKNOWN_EFFECTOR",
      "ERR_SCENE_UNKNOWN_EFFECTOR",
    ]);
    expect(built.findings[0]?.nearest).toEqual(["handR", "handL"]);
    expect(built.findings[1]?.nearest).toEqual([]);
    expect(segments(built, "prop")).toHaveLength(1);
  });

  it.each([
    ["hold", ["handR", { offset: { x: 1 } }], "ERR_SCENE_OUT_OF_RANGE"],
    ["hold", ["handR", { at: -1 }], "ERR_SCENE_OUT_OF_RANGE"],
    ["hold", ["handR", { when: 1 }], "ERR_SCENE_UNKNOWN_OPTION"],
    ["move", [{ x: Number.NaN, y: 0 }], "ERR_SCENE_OUT_OF_RANGE"],
    ["move", [{ x: 1, y: 0 }, { arc: Infinity }], "ERR_SCENE_OUT_OF_RANGE"],
    ["move", [{ x: 1, y: 0 }, { arc: "high" }], "ERR_SCENE_OUT_OF_RANGE"],
    ["move", [{ x: 1, y: 0 }, { duration: -1 }], "ERR_SCENE_OUT_OF_RANGE"],
    ["move", [{ x: 1, y: 0 }, { height: 1 }], "ERR_SCENE_UNKNOWN_OPTION"],
  ])("reports a %s given %j", (call, args, code) => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor();
      loose(stage.prop(ballProp))[call]?.(...args);
    });
    expect(codes(built)).toEqual([code]);
  });

  it("does not record a hold with a bad offset or a move with a bad point", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor();
      const ball = loose(stage.prop(ballProp));
      ball["hold"]?.("handR", { offset: "low" });
      ball["move"]?.("there");
    });
    expect(segments(built, "prop")).toHaveLength(1);
  });

  it("uses a straight line and the default length for a move's bad options", () => {
    const built = scene({ duration: 1 }, (stage) => {
      loose(stage.prop(ballProp))["move"]?.(
        { x: 1, y: 0 },
        { arc: "high", duration: -1 },
      );
    });
    expect(segments(built, "prop")[1]).toEqual({
      start: 0,
      end: 500_000,
      data: { kind: "move", x: 1, y: 0, arc: 0 },
    });
  });

  it("throws once the scene has returned", () => {
    let kept: Prop | undefined;
    scene({ duration: 1 }, (stage) => {
      kept = stage.prop(ballProp);
    });
    expect(() => kept?.hold("handR")).toThrow(SceneClosedError);
    expect(() => kept?.move({ x: 1, y: 0 })).toThrow(SceneClosedError);
  });
});

describe("samples", () => {
  it("records a definition's sample when it is passed to scene", () => {
    const sampled = defineAction({
      name: "sampled",
      description: "",
      build(clip) {
        clip.wait(1);
      },
      sample(stage) {
        stage.actor().do(sampled);
      },
    });
    expect(typeof sampled.sample).toBe("function");
    const built = scene((stage) => {
      sampled.sample?.(stage);
    });
    expect(built.findings).toEqual([]);
    expect(segments(built)).toHaveLength(1);
  });
});
