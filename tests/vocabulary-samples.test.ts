import { describe, expect, it } from "vitest";

import { sampleFrames } from "../src/check/catalog.js";
import { checkScene, lastFrameOf } from "../src/check/check.js";
import { type LogEntry, RecordingContext } from "../src/check/recorder.js";
import { spreadFrames } from "../src/check/sheet.js";
import { drawFrame } from "../src/draw/frame.js";
import { propPlacement } from "../src/draw/prop.js";
import {
  type ActionDefinition,
  type Actor,
  type BackdropDefinition,
  builtinActions,
  builtinBackdrops,
  builtinEffects,
  builtinExpressions,
  builtinProps,
  type Definition,
  type EffectDefinition,
  type ExpressionDefinition,
  type Finding,
  type Row,
  type Scene,
  scene,
  type Span,
  type Stage,
} from "../src/index.js";
import { poseAtFrame } from "../src/rig/compose.js";
import { forwardKinematics, type Skeleton } from "../src/rig/kinematics.js";
import type { Pose } from "../src/rig/rig.js";
import { parseTimeline, serializeTimeline } from "../src/timeline/json.js";

/** How many frames of a sample are recorded, spread from its first to its last. */
const RECORDED_FRAMES = { action: 7, effect: 7 };

/**
 * The frames of a sample that are recorded. What moves is spread over the sample; what
 * holds still is the one frame `catalog --images` draws, so an expression is recorded
 * where its blend has arrived rather than at the resting face it starts from.
 */
function recordedFrames(kind: Definition["kind"], built: Scene): number[] {
  const last = lastFrameOf(built.timeline);
  if (last === undefined) {
    throw new Error("the sample has no length");
  }
  return kind === "action" || kind === "effect"
    ? spreadFrames(0, last, RECORDED_FRAMES[kind])
    : sampleFrames(kind, built);
}

/** The face channels' ranges, as `.claude/rules/engine.md` § The rig states them. */
const FACE_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  eyeOpen: [0, 1.5],
  gazeX: [-1, 1],
  gazeY: [-1, 1],
  browHeight: [-1, 1],
  browTilt: [-1, 1],
  mouthCurve: [-1, 1],
  mouthOpen: [0, 1],
  mouthWidth: [0.5, 1.5],
};

const EXPRESSIONS: readonly (readonly [string, ExpressionDefinition])[] =
  Object.entries(builtinExpressions);

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
  it("is the twelve actions, six expressions, ten props, five backdrops and four effects", () => {
    expect(ITEMS.map(([kind, name]) => `${kind} ${name}`)).toEqual([
      "action carry",
      "action cheer",
      "action pickUp",
      "action point",
      "action push",
      "action run",
      "action sitDown",
      "action slump",
      "action stand",
      "action think",
      "action throw",
      "action walk",
      "expression angry",
      "expression dejected",
      "expression focused",
      "expression happy",
      "expression neutral",
      "expression surprised",
      "prop ball",
      "prop box",
      "prop cart",
      "prop desk",
      "prop hoop",
      "prop ladder",
      "prop laptop",
      "prop lever",
      "prop lightbulb",
      "prop rock",
      "backdrop court",
      "backdrop hill",
      "backdrop night",
      "backdrop office",
      "backdrop plain",
      "effect impact",
      "effect sparkle",
      "effect speedLines",
      "effect sweat",
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

  it("states the marks of throw, cheer, point and the three that move a prop, and none for the other actions", () => {
    expect(
      Object.fromEntries(ACTIONS.map(([name, { marks }]) => [name, marks])),
    ).toEqual({
      carry: ["loaded", "off", "stop"],
      cheer: ["up"],
      pickUp: ["grip", "up"],
      point: ["aimed"],
      push: ["contact", "heave", "stop"],
      run: [],
      sitDown: [],
      slump: [],
      stand: [],
      think: [],
      throw: ["release"],
      walk: [],
    });
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
    for (const frame of recordedFrames(kind, built)) {
      expect(record(built, frame)).toMatchSnapshot(`frame ${String(frame)}`);
    }
  });

  it("records each expression where its face has arrived, not the resting face", () => {
    const faces = EXPRESSIONS.map(([, definition]) => {
      const built = sampleOf(definition);
      const [frame] = recordedFrames("expression", built);
      return record(built, frame ?? 0);
    });
    // Every face is its own: no two expressions record the same drawing.
    expect(new Set(faces).size).toBe(EXPRESSIONS.length);
  });

  it.each(Object.entries(builtinProps) as [string, Definition][])(
    "shows the prop %s in the frame its catalog image draws",
    (_name, definition) => {
      const built = sampleOf(definition);
      const empty = scene({ duration: 1 }, () => undefined);
      expect(sampleFrames("prop", built)).toEqual([0]);
      expect(record(built, 0)).not.toBe(record(empty, 0));
    },
  );

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

describe("a built-in expression", () => {
  const settings = [{ intensity: 0 }, { intensity: 0.5 }, { intensity: 1 }];

  /** The channels an expression returns for `params`, as a scene's call resolves them. */
  function faceOf(
    definition: ExpressionDefinition,
    params: object,
  ): Readonly<Record<string, number | undefined>> {
    return (
      definition as unknown as { build(params: object): Record<string, number> }
    ).build(params);
  }

  // R1
  it.each(EXPRESSIONS)(
    "returns all eight face channels within their ranges: %s",
    (_name, definition) => {
      for (const params of settings) {
        const face = faceOf(definition, params);
        expect(Object.keys(face).sort()).toEqual(Object.keys(FACE_RANGES).sort());
        for (const [channel, [min, max]] of Object.entries(FACE_RANGES)) {
          expect(face[channel]).toBeGreaterThanOrEqual(min);
          expect(face[channel]).toBeLessThanOrEqual(max);
        }
      }
    },
  );

  it.each(EXPRESSIONS.filter(([name]) => name !== "neutral"))(
    "is the resting face at intensity 0: %s",
    (_name, definition) => {
      const rest: Readonly<Record<string, number>> = {
        eyeOpen: 1,
        gazeX: 0,
        gazeY: 0,
        browHeight: 0,
        browTilt: 0,
        mouthCurve: 0,
        mouthOpen: 0,
        mouthWidth: 1,
      };
      for (const [channel, value] of Object.entries(rest)) {
        expect(faceOf(definition, { intensity: 0 })[channel]).toBeCloseTo(value, 10);
      }
    },
  );

  it.each([
    ["happy", "mouthCurve", 1],
    ["angry", "browTilt", -1],
    ["surprised", "eyeOpen", 1.5],
  ] as const)("shows %s by taking %s to %d", (name, channel, value) => {
    expect(builtinExpressions[name].build({ intensity: 1 })[channel]).toBe(value);
  });

  it("reports an expression named angy as unknown, nearest angry", () => {
    const built = scene({ duration: 1 }, (stage) => {
      // The types reject the name; a scene file runs with them erased.
      (stage.actor() as unknown as { express(name: string): Span }).express("angy");
    });
    expect(built.findings).toHaveLength(1);
    expect(built.findings[0]).toMatchObject({
      code: "ERR_SCENE_UNKNOWN_EXPRESSION",
      severity: "error",
      nearest: ["angry"],
    });
  });

  it("changes only the face of a slump when it is angry, a mood slump does not list", () => {
    const slump = (mood?: "angry"): Scene =>
      scene((stage) => {
        stage.actor().do("slump", mood === undefined ? {} : { mood });
      });
    const plain = slump();
    const angry = slump("angry");
    expect(builtinActions.slump.moods).not.toContain("angry");
    const last = lastFrameOf(plain.timeline) ?? 0;
    expect(lastFrameOf(angry.timeline)).toBe(last);
    expect(record(angry, last)).not.toBe(record(plain, last));
    const faceless = (built: Scene): unknown[] =>
      segmentsOf(built, "actor").filter(
        (segment) => !JSON.stringify(segment).includes("mouthCurve"),
      );
    expect(faceless(angry)).toEqual(faceless(plain));
    expect(segmentsOf(angry, "actor").length).toBe(
      segmentsOf(plain, "actor").length + 1,
    );
  });
});

describe("a built-in prop", () => {
  /** `row.prop` as a scene file calls it once its types are erased. */
  function propOf(stage: Stage, name: string, options?: object): void {
    (stage as unknown as { prop(name: string, options?: object): unknown }).prop(
      name,
      options,
    );
  }

  /** Frame `frame` of a 3 s scene holding one prop, named by its string. */
  function drawn(name: string, options: object, frame: number): string {
    const built = scene({ duration: 3 }, (stage) => {
      propOf(stage, name, options);
    });
    expect(built.findings).toEqual([]);
    return record(built, frame);
  }

  it("draws the rock with its ground point on the row's ground line", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.prop("rock").place({ x: 0.5, y: 0 });
    });
    expect(built.findings).toEqual([]);
    const log = record(built, 0).split("\n");
    expect(log).toContain("translate 5000 0");
    // The outline's first point: 45 of the grid's 100 left of the foot, on y = 0.
    expect(log).toContain("moveTo -3150 0");
  });

  it("does not let an open-ended lightbulb extend the scene", () => {
    const alone = scene((stage) => {
      stage.prop("lightbulb");
    });
    expect(alone.findings.map((finding) => finding.code)).toEqual([
      "ERR_SCENE_NO_DURATION",
    ]);
    const beside = scene((stage) => {
      stage.prop("lightbulb");
      stage.actor().wait(1);
    });
    expect(beside.findings).toEqual([]);
    expect(lastFrameOf(beside.timeline)).toBe(30);
  });

  it("reports a prop named latop as unknown, nearest laptop", () => {
    const built = scene({ duration: 1 }, (stage) => {
      propOf(stage, "latop");
    });
    expect(built.findings).toHaveLength(1);
    expect(built.findings[0]).toMatchObject({
      code: "ERR_SCENE_UNKNOWN_PROP",
      severity: "error",
      nearest: ["laptop"],
    });
  });

  it("swings the lever once, from tilt to tilt + swing, and holds it there", () => {
    const worked = { tilt: 0.4, swing: -0.5, swingAt: 1, swingFor: 1 };
    expect(drawn("lever", worked, 0)).toBe(drawn("lever", { tilt: 0.4 }, 0));
    expect(drawn("lever", worked, 30)).toBe(drawn("lever", { tilt: 0.4 }, 30));
    // Half way through an eased swing the beam is half way: 0.4 − 0.25.
    expect(drawn("lever", worked, 45)).toBe(drawn("lever", { tilt: 0.15 }, 45));
    expect(drawn("lever", worked, 60)).toBe(drawn("lever", { tilt: -0.1 }, 60));
    expect(drawn("lever", worked, 90)).toBe(drawn("lever", { tilt: -0.1 }, 90));
  });

  it("turns the cart's wheels with its roll, at constant speed, and keeps them there", () => {
    // 0.9 units on wheels of radius 0.09 is 10 rad.
    const rolling = { roll: 0.9, rollAt: 1, rollFor: 1 };
    expect(drawn("cart", rolling, 30)).toBe(drawn("cart", {}, 30));
    expect(drawn("cart", rolling, 45)).toBe(drawn("cart", { turn: 5 }, 45));
    expect(drawn("cart", rolling, 60)).toBe(drawn("cart", { turn: 10 }, 60));
    expect(drawn("cart", rolling, 90)).toBe(drawn("cart", { turn: 10 }, 90));
    expect(drawn("cart", { turn: 1 }, 0)).not.toBe(drawn("cart", {}, 0));
  });

  it.each([
    ["lever", { swing: 0.3, swingFor: 0 }, { tilt: 0.7 }],
    ["cart", { roll: 0.9, rollFor: 0 }, { turn: 10 }],
  ])("moves the %s at once when its motion takes no time", (name, sudden, settled) => {
    expect(drawn(name, sudden, 0)).toBe(drawn(name, settled, 0));
  });

  it.each([
    ["hoop", "faces", "right"],
    ["laptop", "faces", "right"],
    ["lever", "handle", "right"],
    ["cart", "handle", "right"],
  ])("mirrors the %s when %s is %s", (name, key, value) => {
    const mirrored = drawn(name, { [key]: value }, 0).split("\n");
    expect(mirrored).toContain("scale -10000 10000");
    expect(drawn(name, {}, 0).split("\n")).not.toContain("scale -10000 10000");
  });

  it("lights the lightbulb with rays in its colour, and draws none unlit", () => {
    expect(drawn("lightbulb", { color: "#00ff00" }, 0)).toContain("#00ff00");
    expect(drawn("lightbulb", { color: "#00ff00", lit: false }, 0)).not.toContain(
      "#00ff00",
    );
  });

  it("shuts the laptop flat at open 0, without a lit screen", () => {
    const shut = drawn("laptop", { open: 0, screen: "#00ff00" }, 0);
    expect(shut.split("\n")).toContain(`rotate ${String(Math.round(Math.PI * 1e4))}`);
    expect(shut).not.toContain("#00ff00");
    expect(drawn("laptop", { screen: "#00ff00" }, 0)).toContain("#00ff00");
  });

  it.each(
    Object.entries(builtinProps).flatMap(([name, definition]: [string, Definition]) =>
      Object.entries(definition.params).flatMap(([key, param]) =>
        param.type === "number"
          ? [param.min, param.max]
              .filter((end) => end !== undefined)
              .map((end) => [name, key, end] as const)
          : [],
      ),
    ),
  )("draws the %s with %s at its end %d", (name, key, end) => {
    const built = scene((stage) => {
      propOf(stage, name, { [key]: end });
      stage.actor().wait(1);
    });
    expect(built.findings).toEqual([]);
    expect(checkScene(built).findings).toEqual([]);
  });
});

describe("a built-in backdrop", () => {
  const BACKDROPS: readonly (readonly [string, BackdropDefinition])[] =
    Object.entries(builtinBackdrops);

  /** `row.backdrop` as a scene file calls it once its types are erased. */
  function backdropOf(
    row: Row,
    name: string | BackdropDefinition,
    options?: object,
  ): void {
    (row as unknown as { backdrop(name: unknown, options?: object): unknown }).backdrop(
      name,
      options,
    );
  }

  /** Frame 0 of a one-row scene of `size` showing the backdrop `name`. */
  function shown(name: string, options: object = {}, size: object = {}): string[] {
    const built = scene({ ...size, duration: 1 }, (stage) => {
      backdropOf(stage, name, options);
    });
    expect(built.findings).toEqual([]);
    return record(built, 0).split("\n");
  }

  /** Where each row's clip band is set in a log: the `rect` that spans the canvas. */
  function bands(log: readonly string[]): number[] {
    return log.flatMap((entry, index) =>
      /^rect 0 \d+ 10800000 /.test(entry) ? [index] : [],
    );
  }

  // #24 R1: one row is the sample itself, recorded with every other item above.
  it.each(BACKDROPS)(
    "draws the backdrop %s as recorded in a row of four",
    (name, definition) => {
      const built = scene({ rows: 4, duration: 1 }, (stage) => {
        backdropOf(stage.row(2), definition);
      });
      expect(built.findings).toEqual([]);
      expect(checkScene(built).findings).toEqual([]);
      expect(sampleFrames("backdrop", built)).toEqual([0]);
      expect(record(built, 0)).toMatchSnapshot(`${name} in row 2 of 4`);
    },
  );

  it.each(BACKDROPS)(
    "shows the backdrop %s in the frame its catalog image draws",
    (_name, definition) => {
      const built = sampleOf(definition);
      const bare = scene((stage) => {
        stage.actor().wait(1);
      });
      expect(sampleFrames("backdrop", built)).toEqual([0]);
      expect(record(built, 0)).not.toBe(record(bare, 0));
    },
  );

  // #24 R2
  it.each(BACKDROPS)(
    "draws the backdrop %s before the ground line, every prop and the actor of its row",
    (name) => {
      const alone = scene({ duration: 1 }, (stage) => {
        backdropOf(stage, name);
      });
      const busy = scene({ duration: 1 }, (stage) => {
        // Made last, drawn first: the order is the drawer's.
        stage.prop("box").place({ x: -0.5, y: 0 });
        stage.prop("ball").place({ x: 0.5, y: 0 }, { layer: "front" });
        stage.actor();
        backdropOf(stage, name);
      });
      const bare = scene({ duration: 1 }, (stage) => {
        stage.prop("box").place({ x: -0.5, y: 0 });
        stage.prop("ball").place({ x: 0.5, y: 0 }, { layer: "front" });
        stage.actor();
      });
      const [backdropLog, busyLog, bareLog] = [alone, busy, bare].map((built) =>
        record(built, 0).split("\n"),
      );
      // Everything but the restore that closes the row: the backdrop, then the ground.
      const first = backdropLog?.slice(0, -1) ?? [];
      const empty = record(
        scene({ duration: 1 }, () => undefined),
        0,
      ).split("\n");
      expect(first.length).toBeGreaterThan(empty.length);
      expect(busyLog?.slice(0, first.length)).toEqual(first);
      // What follows is exactly what the props and the actor draw without a backdrop.
      expect(busyLog?.slice(first.length)).toEqual(bareLog?.slice(empty.length - 1));
    },
  );

  const SHAPES = [
    // width, height, rows, the row's width in units
    [1080, 1080, 1, 2.5],
    [1920, 1080, 1, 40 / 9],
    [1080, 1080, 4, 10],
    [1920, 1080, 4, 160 / 9],
  ] as const;

  it.each(
    BACKDROPS.flatMap(([name]) => SHAPES.map((shape) => [name, ...shape] as const)),
  )(
    "paints %s over its whole row, edge to edge: %i × %i, %i row(s)",
    (name, width, height, rows, units) => {
      const built = scene({ width, height, rows, duration: 1 }, (stage) => {
        backdropOf(stage.row(rows - 1), name);
      });
      expect(built.findings).toEqual([]);
      const fills = record(built, 0)
        .split("\n")
        .filter((entry) => entry.startsWith("fillRect "))
        .map((entry) => entry.split(" ").slice(1).map(Number));
      const [left, wide] = [Math.round(-units * 5000), Math.round(units * 1e4)];
      // From the ground line to the row's top, and the 0.3 below the ground line.
      expect(fills).toContainEqual([left, 0, wide, 22000]);
      expect(fills).toContainEqual([left, -3000, wide, 3000]);
    },
  );

  it("draws the office behind row 1 only", () => {
    const rowsOf = (backdrop: boolean): string[] =>
      record(
        scene({ rows: 4 }, (stage) => {
          if (backdrop) {
            stage.row(1).backdrop("office");
          }
          for (let row = 0; row < 4; row += 1) {
            stage.row(row).actor().wait(1);
          }
        }),
        0,
      ).split("\n");
    const [without, behind] = [rowsOf(false), rowsOf(true)];
    const [, start = 0, next = 0] = bands(without);
    const added = behind.length - without.length;
    expect(added).toBeGreaterThan(10);
    // Rows 0, 2 and 3 draw what they drew; everything new is inside row 1's band.
    expect(behind.slice(0, start + 1)).toEqual(without.slice(0, start + 1));
    expect(behind.slice(next + added)).toEqual(without.slice(next));
    expect(bands(behind)[2]).toBe(next + added);
  });

  it.each([
    // `nite` is three edits from `night`, past the two the nearest-name metric allows.
    ["nite", []],
    ["nigt", ["night"]],
    ["Plain", ["plain"]],
    ["offce", ["office"]],
  ])("reports a backdrop named %s as unknown, nearest %j", (name, nearest) => {
    const built = scene({ duration: 1 }, (stage) => {
      backdropOf(stage, name);
    });
    expect(built.findings).toHaveLength(1);
    expect(built.findings[0]).toMatchObject({
      code: "ERR_SCENE_UNKNOWN_BACKDROP",
      severity: "error",
      nearest,
    });
  });

  it("does not let an open-ended backdrop extend the scene", () => {
    const built = scene((stage) => {
      stage.backdrop("hill");
      stage.actor().wait(1);
    });
    expect(built.findings).toEqual([]);
    expect(lastFrameOf(built.timeline)).toBe(30);
  });

  it.each([
    ["plain", { color: "#00ff00" }],
    ["plain", { floor: "#00ff00" }],
    ["court", { floor: "#00ff00" }],
    ["court", { sky: "#00ff00" }],
    ["office", { wall: "#00ff00" }],
    ["office", { floor: "#00ff00" }],
    ["hill", { grass: "#00ff00" }],
    ["hill", { sky: "#00ff00" }],
    ["night", { sky: "#00ff00" }],
    ["night", { horizon: "#00ff00" }],
  ])("paints %s in the colour it is given: %j", (name, options) => {
    expect(shown(name).join("\n")).not.toContain("#00ff00");
    expect(shown(name, options).join("\n")).toContain("#00ff00");
  });

  it("hangs blinds in the office windows unless told not to", () => {
    const [bare, hung] = [shown("office", { blinds: false }), shown("office")];
    expect(hung.length).toBeGreaterThan(bare.length);
    expect(shown("office", { blinds: true })).toEqual(hung);
  });

  it("draws the night's moon as a crescent, a full disc or not at all", () => {
    const moons = ["crescent", "full", "none"].map((moon) => shown("night", { moon }));
    expect(new Set(moons.map((log) => log.join("\n"))).size).toBe(3);
    expect(shown("night")).toEqual(moons[0]);
    // The full moon is one disc of radius 0.16 at (0.85, 1.78).
    expect(moons[1]).toContain(
      `arc 8500 17800 1600 0 ${String(Math.round(Math.PI * 2e4))}`,
    );
    expect(moons[0]).not.toContain(
      `arc 8500 17800 1600 0 ${String(Math.round(Math.PI * 2e4))}`,
    );
  });

  it("scatters the night's stars by the scene's seed, the same on every frame", () => {
    const night = (seed: number, frame: number): string =>
      record(
        scene({ seed, duration: 1 }, (stage) => {
          stage.backdrop("night");
        }),
        frame,
      );
    expect(night(1, 0)).toBe(night(1, 30));
    expect(night(1, 0)).not.toBe(night(2, 0));
  });

  it("shows more of the same picture in a wider row, not a stretched one", () => {
    // What a square row draws of the hill's tree, a wide row draws too.
    const square = shown("hill");
    const wide = shown("hill", {}, { width: 1920 });
    const tree = square.findIndex((entry) => entry.startsWith("translate 9500 "));
    expect(tree).toBeGreaterThan(-1);
    expect(wide).toContain(square[tree]);
  });
});

describe("a built-in effect", () => {
  const EFFECTS: readonly (readonly [string, EffectDefinition])[] =
    Object.entries(builtinEffects);

  /** `row.effect` as a scene file calls it once its types are erased. */
  function effectOf(row: Row, name: string, options?: object): Span {
    return (row as unknown as { effect(name: string, options?: object): Span }).effect(
      name,
      options,
    );
  }

  /** The effect `name` alone, 1.2 units up a one-row scene, for one second. */
  function alone(name: string, options: object = {}, seed = 0): Scene {
    return scene({ seed }, (stage) => {
      effectOf(stage, name, { on: { x: 0, y: 1.2 }, duration: 1, ...options });
    });
  }

  /** What an effect draws in a frame: the calls from its fill colour's line on. */
  function drawnBy(built: Scene, frame: number, colour: string): string[] {
    const log = record(built, frame).split("\n");
    const first = log.indexOf(`fillStyle "${colour}"`);
    return first === -1 ? [] : log.slice(first);
  }

  // #25 R2
  it.each(EFFECTS)(
    "draws frame n of %s the same alone as after frames 0 to n − 1",
    (_name, definition) => {
      const built = sampleOf(definition);
      const frames = recordedFrames("effect", built);
      expect(frames).toHaveLength(7);
      const ctx = new RecordingContext();
      for (let frame = 0; frame <= (frames.at(-1) ?? 0); frame += 1) {
        const before = ctx.log.length;
        drawFrame(ctx, built, frame);
        if (frames.includes(frame)) {
          expect(ctx.log.slice(before).map(line).join("\n")).toBe(record(built, frame));
        }
      }
    },
  );

  // #25 R3
  it.each(EFFECTS)(
    "scatters %s by the scene's seed, the same again with the same seed",
    (_name, definition) => {
      const frames = recordedFrames("effect", sampleOf(definition));
      const drawn = (seed: number): string => {
        const built = scene({ seed }, (stage) => {
          definition.sample?.(stage);
        });
        return frames.map((frame) => record(built, frame)).join("\n");
      };
      expect(drawn(1)).toBe(drawn(1));
      expect(drawn(1)).not.toBe(drawn(2));
    },
  );

  // #25 R4
  it.each(EFFECTS)(
    "reads no clock and no unseeded random number in the sample of %s",
    (_name, definition) => {
      const codes = checkScene(sampleOf(definition)).findings.map(({ code }) => code);
      expect(codes).not.toContain("ERR_CHECK_CLOCK_READ");
      expect(codes).not.toContain("ERR_CHECK_UNSEEDED_RANDOM");
      expect(codes).toEqual([]);
    },
  );

  it.each(EFFECTS)(
    "shows %s in the frames its sample is recorded at",
    (name, definition) => {
      const built = sampleOf(definition);
      const bare = scene((stage) => {
        definition.sample?.(stage);
      });
      // The same sample without its effect track draws less where the effect shows.
      const without: Scene = {
        ...bare,
        timeline: {
          ...bare.timeline,
          rows: bare.timeline.rows.map((row) => ({
            tracks: row.tracks.filter((track) => track.kind !== "effect"),
          })),
        },
      };
      const shownIn = recordedFrames("effect", built).filter(
        (frame) => record(built, frame) !== record(without, frame),
      );
      // An impact is over in 0.4 s, so one recorded frame catches it; the others loop.
      expect(shownIn.length).toBeGreaterThanOrEqual(name === "impact" ? 1 : 4);
      expect(
        sampleFrames("effect", built).filter(
          (frame) => record(built, frame) !== record(without, frame),
        ).length,
      ).toBeGreaterThanOrEqual(2);
    },
  );

  it.each(EFFECTS)(
    "draws %s at the ends of its parameters without a finding",
    (name, definition) => {
      for (const [key, spec] of Object.entries(definition.params)) {
        const ends =
          spec.type === "number"
            ? [spec.min, spec.max]
            : spec.type === "enum"
              ? spec.values
              : [];
        for (const value of ends) {
          for (const options of [{ [key]: value }, { [key]: value, duration: 0 }]) {
            const built = scene({ duration: 1 }, (stage) => {
              stage.actor();
              effectOf(stage, name, { on: { x: 0, y: 1.2 }, ...options });
            });
            expect(built.findings).toEqual([]);
            expect(checkScene(built).findings).toEqual([]);
          }
        }
      }
    },
  );

  it.each(EFFECTS)("draws %s at progress 0 and in its last frame", (name) => {
    const built = alone(name);
    // One second at 30 fps is frames 0 to 29; the segment is half-open.
    expect(record(built, 0)).toContain("translate 0 12000");
    expect(record(built, 29)).toContain("translate 0 12000");
    expect(record(built, 30)).not.toContain("translate 0 12000");
    expect(record(built, 29)).not.toBe(record(built, 0));
  });

  it.each(EFFECTS)("puts no function on the timeline: %s", (name) => {
    const built = scene({ duration: 1 }, (stage) => {
      effectOf(stage, name, { on: stage.actor() });
    });
    expect(built.findings).toEqual([]);
    expect(serializeTimeline(built.timeline)).toContain('"lossy":false');
  });

  // #25 Examples, normal
  it("draws sweat near the head across a dejected slump", () => {
    const built = scene((stage) => {
      const actor = stage.actor();
      const slump = loosely(actor)("slump", { mood: "dejected" });
      effectOf(stage, "sweat", { on: actor, duration: slump.duration });
    });
    expect(built.findings).toEqual([]);
    expect(checkScene(built).findings).toEqual([]);
    const last = lastFrameOf(built.timeline) ?? 0;
    const heads: string[] = [];
    for (const frame of spreadFrames(0, last, 6).slice(1, -1)) {
      const log = record(built, frame).split("\n");
      // The head is the one circle of radius 0.09; the effect's origin is its centre.
      const head = /^arc (-?\d+) (-?\d+) 900 /.exec(
        log.find((entry) => /^arc -?\d+ -?\d+ 900 /.test(entry)) ?? "",
      );
      expect(head).not.toBeNull();
      const origin = `translate ${head?.[1] ?? ""} ${head?.[2] ?? ""}`;
      const drops = log.slice(log.lastIndexOf(origin));
      expect(drops[0]).toBe(origin);
      expect(drops).toContain('fillStyle "#8fd0f5"');
      expect(drops.filter((entry) => entry === "fill").length).toBeGreaterThan(0);
      // Each droplet is drawn within 0.35 units of the head's centre.
      for (const entry of drops.slice(1)) {
        const moved = /^translate (-?\d+) (-?\d+)$/.exec(entry);
        if (moved !== null) {
          expect(Math.hypot(Number(moved[1]), Number(moved[2]))).toBeLessThan(3500);
        }
      }
      heads.push(origin);
    }
    // The head drops through the slump, and the droplets go with it.
    expect(new Set(heads).size).toBeGreaterThan(1);
  });

  // #25 Examples, boundary
  it("does not reshuffle the first sparkle when a second is added", () => {
    const one = alone("sparkle");
    const two = scene((stage) => {
      effectOf(stage, "sparkle", { on: { x: 0, y: 1.2 }, duration: 1 });
      effectOf(stage, "sparkle", { on: { x: 0.6, y: 1.2 }, duration: 1 });
    });
    for (const frame of [5, 14, 23]) {
      const [first, both] = [
        drawnBy(one, frame, "#ffd84d"),
        drawnBy(two, frame, "#ffd84d"),
      ];
      expect(first.length).toBeGreaterThan(8);
      // Row 0's closing restore is the first log's last line; the rest is the same.
      expect(both.slice(0, first.length - 1)).toEqual(first.slice(0, -1));
      // The second is its own occurrence, so it is scattered differently.
      expect(both.slice(first.length - 1).join("\n")).not.toContain(
        first.slice(0, 12).join("\n"),
      );
    }
  });

  // #25 Examples, error
  it("reports an effect named spakle as unknown, nearest sparkle", () => {
    const built = scene({ duration: 1 }, (stage) => {
      effectOf(stage, "spakle");
    });
    expect(built.findings).toHaveLength(1);
    expect(built.findings[0]).toMatchObject({
      code: "ERR_SCENE_UNKNOWN_EFFECT",
      severity: "error",
      nearest: ["sparkle"],
    });
  });

  it("plays the impact once over its duration, and holds a still burst without one", () => {
    const timed = alone("impact");
    expect(record(timed, 3)).not.toBe(record(timed, 20));
    // It fades from 0.55 of the way on: at 29/30, (1 − 29/30) / 0.45 = 0.0741 is left.
    expect(record(timed, 16)).toContain("globalAlpha 10000");
    expect(record(timed, 29)).toContain("globalAlpha 741");
    const still = scene({ duration: 1 }, (stage) => {
      effectOf(stage, "impact");
    });
    expect(record(still, 3)).toBe(record(still, 20));
    expect(record(still, 3)).toContain("globalAlpha 10000");
  });

  it.each(["sweat", "sparkle", "speedLines"])(
    "keeps %s going when it has no duration",
    (name) => {
      const built = scene({ duration: 2 }, (stage) => {
        effectOf(stage, name);
      });
      expect(checkScene(built).findings).toEqual([]);
      expect(record(built, 20)).not.toBe(record(built, 50));
      expect(record(built, 50)).not.toBe(
        record(
          scene({ duration: 2 }, () => undefined),
          50,
        ),
      );
    },
  );

  it("draws an open-ended sparkle at 3 s as a bounded one starting at 0 draws at 0 s", () => {
    const on = { x: 0, y: 1.2 };
    const bounded = scene({ duration: 1 }, (stage) => {
      effectOf(stage, "sparkle", { on, duration: 1 });
    });
    const late = scene({ duration: 4 }, (stage) => {
      effectOf(stage, "sparkle", { on, at: 3 });
    });
    // 3 s is frame 90 at 30 fps.
    expect(record(late, 90)).toBe(record(bounded, 0));
  });

  it.each(["sweat", "sparkle", "speedLines"])(
    "builds %s up from its own start when it has no duration, whatever its at",
    (name) => {
      const on = { x: 0, y: 1.2 };
      const bounded = scene({ duration: 1 }, (stage) => {
        effectOf(stage, name, { on, duration: 1 });
      });
      const late = (at: number): Scene =>
        scene({ duration: 4 }, (stage) => {
          effectOf(stage, name, { on, at });
        });
      // 1.5 s and 2.2 s are frames 45 and 66 at 30 fps.
      for (const frame of [6, 12, 29]) {
        expect(record(late(1.5), 45 + frame)).toBe(record(bounded, frame));
        expect(record(late(2.2), 66 + frame)).toBe(record(bounded, frame));
      }
    },
  );

  it("trails the speed lines to the left, or to the right of something moving left", () => {
    const xs = (options: object): number[] =>
      record(alone("speedLines", options), 12)
        .split("\n")
        .flatMap((entry) => {
          const point = /^(?:moveTo|lineTo) (-?\d+) /.exec(entry);
          return point === null ? [] : [Number(point[1])];
        });
    // Past the ground line's two points, every streak lies behind the origin.
    const streaks = xs({}).slice(2);
    expect(streaks.length).toBeGreaterThan(4);
    expect(Math.max(...streaks)).toBeLessThanOrEqual(-2200);
    expect(record(alone("speedLines", { moving: "left" }), 12)).toContain(
      "scale -10000 10000",
    );
    expect(record(alone("speedLines"), 12)).not.toContain("scale -10000 10000");
  });

  it("draws as many droplets, stars, streaks and spikes as it is asked for", () => {
    const count = (name: string, options: object, call: string): number =>
      // The last frame: by then every one has begun, however they are staggered.
      record(alone(name, options), 29)
        .split("\n")
        .filter((entry) => entry === call).length;
    expect(count("sweat", { drops: 5 }, "fill")).toBe(5);
    expect(count("sparkle", { stars: 7 }, "fill")).toBe(7);
    // The ground line, then one stroke a streak.
    expect(count("speedLines", { lines: 9 }, "stroke") - 1).toBe(9);
    const spikes = record(alone("impact", { spikes: 9 }), 20)
      .split("\n")
      .filter((entry) => entry.startsWith("lineTo ")).length;
    // The ground line's one, two for each point of the star, one for each flying line.
    expect(spikes - 1).toBe(9 * 3);
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

/** The parameter each action that moves a prop takes it as, and a prop to give it. */
const MOVED: Readonly<Record<string, readonly [string, string]>> = {
  throw: ["ball", "ball"],
  pickUp: ["prop", "box"],
  push: ["prop", "rock"],
  carry: ["prop", "box"],
};

/** `options` with the prop the action `name` needs, made in `row`. */
function withProp(name: string, row: Row, options: object): object {
  const moved = MOVED[name];
  if (moved === undefined) {
    return options;
  }
  const make = row as unknown as { prop(name: string): unknown };
  return { [moved[0]]: make.prop(moved[1]), ...options };
}

describe("a built-in action", () => {
  /** One action alone on a rest figure, with whatever it needs beside it. */
  function alone(name: keyof typeof builtinActions, options: object): Scene {
    // A stand without a duration never ends: the scene is given a length instead.
    const endless = name === "stand" && !Object.hasOwn(options, "duration");
    return scene(endless ? { duration: 3 } : {}, (stage) => {
      const actor = stage.actor();
      loosely(actor)(name, withProp(name, stage.row(0), options));
      if (!endless) {
        actor.wait(0.3);
      }
    });
  }

  /** The same action started 0.7 s into a stand that runs to the end of the scene. */
  function overStand(name: keyof typeof builtinActions, options: object): Scene {
    return scene({ rows: 2 }, (stage) => {
      const actor = stage.row(0).actor();
      actor.do("stand");
      const span = loosely(actor)(
        name,
        withProp(name, stage.row(0), { ...options, at: 0.7 }),
      );
      stage
        .row(1)
        .actor()
        .wait(span.end + 0.6);
    });
  }

  /** The findings of `built` and of its checks, but for leaving the frame. */
  function faults(built: Scene): Finding[] {
    expect(built.findings).toEqual([]);
    return checkScene(built).findings.filter(
      (finding) => finding.code !== "ERR_CHECK_OFF_FRAME",
    );
  }

  const moods = [undefined, ...Object.keys(builtinExpressions)];

  /** What the checks find of `name` in every mood, alone and over a stand. */
  function faultsInEveryMood(
    name: keyof typeof builtinActions,
    options: object,
  ): Finding[] {
    return moods.flatMap((mood) => {
      const asked = mood === undefined ? options : { ...options, mood };
      // Over a stand without a duration each pose that ends is held over it, so an
      // action plays there as it does alone; a stand over a stand is the stand again.
      // The cart's hands follow its handle rather than the body, as any reach does.
      return [
        ...faults(alone(name, asked)),
        ...(name === "stand" ? [] : faults(overStand(name, asked))),
      ];
    });
  }

  it.each([
    ["sitDown", {}],
    ["sitDown", { seat: 0.2 }],
    ["sitDown", { seat: 0.4 }],
    ["sitDown", { duration: 0.4 }],
    ["sitDown", { duration: 4 }],
    ["sitDown", { from: -2 }],
    ["sitDown", { from: 2, seat: 0.4 }],
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
    ["throw", { from: -2 }],
    ["throw", { from: 2, to: { x: 3.5, y: 0 } }],
    // #26 R2
    ["stand", {}],
    ["stand", { duration: 0.2 }],
    ["stand", { duration: 12 }],
    ["walk", {}],
    ["walk", { distance: 0.3 }],
    ["walk", { distance: 8, from: -4 }],
    ["walk", { from: -1.5, distance: 3 }],
    ["walk", { duration: 0.4 }],
    ["walk", { duration: 9 }],
    ["run", {}],
    ["run", { distance: 0.5 }],
    ["run", { distance: 8, from: -4 }],
    ["run", { from: -1.5, distance: 3 }],
    ["run", { duration: 0.3 }],
    ["run", { duration: 9 }],
    ["cheer", {}],
    ["cheer", { times: 1 }],
    ["cheer", { times: 5 }],
    ["cheer", { duration: 0.4 }],
    ["cheer", { duration: 6 }],
    ["point", {}],
    ["point", { to: { x: 0.2, y: 2.2 } }],
    ["point", { to: { x: 0.3, y: 0 } }],
    ["point", { to: { x: -1, y: 1 } }],
    ["point", { to: { x: 3, y: 0.76 }, from: 2, hold: 0 }],
    ["point", { hold: 10 }],
    ["point", { duration: 0.3 }],
    ["point", { duration: 6 }],
    ["think", {}],
    ["think", { ponder: 0.4 }],
    ["think", { ponder: 10 }],
    ["think", { duration: 0.4 }],
    ["think", { duration: 8 }],
  ] as const)("keeps every joint within its limits: %s %j", (name, options) => {
    expect(faultsInEveryMood(name, options)).toEqual([]);
  });

  it.each([
    // #27
    ["pickUp", {}],
    ["pickUp", { where: { x: 0.2, y: 0 }, grip: { x: 0, y: 0 } }],
    ["pickUp", { where: { x: 0.45, y: 0.5 }, grip: { x: -0.1, y: 0.02 } }],
    ["pickUp", { from: 2 }],
    ["pickUp", { duration: 0.4 }],
    ["pickUp", { duration: 6 }],
    ["push", {}],
    ["push", { tries: 1 }],
    ["push", { tries: 6 }],
    ["push", { distance: 0.15 }],
    // The furthest push at its own pace is some seven hundred frames; this is as many steps.
    ["push", { distance: 8, from: -4, tries: 1, duration: 8 }],
    [
      "push",
      { distance: 1, from: -1.5, where: { x: 0.5, y: 0 }, grip: { x: -0.18, y: 0.2 } },
    ],
    ["push", { by: "lever", where: { x: 1.66, y: 0 }, grip: { x: -1.41, y: 0.49 } }],
    [
      "push",
      {
        by: "lever",
        distance: 0.15,
        from: 2,
        where: { x: 1.2, y: 0 },
        grip: { x: -0.9, y: 0.6 },
        press: { x: -0.1, y: -0.5 },
      },
    ],
    ["push", { duration: 0.5 }],
    ["push", { duration: 9 }],
    ["push", { distance: 0.6, duration: 0.6 }],
    ["push", { distance: 0.6, duration: 12 }],
    ["carry", {}],
    ["carry", { distance: 0.3 }],
    ["carry", { distance: 8, from: -4 }],
    ["carry", { grip: { x: 0, y: 0 }, from: -1.5, distance: 3 }],
    ["carry", { by: "cart" }],
    ["carry", { by: "cart", distance: 8, from: -4 }],
    [
      "carry",
      {
        by: "cart",
        distance: 0.3,
        deck: { x: 0.5, y: 0.4 },
        handle: { x: 0.2, y: 0.6 },
      },
    ],
    ["carry", { duration: 0.5 }],
    ["carry", { duration: 9 }],
    ["carry", { by: "cart", duration: 0.8 }],
    ["carry", { by: "cart", duration: 12 }],
  ] as const)(
    "keeps every joint within its limits: %s %j",
    // The longest carry is some seven hundred frames of over a thousand segments,
    // fourteen times, alone and over a stand.
    { timeout: 30_000 },
    (name, options) => {
      expect(faultsInEveryMood(name, options)).toEqual([]);
    },
  );

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
          const span = loosely(actor)(name, withProp(name, stage.row(0), options));
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

  /** The skeleton of the first actor at the last frame of `built`. */
  function lastSkeleton(built: Scene): Skeleton {
    const track = built.timeline.rows[0]?.tracks.find(({ kind }) => kind === "actor");
    const last = lastFrameOf(built.timeline);
    if (track === undefined || last === undefined) {
      throw new Error("no actor, or no length");
    }
    return forwardKinematics(poseAtFrame(built.timeline, 0, track, last));
  }

  /** Both feet flat on the ground, within `near` of `x`. */
  function expectFeetAt(skeleton: Skeleton, x: number, near: number): void {
    for (const side of ["L", "R"] as const) {
      expect(Math.abs(skeleton[`ankle${side}`].x - x)).toBeLessThan(near);
      expect(skeleton[`ankle${side}`].y).toBeCloseTo(0, 6);
      expect(skeleton[`toe${side}`].y).toBeCloseTo(0, 2);
    }
  }

  it("sits down where a walk ended, given from, on a box placed behind it", () => {
    // Two rows, so the row is wide enough for the walk.
    const built = scene({ rows: 2 }, (wide) => {
      const stage = wide.row(0);
      stage.prop("box").place({ x: 1 - 0.24, y: 0 });
      const actor = stage.actor();
      actor.do("walk", { distance: 1 });
      actor.do("sitDown", { from: 1 });
      actor.wait(0.3);
    });
    expect(built.findings).toEqual([]);
    expect(checkScene(built).findings).toEqual([]);
    const seated = lastSkeleton(built);
    expect(seated.pelvis.x).toBeCloseTo(1 - 0.24, 6);
    expect(seated.pelvis.y).toBeCloseTo(0.26 + 0.015, 6);
    expectFeetAt(seated, 1, 0.05);
  });

  it("throws from where a walk ended, given from, and ends standing there", () => {
    const built = scene({ rows: 2 }, (wide) => {
      const stage = wide.row(0);
      const ball = stage.prop("ball");
      const actor = stage.actor();
      actor.do("walk", { distance: 1 });
      actor.do("throw", { ball, from: 1, to: { x: 1.6, y: 0 }, bounce: false });
      actor.wait(0.3);
    });
    expect(built.findings).toEqual([]);
    expect(checkScene(built).findings).toEqual([]);
    const standing = lastSkeleton(built);
    expect(standing.pelvis.x).toBeCloseTo(1, 6);
    expect(standing.pelvis.y).toBeCloseTo(0.48, 6);
    expectFeetAt(standing, 1, 1e-6);
  });

  it("makes a dejected throw from elsewhere fall short of to, on its way there", () => {
    const flight = segmentsOf(
      alone("throw", { from: 2, to: { x: 3, y: 0 }, bounce: false, mood: "dejected" }),
      "prop",
    ).at(-1);
    expect((flight as { data: { x: number } }).data.x).toBeCloseTo(2.55, 10);
  });
});

describe("a call over a stand without a duration", () => {
  /** The actor's pose at the last frame of `built`. */
  function lastPose(built: Scene): Pose {
    expect(built.findings).toEqual([]);
    const track = built.timeline.rows[0]?.tracks.find(({ kind }) => kind === "actor");
    const last = lastFrameOf(built.timeline);
    if (track === undefined || last === undefined) {
      throw new Error("no actor, or no length");
    }
    return poseAtFrame(built.timeline, 0, track, last);
  }

  /** The channels the poses and reaches of `built`'s actor name. */
  function namedChannels(built: Scene): (keyof Pose)[] {
    const chains: Readonly<Record<string, readonly string[]>> = {
      handL: ["shoulderL", "elbowL"],
      handR: ["shoulderR", "elbowR"],
      footL: ["hipL", "kneeL"],
      footR: ["hipR", "kneeR"],
    };
    const names = segmentsOf(built, "actor").flatMap((segment) => {
      const { data } = segment as { data: { channels?: object; effector?: string } };
      return [
        ...Object.keys(data.channels ?? {}),
        ...(chains[data.effector ?? ""] ?? []),
      ];
    });
    return [...new Set(names)] as (keyof Pose)[];
  }

  it.each(["sitDown", "think", "slump"] as const)(
    "ends %s started inside the stand at the pose it ends at alone",
    (name) => {
      let end = Number.NaN;
      const alone = scene((stage) => {
        const actor = stage.actor();
        end = actor.do(name, { at: 0.5 }).end;
        actor.wait(1.5);
      });
      const over = scene({ duration: end + 1.5 }, (stage) => {
        const actor = stage.actor();
        actor.do("stand");
        actor.do(name, { at: 0.5 });
      });
      const [expected, pose] = [lastPose(alone), lastPose(over)];
      const names = namedChannels(alone);
      expect(names.length).toBeGreaterThan(4);
      for (const channel of names) {
        expect([channel, pose[channel]]).toEqual([channel, expected[channel]]);
      }
    },
  );

  it("keeps a plain pose started inside the stand", () => {
    const over = scene({ duration: 4 }, (stage) => {
      const actor = stage.actor();
      actor.do("stand");
      actor.pose({ shoulderR: 2.5, elbowR: 0.4 }, { at: 0.5 });
    });
    expect(lastPose(over)).toMatchObject({ shoulderR: 2.5, elbowR: 0.4 });
  });

  it("stands back up from a sitDown, breathing, when stand is called again", () => {
    const built = scene({ duration: 12 }, (stage) => {
      const actor = stage.actor();
      actor.do("stand");
      const sat = actor.do("sitDown", { at: 0.5 });
      actor.do("stand", { at: sat.end + 0.5 });
    });
    expect(built.findings).toEqual([]);
    const track = built.timeline.rows[0]?.tracks.find(({ kind }) => kind === "actor");
    if (track === undefined) {
      throw new Error("no actor");
    }
    // The last seven seconds: two of the 3.4 s breaths, long after the stance arrived.
    const posed = Array.from({ length: 211 }, (_, index) =>
      poseAtFrame(built.timeline, 0, track, 150 + index),
    );
    const chests = posed.map(({ chest }) => chest);
    // One stand's breath, not two added up: the chest rises 0.09 rad.
    expect(Math.max(...chests) - Math.min(...chests)).toBeCloseTo(0.09, 3);
    for (const pose of posed) {
      expect(pose).toMatchObject({ pelvisY: 0, hipL: 0, hipR: 0, kneeL: 0, kneeR: 0 });
    }
  });
});

describe("the six solo actions", () => {
  const SOLO = ["stand", "walk", "run", "cheer", "point", "think"] as const;

  /** The actor of row `row`, posed at every frame of `built`. */
  function frames(built: Scene, row = 0): { pose: Pose; skeleton: Skeleton }[] {
    const track = built.timeline.rows[row]?.tracks.find(({ kind }) => kind === "actor");
    const last = lastFrameOf(built.timeline);
    if (track === undefined || last === undefined) {
      throw new Error("no actor, or no length");
    }
    return Array.from({ length: last + 1 }, (_, frame) => {
      const pose = poseAtFrame(built.timeline, row, track, frame);
      return { pose, skeleton: forwardKinematics(pose) };
    });
  }

  /** One row per solo action, each written with names alone, over a stand in row 0. */
  function depthOne(stage: Stage): void {
    const idle = stage.row(0).actor();
    idle.do("stand", { mood: "dejected" });
    idle.do("cheer", { at: 1, times: 1, mood: "happy" });
    idle.do("think", { at: 3, ponder: 0.8, mood: "happy" });

    const walker = stage.row(1).actor();
    walker.do("walk", { distance: 0.6, mood: "dejected" });
    walker.do("point", { from: 0.6, to: { x: 2, y: 1.4 }, mood: "angry" });
    walker.do("stand", { duration: 1 });

    const runner = stage.row(2).actor();
    runner.do("run", { from: -1, distance: 2, mood: "surprised" });
    runner.do("think");
    runner.do("cheer");
  }

  // R3
  it("serialise without the lossy marker in a scene written with names", () => {
    const built = scene({ rows: 3 }, depthOne);
    expect(built.findings).toEqual([]);
    expect(errors(checkScene(built).findings)).toEqual([]);
    const text = serializeTimeline(built.timeline);
    expect(text.startsWith('{"version":1,"lossy":false,')).toBe(true);
    expect(text).not.toContain("$omitted");
    const parsed = parseTimeline(text);
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    expect(parsed.document.timeline).toEqual(built.timeline);
    const again = { ...built, timeline: parsed.document.timeline };
    for (const frame of [0, 20, 45, 70, 110]) {
      expect(record(again, frame)).toBe(record(built, frame));
    }
  });

  // R4
  it("does not let a stand without a duration extend the scene past a walk in another row", () => {
    let walked = Number.NaN;
    const built = scene({ rows: 2 }, (stage) => {
      const stood = stage.row(0).actor().do("stand");
      expect(stood).toMatchObject({ start: 0, end: Infinity, duration: Infinity });
      walked = stage.row(1).actor().do("walk").end;
    });
    expect(built.findings).toEqual([]);
    const { fps } = built.timeline;
    // Not a whole number of frames, so the scene's last frame is the next one up.
    expect(Number.isInteger(walked * fps)).toBe(false);
    expect(lastFrameOf(built.timeline)).toBe(Math.ceil(walked * fps));
    expect(segmentsOf(built, "actor", 0)).toEqual([
      expect.objectContaining({ start: 0, end: null }),
      expect.objectContaining({ start: 0, end: null }),
    ]);
  });

  it("plays a point after a walk when neither is given a time", () => {
    scene((stage) => {
      const actor = stage.actor();
      const walk = actor.do("walk");
      const point = actor.do("point", { from: 0.9 });
      expect(walk.start).toBe(0);
      expect(point.start).toBe(walk.end);
      expect(point.marks.aimed).toBeGreaterThan(point.start);
      expect(point.marks.aimed).toBeLessThan(point.end);
    });
  });

  it("is the open-ended-only error when a stand is alone, and valid in a scene with a duration", () => {
    const alone = scene((stage) => {
      stage.actor().do("stand");
    });
    expect(alone.findings.map(({ code, severity }) => [code, severity])).toEqual([
      ["ERR_SCENE_NO_DURATION", "error"],
    ]);
    const timed = scene({ duration: 3 }, (stage) => {
      stage.actor().do("stand");
    });
    expect(timed.findings).toEqual([]);
    expect(checkScene(timed).findings).toEqual([]);
    expect(lastFrameOf(timed.timeline)).toBe(90);
  });

  it("reports a cheer in the mood happyy as an unknown expression, nearest happy", () => {
    const built = scene((stage) => {
      loosely(stage.actor())("cheer", { at: 1, mood: "happyy" });
    });
    expect(built.findings).toHaveLength(1);
    expect(built.findings[0]).toMatchObject({
      code: "ERR_SCENE_UNKNOWN_EXPRESSION",
      severity: "error",
      nearest: ["happy"],
    });
  });

  it("breathes and blinks on a loop that comes round without a jump", () => {
    const built = scene({ duration: 24 }, (stage) => {
      stage.actor().do("stand");
    });
    const posed = frames(built).map(({ pose }) => pose);
    const chests = posed.map(({ chest }) => chest);
    expect(Math.max(...chests) - Math.min(...chests)).toBeGreaterThan(0.05);
    // The breath's period is 3.4 s: 102 frames.
    expect(posed[30 + 102]?.chest).toBeCloseTo(posed[30]?.chest ?? Number.NaN, 12);
    const shut = posed.flatMap(({ eyeOpen }, frame) => (eyeOpen <= 0 ? [frame] : []));
    expect(shut.length).toBeGreaterThan(4);
    expect(posed.filter(({ eyeOpen }) => eyeOpen === 1).length).toBeGreaterThan(600);
    for (let frame = 13; frame < posed.length; frame += 1) {
      const [before, now] = [posed[frame - 1], posed[frame]];
      // Once the stance has blended in, nothing of the body moves fast, loop points included.
      expect(Math.abs((now?.chest ?? 0) - (before?.chest ?? 0))).toBeLessThan(0.01);
      expect(Math.abs((now?.neck ?? 0) - (before?.neck ?? 0))).toBeLessThan(0.01);
    }
  });

  it("shuts the eyes of any mood when a stand blinks", () => {
    for (const mood of ["surprised", "dejected"] as const) {
      const built = scene({ duration: 2 }, (stage) => {
        stage.actor().do("stand", { mood });
      });
      // 1.2 s into the stand is the first blink: frame 36.
      expect(frames(built)[36]?.pose.eyeOpen).toBeLessThanOrEqual(0);
    }
  });

  it.each([
    ["walk", {}],
    ["walk", { mood: "dejected" }],
    ["walk", { mood: "happy" }],
    ["run", {}],
    ["run", { mood: "surprised" }],
    ["run", { mood: "dejected" }],
  ] as const)(
    "keeps a foot where it is planted, on the ground: %s %j",
    (name, options) => {
      const built = scene({ fps: 60 }, (stage) => {
        const actor = stage.actor();
        actor.do(name, { from: -0.9, distance: 1.8, ...options });
        actor.wait(0.2);
      });
      const posed = frames(built).map(({ skeleton }) => skeleton);
      let planted = 0;
      for (let frame = 1; frame < posed.length; frame += 1) {
        for (const side of ["L", "R"] as const) {
          const [before, now] = [
            posed[frame - 1]?.[`ankle${side}`],
            posed[frame]?.[`ankle${side}`],
          ];
          if (before === undefined || now === undefined) {
            throw new Error("no ankle");
          }
          // Never under the ground by more than a third of the line's width.
          expect(now.y).toBeGreaterThan(-0.008);
          expect(posed[frame]?.[`toe${side}`].y).toBeGreaterThan(-0.03);
          // On its spot: a reach that is met puts the ankle on the ground exactly.
          if (Math.abs(before.y) < 1e-9 && Math.abs(now.y) < 1e-9) {
            planted += 1;
            expect(Math.abs(now.x - before.x)).toBeLessThan(1e-6);
          }
        }
      }
      expect(planted).toBeGreaterThan(posed.length / 2);
      expect(posed.at(-1)?.pelvis.x).toBeCloseTo(0.9, 10);
      expect(posed.at(-1)?.ankleL.x).toBeCloseTo(0.9, 10);
      expect(posed.at(-1)?.ankleR.x).toBeCloseTo(0.9, 10);
    },
  );

  it("moves the hips at a steady speed between an eased start and stop", () => {
    const built = scene({ fps: 60 }, (stage) => {
      stage.actor().do("walk", { from: -2, distance: 4 });
    });
    const xs = frames(built).map(({ skeleton }) => skeleton.pelvis.x);
    const steps = xs.slice(1).map((x, i) => x - (xs[i] ?? 0));
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
    // The middle third of the way, where the walk is neither starting nor stopping.
    const cruise = steps.slice(
      Math.floor(steps.length / 3),
      Math.ceil((2 * steps.length) / 3),
    );
    expect(Math.max(...cruise) / Math.min(...cruise)).toBeLessThan(1.15);
  });

  it("runs well over twice as fast as it walks, off the ground between strides", () => {
    const gone = (name: "walk" | "run"): { seconds: number; airborne: number } => {
      let seconds = Number.NaN;
      const built = scene({ fps: 60 }, (stage) => {
        seconds = stage.actor().do(name, { from: -2, distance: 4 }).duration;
      });
      const airborne = frames(built).filter(
        ({ skeleton }) => skeleton.ankleL.y > 0.01 && skeleton.ankleR.y > 0.01,
      ).length;
      return { seconds, airborne };
    };
    const [walk, run] = [gone("walk"), gone("run")];
    expect(walk.seconds / run.seconds).toBeGreaterThan(2);
    expect(walk.airborne).toBe(0);
    expect(run.airborne).toBeGreaterThan(20);
  });

  it("takes a second walk on from where the first one ended", () => {
    const built = scene({ fps: 60 }, (stage) => {
      const actor = stage.actor();
      actor.do("walk", { from: -1, distance: 0.6 });
      actor.do("stand", { duration: 0.5 });
      actor.do("run", { from: -0.4, distance: 1 });
    });
    expect(built.findings).toEqual([]);
    const xs = frames(built).map(({ skeleton }) => skeleton.pelvis.x);
    expect(xs[0]).toBe(-1);
    expect(xs.at(-1)).toBeCloseTo(0.6, 10);
    // No step back, and no jump: the fastest frame is a run's.
    for (let frame = 1; frame < xs.length; frame += 1) {
      const step = (xs[frame] ?? 0) - (xs[frame - 1] ?? 0);
      expect(step).toBeGreaterThan(-1e-9);
      expect(step).toBeLessThan(0.05);
    }
  });

  it.each([
    [{}],
    [{ to: { x: 0.4, y: 2 } }],
    [{ to: { x: 0.6, y: 0.1 } }],
    [{ to: { x: 2, y: 1.2 }, from: 0.8 }],
    [{ mood: "angry" }],
    [{ mood: "surprised" }],
  ] as const)("aims the straight near arm at its target: point %j", (options) => {
    let aimed = Number.NaN;
    const built = scene({ fps: 100 }, (stage) => {
      const actor = stage.actor();
      actor.pose({ pelvisX: "from" in options ? options.from : 0 }, { blend: 0 });
      aimed = actor.do("point", { hold: 1, ...options }).marks.aimed;
    });
    // Half a second into the hold, when the lean has settled.
    const at = frames(built)[Math.round((aimed + 0.5) * 100)];
    if (at === undefined) {
      throw new Error("no frame");
    }
    const to = "to" in options ? options.to : { x: 1, y: 0.95 };
    const { shoulders, handR } = at.skeleton;
    const arm = Math.atan2(handR.y - shoulders.y, handR.x - shoulders.x);
    const target = Math.atan2(to.y - shoulders.y, to.x - shoulders.x);
    expect(arm).toBeCloseTo(target, 2);
    expect(at.pose.elbowR).toBe(0);
    // The feet have not moved under the lean.
    expect(at.skeleton.ankleR.x).toBeCloseTo(at.skeleton.pelvis.x, 10);
    expect(at.skeleton.ankleR.y).toBeCloseTo(0, 10);
  });

  it("brings the near hand to the chin with the head tilted, and keeps it there", () => {
    const built = scene({ fps: 100 }, (stage) => {
      const actor = stage.actor();
      actor.do("think");
      actor.wait(1);
    });
    const posed = frames(built);
    for (const frame of [80, 150, posed.length - 1]) {
      const at = posed[frame];
      if (at === undefined) {
        throw new Error("no frame");
      }
      const { handR, headCentre } = at.skeleton;
      const reach = Math.hypot(handR.x - headCentre.x, handR.y - headCentre.y);
      // On the head's lower front edge: the head is 0.09 in radius.
      expect(reach).toBeGreaterThan(0.07);
      expect(reach).toBeLessThan(0.12);
      expect(handR.x).toBeGreaterThan(headCentre.x);
      expect(handR.y).toBeLessThan(headCentre.y);
      expect(Math.abs(at.pose.neck)).toBeGreaterThan(0.1);
    }
  });

  it("throws both hands above the head at a cheer's up mark, and jumps when happy", () => {
    const cheering = (mood?: "happy"): { up: Skeleton; highest: number } => {
      let up = Number.NaN;
      const built = scene({ fps: 100 }, (stage) => {
        up = stage.actor().do("cheer", mood === undefined ? {} : { mood }).marks.up;
      });
      const posed = frames(built);
      const at = posed[Math.round(up * 100)];
      if (at === undefined) {
        throw new Error("no frame");
      }
      return {
        up: at.skeleton,
        highest: Math.max(...posed.map(({ skeleton }) => skeleton.ankleR.y)),
      };
    };
    const plain = cheering();
    expect(plain.up.handL.y).toBeGreaterThan(plain.up.headTop.y);
    expect(plain.up.handR.y).toBeGreaterThan(plain.up.headCentre.y);
    // The two arms apart, so they read as a V and not as one line.
    expect(plain.up.handR.x - plain.up.handL.x).toBeGreaterThan(0.15);
    expect(plain.highest).toBeLessThan(0.01);
    expect(cheering("happy").highest).toBeGreaterThan(0.1);
  });

  it.each(SOLO)("ends %s where the next action can start from", (name) => {
    const built = scene({ fps: 100 }, (stage) => {
      const actor = stage.actor();
      loosely(actor)(name, name === "stand" ? { duration: 1 } : {});
      actor.wait(0.5);
    });
    const { pose, skeleton } = frames(built).at(-1) ?? {};
    if (pose === undefined || skeleton === undefined) {
      throw new Error("no frame");
    }
    // Both feet flat on the ground under the hips, the legs straight.
    expect(skeleton.ankleL.y).toBeCloseTo(0, 6);
    expect(skeleton.ankleR.y).toBeCloseTo(0, 6);
    expect(skeleton.toeR.y).toBeCloseTo(0, 6);
    expect(skeleton.ankleR.x).toBeCloseTo(skeleton.pelvis.x, 6);
    expect(pose.pelvisY).toBeCloseTo(0, 6);
  });
});

describe("the three actions that move a prop", () => {
  interface Sampled {
    /** Where the prop's ground point is. */
    readonly prop: { readonly x: number; readonly y: number };
    readonly skeleton: Skeleton;
  }

  /** Row 0's first prop and its actor at every frame of `built`. */
  function frames(built: Scene): Sampled[] {
    const tracks = built.timeline.rows[0]?.tracks ?? [];
    const actor = tracks.find(({ kind }) => kind === "actor");
    const prop = tracks.find(({ kind }) => kind === "prop");
    const last = lastFrameOf(built.timeline);
    if (actor === undefined || prop === undefined || last === undefined) {
      throw new Error("no actor, no prop, or no length");
    }
    return Array.from({ length: last + 1 }, (_, frame) => {
      const placed = propPlacement(built.timeline, 0, prop, frame);
      if (placed === undefined) {
        throw new Error("the prop is not shown");
      }
      return {
        prop: placed.point,
        skeleton: forwardKinematics(poseAtFrame(built.timeline, 0, actor, frame)),
      };
    });
  }

  const frameAt = (seconds: number): number => Math.round(seconds * 30);

  // Example: normal
  it("leaves the box where it stands until pickUp's grip, then keeps it on handR", () => {
    let span: Span<"grip" | "up"> | undefined;
    const built = scene((stage) => {
      const box = stage.prop("box");
      box.place({ x: 0.36, y: 0 });
      const actor = stage.actor();
      actor.wait(0.5);
      span = actor.do("pickUp", { prop: box });
      actor.wait(0.5);
    });
    expect(built.findings).toEqual([]);
    expect(errors(checkScene(built).findings)).toEqual([]);
    if (span === undefined) {
      throw new Error("no span");
    }
    expect(span.marks.grip).toBeGreaterThan(span.start);
    expect(span.marks.up).toBeGreaterThan(span.marks.grip);
    expect(span.marks.up).toBeLessThan(span.end);
    const sampled = frames(built);
    const gripped = frameAt(span.marks.grip);
    sampled.forEach(({ prop, skeleton }, frame) => {
      if (frame <= gripped) {
        expect(prop).toEqual({ x: 0.36, y: 0 });
      } else {
        // R1: the grip is 0.18 behind the box's ground point and 0.08 above it.
        expect(prop.x).toBeCloseTo(skeleton.handR.x + 0.18, 10);
        expect(prop.y).toBeCloseTo(skeleton.handR.y - 0.08, 10);
      }
    });
    // The hands are on the grip when they take hold, so the box does not jump.
    expect(sampled[gripped + 1]?.prop.x).toBeCloseTo(0.36, 1);
    expect(sampled[gripped + 1]?.prop.y).toBeCloseTo(0, 1);
    expect(sampled.at(-1)?.prop.y).toBeGreaterThan(0.4);
    // R2
    expect(serializeTimeline(built.timeline)).toContain('"lossy":false');
    expect(segmentsOf(built, "prop").at(-1)).toMatchObject({
      start: Math.round(span.marks.grip * 1e6),
      end: null,
      data: { kind: "hold", effector: "handR", offset: { x: 0.18, y: -0.08 } },
    });
  });

  // Example: boundary
  it("leaves the rock's track alone in a push that gets nowhere, while the body strains", () => {
    const pushed = (options: object): Scene =>
      scene((stage) => {
        const rock = stage.prop("rock");
        rock.place({ x: 0.6, y: 0 });
        const actor = stage.actor();
        actor.do("push", { prop: rock, ...options });
        actor.wait(0.3);
      });
    const built = pushed({});
    expect(built.findings).toEqual([]);
    expect(segmentsOf(built, "prop")).toHaveLength(2);
    expect(segmentsOf(built, "prop").at(-1)).toMatchObject({
      start: 0,
      end: null,
      data: { kind: "place", x: 0.6, y: 0 },
    });
    const sampled = frames(built);
    for (const { prop } of sampled) {
      expect(prop).toEqual({ x: 0.6, y: 0 });
    }
    const hips = sampled.map(({ skeleton }) => skeleton.pelvis);
    expect(Math.min(...hips.map(({ y }) => y))).toBeLessThan(0.4);
    expect(Math.max(...hips.map(({ x }) => x))).toBeGreaterThan(0);
    expect(hips.at(-1)?.x).toBeCloseTo(0, 10);
    expect(hips.at(-1)?.y).toBeCloseTo(0.48, 10);
    // More tries strain for longer; the rock still does not move.
    expect(lastFrameOf(pushed({ tries: 4 }).timeline)).toBeGreaterThan(sampled.length);
    expect(segmentsOf(pushed({ tries: 4 }), "prop")).toHaveLength(2);
  });

  it("keeps the hands on the rock's face while a push moves it, at a constant speed between heave and stop", () => {
    let span: Span<"contact" | "heave" | "stop"> | undefined;
    const built = scene((stage) => {
      const rock = stage.prop("rock");
      rock.place({ x: -0.4, y: 0 });
      const actor = stage.actor();
      actor.do("walk", { from: -2, distance: 1 });
      span = actor.do("push", { prop: rock, from: -1, distance: 1.2 });
      actor.wait(0.3);
    });
    expect(built.findings).toEqual([]);
    expect(errors(checkScene(built).findings)).toEqual([]);
    if (span === undefined) {
      throw new Error("no span");
    }
    const { contact, heave, stop } = span.marks;
    expect(contact).toBeGreaterThan(span.start);
    expect(heave).toBeGreaterThan(contact);
    expect(stop).toBeGreaterThan(heave);
    expect(stop).toBeLessThan(span.end);
    // R2
    expect(serializeTimeline(built.timeline)).toContain('"lossy":false');
    expect(segmentsOf(built, "prop").at(-1)).toMatchObject({
      start: Math.round(heave * 1e6),
      end: Math.round(stop * 1e6),
      data: { kind: "move", y: 0, arc: 0 },
    });
    const sampled = frames(built);
    expect(sampled.at(-1)?.prop.x).toBeCloseTo(0.8, 10);
    expect(sampled.at(-1)?.skeleton.pelvis.x).toBeCloseTo(0.2, 10);
    for (let frame = frameAt(contact) + 1; frame < frameAt(stop); frame += 1) {
      const at = sampled[frame];
      // The default grip: 0.22 behind the rock's ground point, 0.42 up. The hands
      // follow in short eased reaches and the body starts to straighten as it
      // arrives, so they keep to it within a hundredth and a half.
      const face = (at?.prop.x ?? 0) - 0.22;
      expect(Math.abs((at?.skeleton.handR.x ?? 0) - face)).toBeLessThan(0.015);
      expect(Math.abs((at?.skeleton.handR.y ?? 0) - 0.42)).toBeLessThan(0.01);
      expect(at?.skeleton.handL).toEqual(at?.skeleton.handR);
      expect(at?.prop.y).toBe(0);
    }
    const first = frameAt(heave) + 1;
    const speed = 1.2 / (stop - heave) / 30;
    for (let frame = first + 1; frame < frameAt(stop); frame += 1) {
      expect(
        (sampled[frame]?.prop.x ?? 0) - (sampled[frame - 1]?.prop.x ?? 0),
      ).toBeCloseTo(speed, 10);
    }
  });

  it("bears down on a lever's handle end while the rock shifts, from heave to stop", () => {
    let span: Span<"contact" | "heave" | "stop"> | undefined;
    const built = scene({ rows: 3 }, (wide) => {
      const stage = wide.row(0);
      const rock = stage.prop("rock");
      rock.place({ x: 1.66, y: 0 });
      const actor = stage.actor();
      span = actor.do("push", {
        prop: rock,
        by: "lever",
        distance: 0.15,
        where: { x: 1.66, y: 0 },
        grip: { x: -1.41, y: 0.49 },
      });
      // The scene swings the lever over the same times: its handle end is the grip.
      stage
        .prop("lever", {
          swing: -0.3,
          swingAt: span.marks.heave,
          swingFor: span.marks.stop - span.marks.heave,
        })
        .place({ x: 1.08, y: 0 });
      actor.wait(0.3);
    });
    expect(built.findings).toEqual([]);
    expect(checkScene(built).findings).toEqual([]);
    if (span === undefined) {
      throw new Error("no span");
    }
    const sampled = frames(built);
    const { heave, stop } = span.marks;
    expect(sampled[Math.floor(heave * 30)]?.prop).toEqual({ x: 1.66, y: 0 });
    expect(sampled.at(-1)?.prop.x).toBeCloseTo(1.81, 10);
    expect(sampled.at(-1)?.prop.y).toBe(0);
    expect(sampled[Math.floor(heave * 30)]?.skeleton.handR.x).toBeCloseTo(0.25, 2);
    expect(sampled[Math.floor(heave * 30)]?.skeleton.handR.y).toBeCloseTo(0.49, 2);
    // The default press: where a default lever's handle end is after a swing of -0.3.
    expect(sampled.at(-1)?.skeleton.handR.x).toBeCloseTo(0.25 - 0.07, 2);
    expect(sampled.at(-1)?.skeleton.handR.y).toBeCloseTo(0.49 - 0.26, 2);
    // The feet do not leave where the actor stood.
    expect(sampled.at(-1)?.skeleton.pelvis.x).toBeLessThan(0.05);
    expect(serializeTimeline(built.timeline)).toContain('"lossy":false');
    expect(stop).toBeGreaterThan(heave);
  });

  it("carries a prop in the arms on handR the whole way, from where a walk ended", () => {
    let span: Span<"loaded" | "off" | "stop"> | undefined;
    const built = scene((stage) => {
      const box = stage.prop("box");
      box.place({ x: -0.64, y: 0 });
      const actor = stage.actor();
      actor.do("walk", { from: -1.9, distance: 0.9 });
      const picked = actor.do("pickUp", { prop: box, from: -1 });
      span = actor.do("carry", { prop: box, from: -1, distance: 1.5 });
      expect(span.start).toBe(picked.end);
      actor.wait(0.3);
    });
    expect(built.findings).toEqual([]);
    expect(errors(checkScene(built).findings)).toEqual([]);
    if (span === undefined) {
      throw new Error("no span");
    }
    expect(span.marks.loaded).toBe(span.start);
    expect(span.marks.off).toBeGreaterThan(span.start);
    expect(span.marks.stop).toBeGreaterThan(span.marks.off);
    const sampled = frames(built);
    // R1
    for (let frame = frameAt(span.start) + 1; frame < sampled.length; frame += 1) {
      const at = sampled[frame];
      expect(at?.prop.x).toBeCloseTo((at?.skeleton.handR.x ?? 0) + 0.18, 10);
      expect(at?.prop.y).toBeCloseTo((at?.skeleton.handR.y ?? 0) - 0.08, 10);
    }
    // The box does not jump as the carry takes it over from the pickUp.
    const [before, after] = [
      sampled[frameAt(span.start) - 1],
      sampled[frameAt(span.start)],
    ];
    expect(after?.prop.x).toBeCloseTo(before?.prop.x ?? 0, 2);
    expect(after?.prop.y).toBeCloseTo(before?.prop.y ?? 0, 2);
    expect(sampled.at(-1)?.skeleton.pelvis.x).toBeCloseTo(0.5, 10);
    expect(sampled.at(-1)?.skeleton.ankleR.x).toBeCloseTo(0.5, 6);
    expect(serializeTimeline(built.timeline)).toContain('"lossy":false');
  });

  it.each([
    ["no mood", {}],
    ["the mood dejected", { mood: "dejected" as const }],
  ])("hands the box from a pickUp in %s to a carry without a jump", (_label, mood) => {
    let start = 0;
    const built = scene((stage) => {
      const box = stage.prop("box");
      box.place({ x: 0.36, y: 0 });
      const actor = stage.actor();
      actor.do("pickUp", { prop: box, ...mood });
      start = actor.do("carry", { prop: box, distance: 0.6 }).start;
      actor.wait(0.3);
    });
    const sampled = frames(built);
    const [before, after] = [sampled[frameAt(start) - 1], sampled[frameAt(start)]];
    expect(after?.prop.x).toBeCloseTo(before?.prop.x ?? 0, 2);
    expect(after?.skeleton.pelvis.x).toBeCloseTo(before?.skeleton.pelvis.x ?? 0, 2);
  });

  it("loads a prop on a cart and walks off behind it, the load and the hands keeping to the cart", () => {
    let span: Span<"loaded" | "off" | "stop"> | undefined;
    const built = scene({ rows: 2 }, (stage) => {
      const row = stage.row(0);
      const rock = row.prop("rock", { size: 0.4 });
      const actor = row.actor();
      span = actor.do("carry", { prop: rock, by: "cart", distance: 2, from: -2 });
      const travel = { at: span.marks.off, duration: span.marks.stop - span.marks.off };
      const cart = row.prop("cart", {
        roll: 2,
        rollAt: travel.at,
        rollFor: travel.duration,
      });
      cart.place({ x: -1.13, y: 0 });
      cart.move({ x: 0.87, y: 0 }, travel);
      actor.wait(0.3);
    });
    expect(built.findings).toEqual([]);
    expect(checkScene(built).findings).toEqual([]);
    if (span === undefined) {
      throw new Error("no span");
    }
    const { loaded, off, stop } = span.marks;
    expect(loaded).toBeGreaterThan(span.start);
    expect(off).toBeGreaterThan(loaded);
    expect(stop).toBeGreaterThan(off);
    const cartTrack = built.timeline.rows[0]?.tracks.filter(
      ({ kind }) => kind === "prop",
    )[1];
    if (cartTrack === undefined) {
      throw new Error("no cart");
    }
    const sampled = frames(built);
    sampled.forEach(({ prop, skeleton }, frame) => {
      const cart = propPlacement(built.timeline, 0, cartTrack, frame)?.point.x ?? 0;
      if (frame > 0 && frame <= frameAt(loaded) - 7) {
        // R1: until it is let go it is on the hand, by the default grip.
        expect(prop.x).toBeCloseTo(skeleton.handR.x + 0.18, 10);
        expect(prop.y).toBeCloseTo(skeleton.handR.y - 0.08, 10);
      }
      if (frame > frameAt(loaded)) {
        // On the deck, 0.15 behind the cart's middle, wherever the cart is.
        expect(prop.x).toBeCloseTo(cart - 0.15, 10);
        expect(prop.y).toBeCloseTo(0.24, 10);
      }
      if (frame > frameAt(off)) {
        // The handle is 0.59 behind the cart's middle and 0.5 up.
        expect(skeleton.handR.x).toBeCloseTo(cart - 0.59, 2);
        expect(skeleton.handR.y).toBeCloseTo(0.5, 2);
      }
    });
    expect(sampled.at(-1)?.skeleton.pelvis.x).toBeCloseTo(0, 10);
    // R2
    expect(serializeTimeline(built.timeline)).toContain('"lossy":false');
    const [, hold, down, ride, ...rest] = segmentsOf(built, "prop");
    expect(rest).toEqual([]);
    expect(hold).toMatchObject({ start: 0, data: { kind: "hold", effector: "handR" } });
    expect(down).toMatchObject({
      end: Math.round(loaded * 1e6),
      data: { kind: "move", x: -1.28, y: 0.24 },
    });
    expect(ride).toMatchObject({
      start: Math.round(off * 1e6),
      end: Math.round(stop * 1e6),
      data: { kind: "move", x: 0.72, y: 0.24, arc: 0 },
    });
  });

  // R4, and the error example
  it.each([
    ["carry", {}, "ERR_SCENE_MISSING_PARAMETER"],
    ["carry", { distance: 1 }, "ERR_SCENE_MISSING_PARAMETER"],
    ["push", {}, "ERR_SCENE_MISSING_PARAMETER"],
    ["pickUp", {}, "ERR_SCENE_MISSING_PARAMETER"],
    ["pickUp", { prop: 3 }, "ERR_SCENE_INVALID_VALUE"],
    ["push", { prop: "rock" }, "ERR_SCENE_INVALID_VALUE"],
    ["carry", { prop: { id: "row0/prop/box/0" } }, "ERR_SCENE_INVALID_VALUE"],
  ])("does not do %s given %j, and says why", (name, options, code) => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.prop("box");
      loosely(stage.actor())(name, options);
    });
    // An action that is not done sets no mark, which is reported for each one it states.
    const findings = built.findings.filter(
      (finding) => finding.code !== "ERR_SCENE_MISSING_MARK",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code, severity: "error" });
    expect(segmentsOf(built, "actor")).toEqual([
      { start: 0, end: 0, data: { kind: "wait" } },
    ]);
  });

  it("reports a number that is out of range or of the wrong kind beside the prop", () => {
    const built = scene((stage) => {
      const box = stage.prop("box");
      const actor = stage.actor();
      loosely(actor)("carry", { prop: box, distance: 99, by: "wheels" });
      loosely(actor)("pickUp", { prop: box, where: 3 });
    });
    expect(built.findings.map(({ code }) => code)).toEqual([
      "ERR_SCENE_OUT_OF_RANGE",
      "ERR_SCENE_INVALID_VALUE",
      "ERR_SCENE_INVALID_VALUE",
    ]);
  });
});
