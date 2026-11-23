import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkScene, formatReport, type TextBox } from "../src/check/check.js";
import { describeState, formatState } from "../src/check/describe.js";
import { installReadWatch } from "../src/check/reads.js";
import { watchGlobals } from "../src/export/watch.js";
import {
  type Actor,
  checkReport,
  defineBackdrop,
  defineEffect,
  defineProp,
  exitCodeFor,
  type Finding,
  type Scene,
  scene,
  type Stage,
} from "../src/index.js";

const ACTOR = "row0/actor/actor/0";

/** A one-actor scene at 30 fps, three seconds long: frames 0 to 90. */
function act(play: (actor: Actor, stage: Stage) => void): Scene {
  return scene({ duration: 3 }, (stage) => {
    play(stage.actor(), stage);
  });
}

/** A pose of every joint at angles within their limits: a full-body call. */
const FULL_BODY_POSE = {
  pelvis: 0,
  spine: 0.2,
  chest: 0.1,
  neck: 0,
  shoulderL: 0.3,
  shoulderR: 0.3,
  elbowL: 0.2,
  elbowR: 0.2,
  hipL: 1.4,
  hipR: 1.4,
  kneeL: 1.5,
  kneeR: 1.5,
  ankleL: 0,
  ankleR: 0,
};

function codes(findings: readonly Finding[]): string[] {
  return findings.map((finding) => finding.code);
}

describe("joint limits", () => {
  // R1
  it("reports one error for a kneeR below its limit on frames 36 to 44", () => {
    // An added pose with no blend holds its value for exactly its own segment.
    const built = act((a) => {
      a.pose({ kneeR: -0.4 }, { at: 1.2, duration: 0.3, mode: "add", blend: 0 });
    });
    const { findings, truncated } = checkScene(built);
    expect(truncated).toBe(false);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "ERR_CHECK_JOINT_LIMIT",
      severity: "error",
      row: 0,
      target: ACTOR,
      joint: "kneeR",
      time: [1.2, 1.5],
      frames: [36, 44],
      measured: { value: -0.4, min: 0, max: 2.6 },
    });
    expect(findings[0]?.fix).toContain("0..2.6");
    expect(exitCodeFor(findings)).toBe(1);
  });

  it("follows the composed angle: a replacing pose is held until the scene ends", () => {
    const built = act((a) => {
      a.pose({ kneeR: -0.4 }, { at: 1.2, duration: 0.3 });
    });
    const { findings } = checkScene(built);
    expect(codes(findings)).toEqual(["ERR_CHECK_JOINT_LIMIT"]);
    // Frame 36 is the blend's start, where the knee is still at rest.
    expect(findings[0]?.frames).toEqual([37, 90]);
  });

  it.each([
    { label: "exactly at the limit", knee: 2.6, expected: [] },
    { label: "just past the limit", knee: 2.6001, expected: ["ERR_CHECK_JOINT_LIMIT"] },
    { label: "at the lower limit", knee: 0, expected: [] },
  ])("$label gives $expected", ({ knee, expected }) => {
    const built = act((a) => {
      a.pose({ kneeR: knee }, { duration: 1 });
    });
    expect(codes(checkScene(built).findings)).toEqual(expected);
  });

  it("describes the worst frame of a run", () => {
    const built = act((a) => {
      a.pose({ spine: 1.5 }, { duration: 1 });
    });
    const [finding] = checkScene(built).findings;
    expect(finding?.joint).toBe("spine");
    expect(finding?.measured).toEqual({ value: 1.5, min: -0.3, max: 0.9 });
  });

  it("reports two findings for two separate stretches of one joint", () => {
    const options = { duration: 0.1, mode: "add", blend: 0 } as const;
    const built = act((a) => {
      a.pose({ elbowL: -1 }, { ...options, at: 0.5 });
      a.pose({ elbowL: -1 }, { ...options, at: 2 });
    });
    const { findings } = checkScene(built);
    expect(findings.map((finding) => finding.frames)).toEqual([
      [15, 17],
      [60, 62],
    ]);
  });

  it("leaves pelvis unlimited", () => {
    const built = act((a) => {
      a.pose({ pelvis: 6 }, { duration: 1 });
    });
    expect(codes(checkScene(built).findings)).not.toContain("ERR_CHECK_JOINT_LIMIT");
  });

  it("passes a scene that stays within its limits and its frame", () => {
    const built = act((a) => {
      a.pose({ kneeR: 1.6, kneeL: 1.6, hipR: 1.4, hipL: 1.4 }, { duration: 1 });
    });
    const { findings } = checkScene(built);
    expect(findings).toEqual([]);
    expect(formatReport(checkReport(findings))).toBe("0 errors, 0 warnings\n");
    expect(exitCodeFor(findings)).toBe(0);
  });
});

describe("leaving the frame", () => {
  // R2
  it("warns when an actor walks out of its row, which fails only under strict", () => {
    // A 1080 px square with one row shows 2.5 units: x from -1.25 to 1.25.
    const built = act((a) => {
      a.pose({ pelvisX: 3 }, { at: 1, duration: 1 });
    });
    const { findings } = checkScene(built);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "ERR_CHECK_OFF_FRAME",
      severity: "warning",
      row: 0,
      target: ACTOR,
    });
    expect(findings[0]?.frames?.[1]).toBe(90);
    expect(exitCodeFor(findings)).toBe(0);
    expect(exitCodeFor(findings, { strict: true })).toBe(1);
  });

  it("warns when an actor rises past the top of its row", () => {
    const built = act((a) => {
      a.pose({ pelvisY: 1.5 }, { duration: 1 });
    });
    expect(codes(checkScene(built).findings)).toEqual(["ERR_CHECK_OFF_FRAME"]);
  });

  it("uses the row's own width: four rows of a wide canvas show more", () => {
    const built = scene({ rows: 4, width: 1920, duration: 1 }, (stage) => {
      stage.row(2).actor().pose({ pelvisX: 3 }, { duration: 0.5 });
    });
    // 1920 px at 108 px per unit is 17.8 units across.
    expect(checkScene(built).findings).toEqual([]);
  });

  it("warns for a shown prop placed outside its row, from the placement on", () => {
    const ball = defineProp({
      name: "ball",
      description: "A ball.",
      params: {},
      draw: () => undefined,
    });
    const built = scene({ duration: 2 }, (stage) => {
      const prop = stage.prop(ball);
      prop.place({ x: 0.5, y: 0 });
      prop.place({ x: 4, y: 0 }, { at: 1 });
    });
    const { findings } = checkScene(built);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "ERR_CHECK_OFF_FRAME",
      severity: "warning",
      target: "row0/prop/ball/0",
      frames: [30, 60],
    });
  });
});

describe("a prop that is carried or thrown", () => {
  it("warns while a moved prop is outside its row, measured along its path", () => {
    const built = scene({ duration: 2 }, (stage) => {
      // 1080 px wide at 432 px per unit shows 1.25 units either side of the centre.
      stage.prop("ball").move({ x: 2.5, y: 0 }, { duration: 2 });
    });
    const { findings } = checkScene(built);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "ERR_CHECK_OFF_FRAME",
      severity: "warning",
      target: "row0/prop/ball/0",
      frames: [31, 60],
    });
  });

  it("reports a held prop whose holder's motion throws as a failure of the prop too", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor().drive((t) => {
        if (t > 0.5) {
          throw new Error("no");
        }
        return { spine: 0 };
      });
      stage.prop("ball").hold("handR");
    });
    const failed = checkScene(built).findings.filter(
      (finding) => finding.code === "ERR_SCENE_DRAWING_FAILED",
    );
    expect(failed.map((finding) => finding.target)).toEqual([
      "row0/actor/actor/0",
      "row0/prop/ball/0",
    ]);
  });
});

describe("actor over text", () => {
  const box = (over: Partial<TextBox>): TextBox => ({
    id: "row0/label/title/0",
    row: 0,
    x: 0,
    y: 0,
    width: 0.2,
    height: 0.1,
    ...over,
  });
  const standing = act((a) => {
    a.wait(1);
  });

  it.each([
    // A rest figure's head is a circle of radius 0.09 centred at (0, 0.91).
    { label: "a box over the head", at: { x: -0.1, y: 0.85 }, overlaps: true },
    { label: "a box the head's edge reaches", at: { x: 0.08, y: 0.9 }, overlaps: true },
    { label: "a box beside the figure", at: { x: 0.5, y: 0.85 }, overlaps: false },
    { label: "a box above the head", at: { x: -0.1, y: 1.1 }, overlaps: false },
    // The legs run down the line x = 0 from the pelvis at 0.48.
    { label: "a box a leg crosses", at: { x: -0.1, y: 0.2 }, overlaps: true },
    {
      label: "a box in another row",
      at: { x: -0.1, y: 0.85, row: 1 },
      overlaps: false,
    },
  ])("$label: $overlaps", ({ at, overlaps }) => {
    const { findings } = checkScene(standing, { textBoxes: () => [box(at)] });
    expect(codes(findings)).toEqual(overlaps ? ["ERR_CHECK_TEXT_OVERLAP"] : []);
  });

  it("is a warning on the actor, for the frames the box is shown", () => {
    const { findings } = checkScene(standing, {
      textBoxes: (frame) => (frame >= 10 && frame <= 20 ? [box({ y: 0.85 })] : []),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "ERR_CHECK_TEXT_OVERLAP",
      severity: "warning",
      row: 0,
      target: ACTOR,
      frames: [10, 20],
    });
    expect(findings[0]?.message).toContain("row0/label/title/0");
  });
});

describe("clock and random reads", () => {
  let previous: ReturnType<typeof installReadWatch>;
  beforeEach(() => {
    previous = installReadWatch(watchGlobals);
  });
  afterEach(() => {
    installReadWatch(previous);
  });

  // R3
  it.each([
    {
      label: "Math.random",
      read: () => Math.random(),
      code: "ERR_CHECK_UNSEEDED_RANDOM",
    },
    { label: "Date.now", read: () => Date.now(), code: "ERR_CHECK_CLOCK_READ" },
    {
      label: "new Date()",
      read: () => new Date().getTime(),
      code: "ERR_CHECK_CLOCK_READ",
    },
    {
      label: "performance.now",
      read: () => performance.now(),
      code: "ERR_CHECK_CLOCK_READ",
    },
  ])("reports a drive that calls $label once, naming its track", ({ read, code }) => {
    const built = act((a) => {
      a.drive(() => ({ spine: read() * 0 }), { duration: 1 });
    });
    expect(built.findings).toEqual([]);
    const { findings } = checkScene(built);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code,
      severity: "error",
      row: 0,
      target: ACTOR,
      frames: [0, 90],
    });
  });

  it("reports a free drawing that reads the clock, naming its track", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.draw(
        (ctx) => {
          ctx.fillRect(0, 0, Date.now() * 0, 1);
        },
        { at: 0.5, duration: 0.2 },
      );
    });
    const { findings } = checkScene(built);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "ERR_CHECK_CLOCK_READ",
      target: "row0/draw/draw/0",
      frames: [15, 20],
    });
  });

  it("reports a backdrop and an effect that read unseeded randomness, naming each", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.backdrop(
        defineBackdrop({
          name: "noise",
          description: "Reads Math.random.",
          draw(ctx) {
            ctx.rect(Math.random() * 0, 0, 1, 1);
          },
        }),
        { at: 0.5 },
      );
      stage.effect(
        defineEffect({
          name: "flicker",
          description: "Reads the clock.",
          draw(ctx) {
            ctx.rect(Date.now() * 0, 0, 1, 1);
          },
        }),
        { duration: 0.2 },
      );
    });
    const { findings } = checkScene(built);
    expect(findings).toHaveLength(2);
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "ERR_CHECK_UNSEEDED_RANDOM",
        target: "row0/backdrop/noise/0",
        frames: [15, 30],
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "ERR_CHECK_CLOCK_READ",
        target: "row0/effect/flicker/0",
        frames: [0, 5],
      }),
    );
  });

  it("leaves the reads of the actor an effect is on to that actor", () => {
    const built = scene({ duration: 1 }, (stage) => {
      const hero = stage.actor();
      hero.drive(() => ({ spine: Date.now() * 0 }), { duration: 1 });
      stage.effect(
        defineEffect({
          name: "still",
          description: "Reads nothing.",
          draw(ctx) {
            ctx.rect(0, 0, 1, 1);
          },
        }),
        { on: hero },
      );
    });
    const { findings } = checkScene(built);
    expect(findings.map(({ code, target }) => [code, target])).toEqual([
      ["ERR_CHECK_CLOCK_READ", "row0/actor/actor/0"],
    ]);
  });

  it("names the effect too when the actor it is on cannot be posed", () => {
    const built = scene({ duration: 1 }, (stage) => {
      const hero = stage.actor();
      hero.drive(
        (t) => {
          if (t > 0.5) {
            throw new Error("no");
          }
          return { spine: 0 };
        },
        { duration: 1 },
      );
      stage.effect(
        defineEffect({
          name: "still",
          description: "Draws one marker.",
          draw(ctx) {
            ctx.rect(0, 0, 1, 1);
          },
        }),
        { on: hero },
      );
    });
    const { findings } = checkScene(built);
    expect(findings.map(({ code, target }) => [code, target])).toEqual([
      ["ERR_SCENE_DRAWING_FAILED", "row0/actor/actor/0"],
      ["ERR_SCENE_DRAWING_FAILED", "row0/effect/still/0"],
    ]);
  });

  it("reports a prop whose drawing reads unseeded randomness or the clock, naming it", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.prop(
        defineProp({
          name: "dice",
          description: "Reads Math.random.",
          draw(ctx) {
            ctx.rect(Math.random() * 0, 0, 1, 1);
          },
        }),
        { at: 0.5 },
      );
      stage.prop(
        defineProp({
          name: "watch",
          description: "Reads the clock.",
          draw(ctx) {
            ctx.rect(Date.now() * 0, 0, 1, 1);
          },
        }),
        { duration: 0.2 },
      );
    });
    const { findings } = checkScene(built);
    expect(findings).toHaveLength(2);
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "ERR_CHECK_UNSEEDED_RANDOM",
        target: "row0/prop/dice/0",
        frames: [15, 30],
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "ERR_CHECK_CLOCK_READ",
        target: "row0/prop/watch/0",
        frames: [0, 5],
      }),
    );
  });

  it("reports a held prop's holder's read once, on the holder", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor().drive(() => ({ spine: Math.random() * 0 }));
      stage.prop("ball").hold("handR");
    });
    const { findings } = checkScene(built);
    expect(findings.map((finding) => [finding.code, finding.target])).toEqual([
      ["ERR_CHECK_UNSEEDED_RANDOM", "row0/actor/actor/0"],
    ]);
  });

  it("records a read made by the scene's build function itself", () => {
    const built = act((a) => {
      a.pose({ spine: Math.random() * 0.1 }, { duration: 1 });
    });
    expect(built.findings).toHaveLength(1);
    expect(built.findings[0]).toMatchObject({
      code: "ERR_CHECK_UNSEEDED_RANDOM",
      severity: "error",
    });
    expect(built.findings[0]?.target).toBeUndefined();
    expect(codes(checkScene(built).findings)).toEqual(["ERR_CHECK_UNSEEDED_RANDOM"]);
  });

  it("keeps the build function's read when twenty warnings came before it", () => {
    const body = FULL_BODY_POSE;
    const built = act((a) => {
      // Each pose starts while the one before is still playing: twenty cuts.
      for (let n = 0; n < 21; n += 1) {
        a.pose(body, { at: n * 0.1, duration: 0.15 });
      }
      a.pose({ spine: Math.random() * 0.1 }, { at: 2.5, duration: 0.1 });
    });
    expect(built.findings).toHaveLength(20);
    expect(built.truncated).toBe(true);
    expect(
      codes(built.findings).filter((code) => code === "ERR_SCENE_FULL_BODY_CUT"),
    ).toHaveLength(19);
    expect(built.findings.at(-1)).toMatchObject({
      code: "ERR_CHECK_UNSEEDED_RANDOM",
      severity: "error",
    });
    const { findings, truncated } = checkScene(built);
    expect(codes(findings)).toContain("ERR_CHECK_UNSEEDED_RANDOM");
    expect(exitCodeFor(findings)).toBe(1);
    expect(checkReport(findings, { truncated }).ok).toBe(false);
  });

  it("does not count a date built from given numbers", () => {
    const built = act((a) => {
      a.drive(
        () => ({
          spine: new Date(2020, 0, 1).getFullYear() * 0 + Date.UTC(2020, 0) * 0,
        }),
        {
          duration: 1,
        },
      );
    });
    expect(checkScene(built).findings).toEqual([]);
  });

  it("keeps the seeded source free of findings", () => {
    const built = act((a) => {
      a.drive((_t, moment) => ({ spine: moment.random.float(0) * 0.1 }), {
        duration: 1,
      });
    });
    expect(checkScene(built).findings).toEqual([]);
  });

  it("answers as the real globals do while it watches", () => {
    const watched = watchGlobals(() => ({
      now: Date.now(),
      date: new Date(),
      text: Date(),
      random: Math.random(),
      elapsed: performance.now(),
    }));
    if (!watched.ok) {
      throw new Error("the watched function threw");
    }
    expect(watched.value.date).toBeInstanceOf(Date);
    expect(typeof watched.value.text).toBe("string");
    expect(watched.value.now).toBeGreaterThan(1_600_000_000_000);
    expect(watched.value.random).toBeLessThan(1);
    expect(watched.value.elapsed).toBeGreaterThanOrEqual(0);
    expect([...watched.reads].sort()).toEqual([
      "Date",
      "Math.random",
      "performance.now",
    ]);
  });

  it("puts the globals back, also when the watched function throws", () => {
    const globals = (): unknown[] => [
      Date,
      Reflect.get(Math, "random"),
      Reflect.get(performance, "now"),
    ];
    const before = globals();
    const stop = new Error("stop");
    const watched = watchGlobals(() => {
      expect(Date).not.toBe(before[0]);
      throw stop;
    });
    expect(watched).toMatchObject({ ok: false, error: stop });
    globals().forEach((value, index) => {
      expect(value).toBe(before[index]);
    });
    expect(Object.hasOwn(performance, "now")).toBe(false);
  });

  it("keeps the reads a watched function made before it threw", () => {
    const watched = watchGlobals(() => {
      Math.random();
      Date.now();
      throw new Error("stop");
    });
    expect(watched.ok).toBe(false);
    expect([...watched.reads].sort()).toEqual(["Date", "Math.random"]);
  });

  it("keeps a nested watch's reads out of the outer one", () => {
    const outer = watchGlobals(() => watchGlobals(() => Math.random()).reads);
    expect(outer).toEqual({ ok: true, value: ["Math.random"], reads: [] });
  });

  it("reports a drive's read made in the frames where it throws", () => {
    const built = act((a) => {
      a.drive(
        (t) => {
          if (t > 0.5) {
            Math.random();
            throw new Error("late");
          }
          return { spine: 0.1 };
        },
        { duration: 1 },
      );
    });
    const { findings } = checkScene(built);
    expect(
      findings.map((finding) => [finding.code, finding.target, finding.frames]),
    ).toEqual(
      expect.arrayContaining([
        ["ERR_SCENE_DRAWING_FAILED", ACTOR, [16, 90]],
        ["ERR_CHECK_UNSEEDED_RANDOM", ACTOR, [16, 90]],
      ]),
    );
    expect(findings).toHaveLength(2);
  });

  it("rethrows what the build function threw after a read", () => {
    const failure = new Error("build failed");
    expect(() =>
      scene({ duration: 1 }, () => {
        Date.now();
        throw failure;
      }),
    ).toThrow(failure);
  });
});

describe("without a watch installed", () => {
  it("runs the scene and reports no read", () => {
    const built = act((a) => {
      a.drive(() => ({ spine: Math.random() * 0 }), { duration: 1 });
    });
    expect(checkScene(built).findings).toEqual([]);
  });
});

describe("functions that fail at a frame", () => {
  it("turns a drive that throws after t = 0 into one error finding", () => {
    const built = act((a) => {
      a.drive(
        (t) => {
          if (t > 0.5) {
            throw new Error("late");
          }
          return { spine: 0.1 };
        },
        { duration: 1 },
      );
    });
    const { findings } = checkScene(built);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "ERR_SCENE_DRAWING_FAILED",
      severity: "error",
      row: 0,
      target: ACTOR,
      // A drive is held with t frozen at its duration, so it goes on throwing.
      frames: [16, 90],
    });
  });

  it("turns a backdrop or effect whose drawing throws into an error finding", () => {
    const fail = (): never => {
      throw new Error("no");
    };
    const built = scene({ duration: 1 }, (stage) => {
      stage.backdrop(
        defineBackdrop({ name: "torn", description: "Throws.", draw: fail }),
      );
      stage.effect(defineEffect({ name: "spark", description: "Throws.", draw: fail }));
    });
    const { findings } = checkScene(built);
    expect(findings.map((finding) => [finding.code, finding.target])).toEqual([
      ["ERR_SCENE_DRAWING_FAILED", "row0/backdrop/torn/0"],
      ["ERR_SCENE_DRAWING_FAILED", "row0/effect/spark/0"],
    ]);
  });

  it("turns a prop whose drawing throws into an error finding", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.prop(
        defineProp({
          name: "cracked",
          description: "Throws.",
          draw() {
            throw new Error("no");
          },
        }),
      );
    });
    const { findings } = checkScene(built);
    expect(findings.map((finding) => [finding.code, finding.target])).toEqual([
      ["ERR_SCENE_DRAWING_FAILED", "row0/prop/cracked/0"],
    ]);
  });

  it("turns a drawing call given NaN into an error finding", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.draw((ctx) => {
        ctx.lineTo(Number.NaN, 0);
      });
    });
    const { findings } = checkScene(built);
    expect(codes(findings)).toEqual(["ERR_SCENE_DRAWING_FAILED"]);
    expect(findings[0]?.message).toContain("ERR_SCENE_NON_FINITE_DRAWING");
  });
});

describe("findings recorded while authoring", () => {
  it("come first, before the computed ones", () => {
    const built = act((a) => {
      a.pose({ knee: 1 } as never, { duration: 0.5 });
      a.pose({ kneeR: 3 }, { duration: 0.5 });
    });
    expect(codes(checkScene(built).findings)).toEqual([
      "ERR_SCENE_UNKNOWN_CHANNEL",
      "ERR_CHECK_JOINT_LIMIT",
    ]);
  });

  it("are all that a scene without a length reports", () => {
    const built = scene((stage) => {
      stage.actor().drive(() => ({ kneeR: -1 }));
    });
    expect(codes(checkScene(built).findings)).toEqual(["ERR_SCENE_NO_DURATION"]);
  });

  it("keeps an error when warnings alone would fill the cap", () => {
    // Twenty-five separate one-frame exits, then a knee past its limit.
    const built = scene({ duration: 3 }, (stage) => {
      const a = stage.actor();
      const blink = { duration: 0.01, mode: "add", blend: 0 } as const;
      for (let n = 0; n < 25; n += 1) {
        a.pose({ pelvisX: 5 }, { ...blink, at: n * 0.1 });
      }
      a.pose({ kneeR: 3 }, { ...blink, at: 2.9 });
    });
    const { findings, truncated } = checkScene(built);
    expect(truncated).toBe(true);
    expect(findings).toHaveLength(20);
    expect(codes(findings).filter((code) => code === "ERR_CHECK_JOINT_LIMIT")).toEqual([
      "ERR_CHECK_JOINT_LIMIT",
    ]);
    expect(findings.at(-1)?.code).toBe("ERR_CHECK_JOINT_LIMIT");
    const report = checkReport(findings, { truncated });
    expect(report.ok).toBe(false);
    expect(formatReport(report)).toContain("1 error, 19 warnings\n");
  });
});

describe("the text report", () => {
  it("prints one block per finding with its place and fix, then the count", () => {
    const built = act((a) => {
      a.pose({ kneeR: -0.4 }, { at: 1.2, duration: 0.3, mode: "add", blend: 0 });
    });
    const text = formatReport(checkReport(checkScene(built).findings));
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^error ERR_CHECK_JOINT_LIMIT: .+/);
    expect(lines[1]).toBe(
      `  at: row 0, ${ACTOR}, kneeR, 1.2 s to 1.5 s, frames 36 to 44`,
    );
    expect(lines[2]).toMatch(/^ {2}fix: .+/);
    expect(lines.slice(3)).toEqual(["", "1 error, 0 warnings", ""]);
  });

  it("leaves out the place of a finding that has none", () => {
    const text = formatReport(
      checkReport([{ code: "ERR_X", severity: "warning", message: "m", fix: "f" }]),
    );
    expect(text).toBe("warning ERR_X: m\n  fix: f\n\n0 errors, 1 warning\n");
  });
});

describe("the state description (R5)", () => {
  it("says who is where, in which pose, facing which way, and draws nothing", () => {
    let drawn = 0;
    const built = scene({ duration: 3 }, (stage) => {
      stage.actor().pose({ kneeR: 1, pelvisX: 0.5 }, { at: 1, duration: 0.3 });
      stage.draw(() => {
        drawn += 1;
      });
    });
    const before = drawn;
    const state = describeState(built, 45);
    expect(drawn).toBe(before);
    expect(state).toMatchObject({ frame: 45, time: 1.5 });
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]?.drawings).toEqual(["row0/draw/draw/0"]);
    const actor = state.rows[0]?.actors[0];
    expect(actor).toMatchObject({
      id: ACTOR,
      facing: "right",
      pose: { kneeR: 1, pelvisX: 0.5 },
    });
    // The pelvis rests on two 0.24 legs; the head's centre is 0.43 above it.
    expect(actor?.points).toMatchObject({
      pelvis: { x: 0.5, y: 0.48 },
      head: { x: 0.5, y: 0.91 },
      footL: { x: 0.5, y: 0 },
    });
    const text = formatState(state);
    expect(text).toContain("state at 1.5 s (frame 45)\nrow 0\n");
    expect(text).toContain(
      `actor ${ACTOR}: facing right, pelvis (0.5, 0.48), head (0.5, 0.91)`,
    );
    expect(text).toContain("pose: kneeR 1, pelvisX 0.5");
    expect(text).toContain("drawing row0/draw/draw/0");
  });

  it("describes a rest figure, an empty row and a placed prop", () => {
    const ball = defineProp({
      name: "ball",
      description: "A ball.",
      params: {},
      draw: () => undefined,
    });
    const built = scene({ rows: 2, duration: 1 }, (stage) => {
      const top = stage.row(0);
      top.actor().wait(1);
      top.prop(ball).place({ x: 0.25, y: 0 });
      top.prop(ball, { at: 0.9 });
    });
    const state = describeState(built, 0);
    expect(state.rows[0]?.props).toEqual([
      { id: "row0/prop/ball/0", at: { x: 0.25, y: 0 } },
    ]);
    const text = formatState(state);
    expect(text).toContain("pose: rest");
    expect(text).toContain("prop row0/prop/ball/0: at (0.25, 0)");
    expect(text).toContain("row 1\n  empty\n");
  });

  it("describes a held prop where the hand is, and a moved one on its path", () => {
    const built = scene({ duration: 2 }, (stage) => {
      const ball = stage.prop("ball");
      stage.actor();
      ball.hold("handR");
      ball.move({ x: 1, y: 0.43 }, { at: 1, duration: 1 });
    });
    expect(describeState(built, 0).rows[0]?.props).toEqual([
      { id: "row0/prop/ball/0", at: { x: 0, y: 0.43 } },
    ]);
    expect(describeState(built, 45).rows[0]?.props).toEqual([
      { id: "row0/prop/ball/0", at: { x: 0.5, y: 0.43 } },
    ]);
  });

  it("leaves out a prop whose holder cannot be composed", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor().drive((t) => {
        if (t > 0.5) {
          throw new Error("no");
        }
        return { spine: 0 };
      });
      stage.prop("ball").hold("handR");
    });
    expect(describeState(built, 3).rows[0]?.props).toHaveLength(1);
    expect(describeState(built, 20).rows[0]?.props).toEqual([]);
  });

  it("mirrors a figure that faces left", () => {
    const built = act((a) => {
      a.pose({ shoulderR: 1.57 }, { duration: 0.2 });
    });
    const [track] = built.timeline.rows[0]?.tracks ?? [];
    const left: Scene = {
      ...built,
      timeline: {
        ...built.timeline,
        rows: [{ tracks: [{ ...track, facing: "left" } as never] }],
      },
    };
    const right = describeState(built, 30).rows[0]?.actors[0];
    const mirrored = describeState(left, 30).rows[0]?.actors[0];
    expect(mirrored?.facing).toBe("left");
    expect(right?.points?.handR.x).toBeGreaterThan(0.1);
    expect(mirrored?.points?.handR.x).toBe(-(right?.points?.handR.x ?? 0));
  });

  it("marks an actor whose function throws at that frame", () => {
    const built = act((a) => {
      a.drive(
        (t) => {
          if (t > 0.5) {
            throw new Error("late");
          }
          return { spine: 0.1 };
        },
        { duration: 1 },
      );
    });
    const state = describeState(built, 20);
    expect(state.rows[0]?.actors[0]).toMatchObject({ points: null, pose: null });
    expect(formatState(state)).toContain("could not be computed");
  });
});
