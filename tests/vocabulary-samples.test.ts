import { describe, expect, it } from "vitest";

import { checkScene, lastFrameOf } from "../src/check/check.js";
import { type LogEntry, RecordingContext } from "../src/check/recorder.js";
import { spreadFrames } from "../src/check/sheet.js";
import { drawFrame } from "../src/draw/frame.js";
import {
  type ActionDefinition,
  type Actor,
  builtinActions,
  builtinBackdrops,
  builtinEffects,
  builtinExpressions,
  builtinProps,
  type Definition,
  type Finding,
  type Scene,
  scene,
  type Span,
  type Stage,
} from "../src/index.js";
import { parseTimeline, serializeTimeline } from "../src/timeline/json.js";

/** How many frames of a sample are recorded, spread from its first to its last. */
const RECORDED_FRAMES = { action: 7, expression: 1, prop: 1, backdrop: 1, effect: 1 };

const MAPS: readonly (readonly [Definition["kind"], object])[] = [
  ["action", builtinActions],
  ["expression", builtinExpressions],
  ["prop", builtinProps],
  ["backdrop", builtinBackdrops],
  ["effect", builtinEffects],
];

/** Every built-in as `[kind, name, definition]`, in the order the maps list them. */
const ITEMS = MAPS.flatMap(([kind, map]) =>
  Object.entries(map).map(
    ([name, definition]: [string, Definition]) => [kind, name, definition] as const,
  ),
);

const ACTIONS: readonly (readonly [string, ActionDefinition])[] =
  Object.entries(builtinActions);

/** `actor.do` as a scene file calls it once its types are erased. */
function loosely(actor: Actor): (name: string, options?: object) => Span<string> {
  return (name, options) =>
    (actor as unknown as { do(name: string, options?: object): Span<string> }).do(
      name,
      options,
    );
}

/** One logged call on one line: numbers are already integers, a ten-thousandth each. */
function line({ call, args }: LogEntry): string {
  return [call, ...args.map((arg) => JSON.stringify(arg))].join(" ");
}

/** The drawing calls of frame `frame` of `built`, as text. */
function record(built: Scene, frame: number): string {
  const ctx = new RecordingContext();
  drawFrame(ctx, built, frame);
  return ctx.log.map(line).join("\n");
}

function errors(findings: readonly Finding[]): Finding[] {
  return findings.filter((finding) => finding.severity === "error");
}

function sampleOf(definition: Definition): Scene {
  if (definition.sample === undefined) {
    throw new Error(`${definition.kind} ${definition.name} has no sample`);
  }
  return scene((stage) => {
    definition.sample?.(stage);
  });
}

function segmentsOf(built: Scene, kind: string, row = 0): readonly unknown[] {
  return (
    built.timeline.rows[row]?.tracks.find((track) => track.kind === kind)?.segments ??
    []
  );
}

describe("the built-in vocabulary", () => {
  it("is the eight items of the first three actions", () => {
    expect(ITEMS.map(([kind, name]) => `${kind} ${name}`)).toEqual([
      "action sitDown",
      "action slump",
      "action throw",
      "expression dejected",
      "expression focused",
      "expression neutral",
      "prop ball",
      "prop box",
    ]);
  });

  it.each(ITEMS)(
    "lists the %s %s under its own name, kind and a description",
    (kind, name, definition) => {
      expect(definition.name).toBe(name);
      expect(definition.kind).toBe(kind);
      expect(definition.description.length).toBeGreaterThan(20);
      expect(Object.isFrozen(definition)).toBe(true);
    },
  );

  it("states throw's release mark and no mark for the other actions", () => {
    expect(builtinActions.throw.marks).toEqual(["release"]);
    expect(builtinActions.sitDown.marks).toEqual([]);
    expect(builtinActions.slump.marks).toEqual([]);
  });

  it.each(ACTIONS)(
    "lists for %s only moods that are built-in expressions",
    (_name, { moods }) => {
      expect(moods.length).toBeGreaterThan(0);
      for (const mood of moods) {
        expect(Object.hasOwn(builtinExpressions, mood)).toBe(true);
      }
    },
  );
});

describe("the samples", () => {
  // R3
  it.each(ITEMS)("draws the %s %s as recorded", (kind, _name, definition) => {
    const built = sampleOf(definition);
    expect(built.findings).toEqual([]);
    expect(checkScene(built).findings).toEqual([]);
    const last = lastFrameOf(built.timeline);
    if (last === undefined) {
      throw new Error("the sample has no length");
    }
    for (const frame of spreadFrames(0, last, RECORDED_FRAMES[kind])) {
      expect(record(built, frame)).toMatchSnapshot(`frame ${String(frame)}`);
    }
  });

  it.each(ITEMS)(
    "uses no built-in by name in the sample of the %s %s",
    (_kind, _name, definition) => {
      const built = sampleOf(definition);
      const items = built.timeline.rows.flatMap((row) =>
        row.tracks.flatMap((track) => track.segments.map((segment) => segment.data)),
      );
      for (const data of items) {
        // A prop passed as its definition keeps it; one named by a string keeps `null`.
        expect(data).not.toMatchObject({ definition: null });
      }
    },
  );

  it("puts a figure in every action's and expression's sample, and the item in a prop's", () => {
    for (const [kind, name, definition] of ITEMS) {
      const tracks = sampleOf(definition).timeline.rows.flatMap((row) => row.tracks);
      expect(tracks.map((track) => track.kind)).toContain(
        kind === "prop" ? "prop" : "actor",
      );
      if (kind === "prop") {
        expect(tracks.map((track) => track.name)).toContain(name);
      }
    }
  });
});

describe("a scene written with names", () => {
  /** Three rows that use the three actions, every mood an action lists, and both props. */
  function depthOne(stage: Stage): void {
    const sitter = stage.row(0).actor();
    stage.row(0).prop("box").place({ x: -0.24, y: 0 });
    sitter.do("sitDown", { mood: "dejected" });
    sitter.do("slump", { mood: "dejected", depth: 1 });
    sitter.express("neutral");

    const thrower = stage.row(1).actor();
    const ball = stage.row(1).prop("ball");
    thrower.do("throw", { ball, mood: "focused", to: { x: 2.5, y: 0 } });
    thrower.do("slump");
    thrower.express("focused", { intensity: 0.5 });

    const other = stage.row(2).actor();
    const second = stage.row(2).prop("ball", { radius: 0.1 });
    other.do("throw", { ball: second, mood: "dejected", bounce: false });
    other.do("sitDown", { seat: 0.3 });
    other.express("dejected");
  }

  // R4
  it("serialises without the lossy marker and parses back to an equal timeline", () => {
    const built = scene({ rows: 3 }, depthOne);
    expect(built.findings).toEqual([]);
    const text = serializeTimeline(built.timeline);
    expect(text.startsWith('{"version":1,"lossy":false,')).toBe(true);
    expect(text).not.toContain("$omitted");
    const parsed = parseTimeline(text);
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    expect(parsed.document.lossy).toBe(false);
    expect(parsed.document.timeline).toEqual(built.timeline);
    expect(serializeTimeline(parsed.document.timeline)).toBe(text);
  });

  it("draws the same frames from the parsed timeline as from the scene", () => {
    const built = scene({ rows: 3 }, depthOne);
    const parsed = parseTimeline(serializeTimeline(built.timeline));
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    const again = { ...built, timeline: parsed.document.timeline };
    for (const frame of [0, 20, 45, 70]) {
      expect(record(again, frame)).toBe(record(built, frame));
    }
  });

  it("passes the checks without an error", () => {
    expect(errors(checkScene(scene({ rows: 3 }, depthOne)).findings)).toEqual([]);
  });

  it("resolves sitDown with a mood to the same calls as its definitions give", () => {
    const named = scene((stage) => {
      stage.actor().do("sitDown", { mood: "dejected" });
    });
    const passed = scene((stage) => {
      stage.actor().do(builtinActions.sitDown, { mood: builtinExpressions.dejected });
    });
    expect(named.findings).toEqual([]);
    expect(segmentsOf(named, "actor").length).toBeGreaterThan(1);
    expect(segmentsOf(named, "actor")).toEqual(segmentsOf(passed, "actor"));
  });

  it("records a thrown ball held by handR until the release mark, then on a closed-form path", () => {
    let release = Number.NaN;
    const built = scene((stage) => {
      const ball = stage.prop("ball");
      const actor = stage.actor();
      actor.wait(1);
      const thrown = actor.do("throw", { ball, bounce: false });
      release = thrown.marks.release;
      expect(thrown.start).toBe(1);
      expect(release).toBeGreaterThan(thrown.start);
      expect(release).toBeLessThan(thrown.end);
    });
    expect(built.findings).toEqual([]);
    const [shown, hold, flight, ...rest] = segmentsOf(built, "prop");
    expect(rest).toEqual([]);
    expect(shown).toMatchObject({
      data: { kind: "prop", name: "ball", definition: null },
    });
    expect(hold).toMatchObject({
      start: 1_000_000,
      end: null,
      data: {
        kind: "hold",
        effector: "handR",
        actor: { name: "actor", occurrence: 0 },
      },
    });
    expect(flight).toMatchObject({
      start: Math.round(release * 1e6),
      data: { kind: "move", x: 1, y: 0, arc: 0.3 },
    });
  });

  it("reports an action named slum as unknown, nearest slump", () => {
    const built = scene({ duration: 1 }, (stage) => {
      const actor: Actor = stage.actor();
      // The types reject the name; a scene file runs with them erased.
      loosely(actor)("slum");
    });
    expect(built.findings).toHaveLength(1);
    expect(built.findings[0]).toMatchObject({
      code: "ERR_SCENE_UNKNOWN_ACTION",
      severity: "error",
      nearest: ["slump"],
    });
  });
});

describe("a built-in action", () => {
  /** One action alone on a rest figure, with whatever it needs beside it. */
  function alone(name: keyof typeof builtinActions, options: object): Scene {
    return scene((stage) => {
      const actor = stage.actor();
      loosely(actor)(
        name,
        name === "throw" ? { ball: stage.prop("ball"), ...options } : options,
      );
      actor.wait(0.3);
    });
  }

  const moods = [undefined, ...Object.keys(builtinExpressions)];

  it.each([
    ["sitDown", {}],
    ["sitDown", { seat: 0.2 }],
    ["sitDown", { seat: 0.4 }],
    ["sitDown", { duration: 0.4 }],
    ["sitDown", { duration: 4 }],
    ["slump", {}],
    ["slump", { depth: 0.2 }],
    ["slump", { depth: 1 }],
    ["slump", { duration: 0.3 }],
    ["slump", { duration: 4 }],
    ["throw", {}],
    ["throw", { to: { x: 3, y: 0 }, loft: 1.5 }],
    ["throw", { to: { x: 0.4, y: 1.2 }, loft: 0.05, bounce: false }],
    ["throw", { duration: 0.5 }],
    ["throw", { duration: 4 }],
  ] as const)("keeps every joint within its limits: %s %j", (name, options) => {
    for (const mood of moods) {
      const built = alone(name, mood === undefined ? options : { ...options, mood });
      expect(built.findings).toEqual([]);
      const found = checkScene(built).findings.filter(
        (finding) => finding.code !== "ERR_CHECK_OFF_FRAME",
      );
      expect(found).toEqual([]);
    }
  });

  it.each(Object.keys(builtinActions))(
    "puts no function on the timeline: %s",
    (name) => {
      for (const mood of moods) {
        const built = alone(name as keyof typeof builtinActions, { mood });
        expect(serializeTimeline(built.timeline)).toContain('"lossy":false');
      }
    },
  );

  it.each(Object.keys(builtinActions))(
    "lasts the duration it was asked for: %s",
    (name) => {
      for (const mood of moods) {
        const built = scene((stage) => {
          const actor = stage.actor();
          const options = { duration: 2, ...(mood === undefined ? {} : { mood }) };
          const span = loosely(actor)(
            name,
            name === "throw" ? { ball: stage.prop("ball"), ...options } : options,
          );
          expect(span.end).toBe(2);
          // Nothing the action records on the actor runs past what it was given.
          expect(actor.wait(0).start).toBe(2);
        });
        expect(built.findings).toEqual([]);
      }
    },
  );

  it("changes the body, not only the face, for a mood it lists", () => {
    const body = (name: keyof typeof builtinActions, mood?: string): unknown =>
      segmentsOf(alone(name, mood === undefined ? {} : { mood }), "actor").filter(
        (segment) =>
          // The mood's own face pose is the one segment a mood always adds.
          !JSON.stringify(segment).includes("mouthCurve"),
      );
    for (const [name, { moods: listed }] of ACTIONS) {
      const key = name as keyof typeof builtinActions;
      for (const mood of Object.keys(builtinExpressions)) {
        if (listed.includes(mood)) {
          expect(body(key, mood)).not.toEqual(body(key));
        } else {
          expect(body(key, mood)).toEqual(body(key));
        }
      }
    }
  });

  it("makes a dejected throw fall short of where the same throw lands", () => {
    const landing = (mood?: string): number => {
      const options = { bounce: false, ...(mood === undefined ? {} : { mood }) };
      const flight = segmentsOf(alone("throw", options), "prop").at(-1);
      return (flight as { data: { x: number } }).data.x;
    };
    expect(landing()).toBe(1);
    expect(landing("focused")).toBe(1);
    expect(landing("dejected")).toBeCloseTo(0.55, 10);
  });

  it("sits the hips just above the seat it is given, behind the feet", () => {
    const built = alone("sitDown", { seat: 0.3 });
    const seated = segmentsOf(built, "actor")
      .map(
        (segment) =>
          (segment as { data: { channels?: Record<string, number> } }).data.channels,
      )
      .find((channels) => channels?.["pelvisX"] === -0.24);
    expect(seated?.["pelvisY"]).toBeCloseTo(0.3 + 0.015 - 0.48, 10);
  });
});
