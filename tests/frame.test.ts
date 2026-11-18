import { describe, expect, it, vi } from "vitest";

import { NonFiniteDrawingError, RecordingContext } from "../src/check/recorder.js";
import type { LogEntry } from "../src/check/recorder.js";
import {
  drawFrame,
  drawRow,
  FrameItemError,
  type FrameSource,
  type Painter,
  rowContent,
} from "../src/draw/frame.js";
import { rowLayout } from "../src/draw/layout.js";
import {
  defineBackdrop,
  defineEffect,
  defineProp,
  type Moment,
  type RowView,
  type Scene,
  scene,
  type Timeline,
} from "../src/index.js";
import { parseTimeline, serializeTimeline } from "../src/timeline/json.js";

function record(source: FrameSource, frame: number): readonly LogEntry[] {
  const ctx = new RecordingContext();
  drawFrame(ctx, source, frame);
  return ctx.log;
}

/** A copy of `timeline` whose actor tracks face left. */
function facingLeft(timeline: Timeline): Timeline {
  return {
    ...timeline,
    rows: timeline.rows.map((row) => ({
      tracks: row.tracks.map((track) =>
        track.kind === "actor" ? { ...track, facing: "left" } : track,
      ),
    })),
  };
}

/** The actor painter of row 0 at `frame`, drawn alone on a fresh context. */
function actorLog(timeline: Timeline, frame: number): readonly LogEntry[] {
  const ctx = new RecordingContext();
  const [paint] = rowContent(timeline, rowLayout(1080, 1080, 1, 0), frame).actor;
  paint?.(ctx);
  return ctx.log;
}

const NEGATE_X: Readonly<Record<string, readonly number[]>> = {
  moveTo: [0],
  lineTo: [0],
  quadraticCurveTo: [0, 2],
  bezierCurveTo: [0, 2, 4],
  arc: [0],
};

/** The log with every `x` argument of a path call negated, written out per call. */
function mirrored(log: readonly LogEntry[]): LogEntry[] {
  return log.map((entry) => {
    const xs = NEGATE_X[entry.call] ?? [];
    return {
      call: entry.call,
      args: entry.args.map((arg, index) =>
        xs.includes(index) && typeof arg === "number" ? -arg + 0 : arg,
      ),
    };
  });
}

/** A 1 s scene at 30 fps: a pose, a seeded drive, and an open-ended drawing. */
function busyScene(): Scene {
  return scene((stage) => {
    const hero = stage.actor();
    hero.pose({ shoulderR: 2.4, elbowR: 0.5, mouthCurve: 0.8 }, { duration: 0.5 });
    hero.drive(
      (t, moment) => ({ spine: Math.sin(t * 3) * 0.1 + moment.random.float(1) * 0.05 }),
      { duration: 0.5 },
    );
    stage.draw((ctx, t, moment) => {
      ctx.beginPath();
      ctx.arc(moment.random.float(), 1.5, 0.05 + t * 0.01, 0, Math.PI * 2);
      ctx.save();
      ctx.lineWidth = 0.5;
      ctx.fill();
    });
  });
}

describe("R1: a frame is a function of the timeline and its number", () => {
  it("logs each frame of a full run the same as that frame drawn alone", () => {
    const built = busyScene();
    const shared = new RecordingContext();
    const runs: (readonly LogEntry[])[] = [];
    // n = 0..30: the scene lasts 1 s at 30 fps, so frame 30 is the last.
    for (let frame = 0; frame <= 30; frame += 1) {
      const before = shared.log.length;
      drawFrame(shared, built, frame);
      runs.push(shared.log.slice(before));
    }
    for (const frame of [30, 0, 17, 9]) {
      expect(record(built, frame)).toEqual(runs[frame]);
    }
  });

  it("logs the same frame identically however often it is drawn", () => {
    const built = busyScene();
    expect(record(built, 30)).toEqual(record(built, 30));
  });
});

describe("R2: the draw order within a row", () => {
  it("draws backdrop, props behind, actor, props in front, then text", () => {
    const ctx = new RecordingContext();
    const marker =
      (x: number): Painter =>
      (c) => {
        c.moveTo(x, 0);
      };
    // Each slot given out of order in the object, to show the order is the drawer's.
    drawRow(ctx, rowLayout(1080, 1080, 1, 0), {
      text: [marker(5)],
      propsInFront: [marker(4)],
      actor: [marker(3)],
      propsBehind: [marker(2), marker(2.5)],
      backdrop: [marker(1)],
    });
    const xs = ctx.log
      .filter((entry) => entry.call === "moveTo")
      .map((entry) => entry.args[0]);
    expect(xs).toEqual([10000, 20000, 25000, 30000, 40000, 50000]);
  });

  it("draws the ground line before the actor and a free drawing after it", () => {
    const built = scene((stage) => {
      // The drawing is recorded first and still drawn in front.
      stage.draw((ctx) => {
        ctx.rect(7, 7, 7, 7);
      });
      stage.actor().wait(1);
    });
    const log = record(built, 30);
    const ground = log.findIndex(
      (entry) => entry.call === "moveTo" && entry.args[0] === -12500,
    );
    const head = log.findIndex(
      (entry) => entry.call === "arc" && entry.args[2] === 900,
    );
    const drawing = log.findIndex(
      (entry) => entry.call === "rect" && entry.args[0] === 70000,
    );
    expect(ground).toBeGreaterThan(-1);
    expect(head).toBeGreaterThan(ground);
    expect(drawing).toBeGreaterThan(head);
  });

  it("paints an opaque background over the whole canvas first", () => {
    const built = scene({ width: 640, height: 360 }, (stage) => {
      stage.actor().wait(1);
    });
    expect(record(built, 30).slice(0, 3)).toEqual([
      { call: "reset", args: [] },
      { call: "fillStyle", args: ["#ffffff"] },
      { call: "fillRect", args: [0, 0, 6400000, 3600000] },
    ]);
  });
});

describe("R4: facing left mirrors the actor about its ground point", () => {
  const asymmetric = scene((stage) => {
    stage.actor().pose(
      {
        pelvisX: 0.1,
        pelvisY: -0.05,
        spine: 0.3,
        neck: 0.2,
        shoulderR: 1.2,
        elbowR: 0.5,
        hipL: 0.4,
        kneeL: 0.6,
        ankleR: 0.2,
        eyeOpen: 0.7,
        gazeX: 0.5,
        gazeY: -0.3,
        browTilt: 0.4,
        browHeight: 0.2,
        mouthCurve: 0.6,
        mouthOpen: 0.3,
        mouthWidth: 1.2,
      },
      { duration: 1 },
    );
  });

  it("logs every x of the actor negated and everything else unchanged", () => {
    const right = actorLog(asymmetric.timeline, 30);
    const left = actorLog(facingLeft(asymmetric.timeline), 30);
    expect(right.length).toBeGreaterThan(20);
    expect(left).toEqual(mirrored(right));
  });

  it("puts the near toe of a rest figure 0.08 forward of the ankle in both facings", () => {
    const rest = scene((stage) => {
      stage.actor().wait(1);
    });
    expect(actorLog(rest.timeline, 30)).toContainEqual({
      call: "lineTo",
      args: [800, 0],
    });
    expect(actorLog(facingLeft(rest.timeline), 30)).toContainEqual({
      call: "lineTo",
      args: [-800, 0],
    });
  });

  it("mirrors a root offset to the other side of the ground point", () => {
    // pelvisX 0.1 and pelvisY -0.05 put the pelvis at (0.1, 0.43) facing right.
    expect(actorLog(asymmetric.timeline, 30)).toContainEqual({
      call: "moveTo",
      args: [1000, 4300],
    });
    expect(actorLog(facingLeft(asymmetric.timeline), 30)).toContainEqual({
      call: "moveTo",
      args: [-1000, 4300],
    });
  });

  it("faces right when the track names no facing or an unknown one", () => {
    const rest = scene((stage) => {
      stage.actor().wait(1);
    });
    const odd: Timeline = {
      ...rest.timeline,
      rows: rest.timeline.rows.map((row) => ({
        tracks: row.tracks.map((track) => ({ ...track, facing: "up" })),
      })),
    };
    expect(actorLog(odd, 30)).toEqual(actorLog(rest.timeline, 30));
  });
});

describe("R5: frame drawing reads no clock and no unseeded random", () => {
  function throwing(): never {
    throw new Error("frame drawing read the clock or Math.random");
  }

  // Throws when called, when constructed with `new`, and from `Date.now`.
  const ThrowingDate = Object.assign(
    function ThrowingDate(): never {
      return throwing();
    },
    { now: throwing },
  );

  function stubClockAndRandom(): void {
    vi.stubGlobal("Date", ThrowingDate);
    vi.stubGlobal("performance", { now: throwing });
    vi.spyOn(Math, "random").mockImplementation(throwing);
  }

  it("draws every frame with Date, performance.now and Math.random throwing", () => {
    const built = busyScene();
    stubClockAndRandom();
    for (let frame = 0; frame <= 30; frame += 1) {
      expect(() => record(built, frame)).not.toThrow();
    }
  });

  it.each([
    ["Math.random", () => Math.random()],
    ["Date.now", () => Date.now()],
    ["new Date", () => new Date().getTime()],
  ])("fails a drawing that calls %s while stubbed", (_name, read) => {
    const built = scene((stage) => {
      stage.draw((ctx) => {
        ctx.moveTo(read(), 0);
      });
      stage.actor().wait(1);
    });
    stubClockAndRandom();
    expect(() => record(built, 0)).toThrow(FrameItemError);
  });
});

function caught(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("an item that throws while a frame is drawn", () => {
  it("names the row, the actor, the frame and the time when a drive throws", () => {
    const built = scene({ rows: 2 }, (stage) => {
      stage
        .row(1)
        .actor({ name: "hero" })
        .drive(
          (t) => {
            if (t > 0.5) {
              throw new Error("late");
            }
            return { spine: 0.1 };
          },
          { duration: 1 },
        );
    });
    const error = caught(() => record(built, 20));
    expect(error).toBeInstanceOf(FrameItemError);
    expect(error).toMatchObject({
      code: "ERR_SCENE_DRAWING_FAILED",
      row: 1,
      target: "row1/actor/hero/0",
      frame: 20,
    });
    expect((error as FrameItemError).time).toBeCloseTo(0.666667, 6);
  });

  it("carries the recorder's non-finite error as the cause of a NaN lineTo", () => {
    const built = scene((stage) => {
      stage.draw(
        (ctx) => {
          ctx.lineTo(Number.NaN, 0);
        },
        { name: "broken" },
      );
      stage.actor().wait(1);
    });
    const error = caught(() => record(built, 30));
    expect(error).toBeInstanceOf(FrameItemError);
    expect(error).toMatchObject({
      code: "ERR_SCENE_DRAWING_FAILED",
      row: 0,
      target: "row0/draw/broken/0",
      frame: 30,
      time: 1,
    });
    const cause = (error as FrameItemError).cause;
    expect(cause).toBeInstanceOf(NonFiniteDrawingError);
    expect(cause).toMatchObject({ code: "ERR_SCENE_NON_FINITE_DRAWING" });
  });

  it("rejects a frame number that is not a whole number of 0 or more", () => {
    const built = busyScene();
    for (const frame of [-1, 0.5, Number.NaN]) {
      expect(caught(() => record(built, frame))).toMatchObject({
        code: "ERR_SCENE_OUT_OF_RANGE",
      });
    }
  });
});

describe("free drawings", () => {
  it("are called with t, the scene time, the duration and the progress", () => {
    const moments: [number, Omit<Moment, "random">][] = [];
    const built = scene((stage) => {
      stage.draw(
        (_ctx, t, moment) => {
          moments.push([
            t,
            { time: moment.time, duration: moment.duration, progress: moment.progress },
          ]);
        },
        { at: 0.5, duration: 1 },
      );
    });
    for (const frame of [0, 14, 15, 30, 44, 45]) {
      record(built, frame);
    }
    // Shown on [0.5, 1.5): frames 15 to 44 at 30 fps.
    expect(moments).toHaveLength(3);
    expect(moments[0]).toEqual([0, { time: 0.5, duration: 1, progress: 0 }]);
    expect(moments[1]?.[0]).toBeCloseTo(0.5, 9);
    expect(moments[1]?.[1].progress).toBeCloseTo(0.5, 9);
    expect(moments[2]?.[0]).toBeCloseTo(0.966667, 6);
  });

  it("draws nothing for a segment whose function was omitted or is not a drawing", () => {
    const built = scene((stage) => {
      stage.actor().wait(1);
    });
    const withPlaceholders: Timeline = {
      ...built.timeline,
      rows: [
        {
          tracks: [
            ...(built.timeline.rows[0]?.tracks ?? []),
            {
              kind: "draw",
              name: "draw",
              occurrence: 0,
              segments: [
                {
                  start: 0,
                  end: null,
                  data: { kind: "draw", draw: { $omitted: "function" } },
                },
                { start: 0, end: null, data: { kind: "wait" } },
                { start: 0, end: null, data: null },
              ],
            },
          ],
        },
      ],
    };
    // The empty track still gets its painter's save and restore, and nothing else.
    const drawn = (timeline: Timeline): LogEntry[] =>
      record({ ...built, timeline }, 30).filter(
        (entry) => entry.call !== "save" && entry.call !== "restore",
      );
    expect(drawn(withPlaceholders)).toEqual(drawn(built.timeline));
  });

  it("keeps a style a drawing sets from reaching the items after it", () => {
    const built = scene((stage) => {
      stage.draw((ctx) => {
        ctx.globalAlpha = 0.5;
      });
      stage.draw((ctx) => {
        ctx.fill();
      });
      stage.actor().wait(1);
    });
    const ctx = new RecordingContext();
    let alpha = Number.NaN;
    const spy = vi.spyOn(ctx, "fill").mockImplementation(() => {
      alpha = ctx.globalAlpha;
    });
    drawFrame(ctx, built, 30);
    expect(spy).toHaveBeenCalled();
    expect(alpha).toBe(1);
  });
});

describe("the figure's strokes", () => {
  const rest = scene({ duration: 1 }, (stage) => {
    stage.actor().wait(1);
  });

  it("draws every limb at the figure's line weight, the near ones included", () => {
    const widths = actorLog(rest.timeline, 0)
      .filter((entry) => entry.call === "lineWidth")
      .map((entry) => entry.args[0]);
    // 0.025 units for the figure, 0.01 for the face, then back to 0.025 after the head.
    expect(widths.at(0)).toBe(250);
    expect(widths.at(-1)).toBe(250);
    expect(widths).toContain(100);
  });

  it("never turns an eye over when eyeOpen overshoots below 0", () => {
    const blink = scene({ duration: 1 }, (stage) => {
      stage.actor().pose({ eyeOpen: 0 }, { followThrough: 0.2 });
    });
    const frames = Array.from({ length: 31 }, (_, n) => actorLog(blink.timeline, n));
    // Each eye is two curves, the upper lid first: its control points are never below
    // the corner it ends on.
    const lids = frames
      .flat()
      .filter((entry) => entry.call === "bezierCurveTo")
      .filter((_, index) => index % 2 === 0);
    expect(lids.length).toBe(62);
    for (const { args } of lids) {
      expect(Number(args[1])).toBeGreaterThanOrEqual(Number(args[5]));
    }
    // Closed at the end: the lid lies flat on the line between the corners.
    expect(lids.at(-1)?.args[1]).toBe(lids.at(-1)?.args[5]);
  });
});

describe("props", () => {
  /** A prop whose drawing is one marker call, so it is found in a frame's log. */
  const marker = defineProp({
    name: "marker",
    description: "A marker.",
    params: { size: { type: "number", default: 0.25, doc: "The marker's size." } },
    draw(ctx, { size }, moment) {
      ctx.rect(7, 7, size, moment.duration === Infinity ? 1 : moment.progress);
    },
  });

  function indexOf(log: readonly LogEntry[], call: string, first: number): number {
    return log.findIndex((entry) => entry.call === call && entry.args[0] === first);
  }

  /** The index of the head's circle: the one full-turn arc the figure draws first. */
  function headIndex(log: readonly LogEntry[]): number {
    return log.findIndex((entry) => entry.call === "arc" && entry.args[2] === 900);
  }

  it("draws a placed prop at its ground point, in row units, behind the actor", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor();
      stage.prop(marker).place({ x: 0.5, y: 0.25 });
    });
    const log = record(built, 0);
    const moved = indexOf(log, "translate", 5000);
    expect(log[moved]).toEqual({ call: "translate", args: [5000, 2500] });
    expect(log.slice(moved + 1, moved + 5)).toEqual([
      { call: "strokeStyle", args: ["#111111"] },
      { call: "fillStyle", args: ["#111111"] },
      { call: "lineWidth", args: [250] },
      { call: "rect", args: [70000, 70000, 2500, 10000] },
    ]);
    expect(moved).toBeGreaterThan(indexOf(log, "moveTo", -12500));
    expect(moved).toBeLessThan(headIndex(log));
  });

  it("draws a prop placed in front after the actor", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.prop(marker).place({ x: 0.5, y: 0.25 }, { layer: "front" });
      stage.actor();
    });
    const log = record(built, 0);
    expect(indexOf(log, "rect", 70000)).toBeGreaterThan(headIndex(log));
  });

  it("draws a prop placed from 1 s at the origin before then and on its point after", () => {
    const built = scene({ duration: 2 }, (stage) => {
      stage.prop(marker).place({ x: 0.5, y: 0 }, { at: 1 });
    });
    const translations = (frame: number): readonly LogEntry[] =>
      record(built, frame).filter((entry) => entry.call === "translate");
    // Row units are scaled by 1e4 in the log; the origin has nothing to translate by.
    expect(translations(0)).toEqual([{ call: "translate", args: [0, 0] }]);
    expect(translations(29)).toEqual([{ call: "translate", args: [0, 0] }]);
    expect(translations(30)).toEqual([{ call: "translate", args: [5000, 0] }]);
  });

  it("draws a prop in the near hand, and one on its way, in front of the actor", () => {
    const built = scene({ duration: 2 }, (stage) => {
      const prop = stage.prop(marker);
      stage.actor();
      prop.hold("handR");
      prop.move({ x: 1, y: 0 }, { at: 1, duration: 0.5 });
    });
    for (const frame of [0, 40, 60]) {
      const log = record(built, frame);
      expect(indexOf(log, "rect", 70000)).toBeGreaterThan(headIndex(log));
    }
    expect(record(built, 0)).toContainEqual({ call: "translate", args: [0, 4300] });
    expect(record(built, 60)).toContainEqual({ call: "translate", args: [10000, 0] });
  });

  it("draws a prop in the far hand behind the actor", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor();
      stage.prop(marker).hold("handL");
    });
    const log = record(built, 0);
    expect(indexOf(log, "rect", 70000)).toBeGreaterThan(-1);
    expect(indexOf(log, "rect", 70000)).toBeLessThan(headIndex(log));
  });

  it("gives the prop its parameters, and its segment's moment", () => {
    const built = scene({ duration: 2 }, (stage) => {
      stage.prop(marker, { size: 0.5, at: 1, duration: 1 });
    });
    expect(indexOf(record(built, 29), "rect", 70000)).toBe(-1);
    expect(record(built, 45)).toContainEqual({
      call: "rect",
      args: [70000, 70000, 5000, 5000],
    });
  });

  it("keeps what a prop sets on the context to itself", () => {
    const loud = defineProp({
      name: "loud",
      description: "Sets state and leaves it.",
      draw(ctx) {
        ctx.lineWidth = 3;
        ctx.save();
      },
    });
    const built = scene({ duration: 1 }, (stage) => {
      stage.prop(loud);
      stage.actor();
    });
    const widths = record(built, 0)
      .filter((entry) => entry.call === "lineWidth")
      .map((entry) => entry.args[0]);
    // The prop's own 3, then the figure starts from its own weight.
    const loudest = widths.indexOf(30000);
    expect(loudest).toBeGreaterThan(-1);
    expect(widths[loudest + 1]).toBe(250);
  });

  it("draws a built-in named by a string, also from a parsed timeline", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.prop("ball").place({ x: 0.5, y: 0 });
    });
    const log = record(built, 0);
    // The ball's body: a circle of its radius, resting on its ground point.
    expect(log).toContainEqual({
      call: "arc",
      args: [0, 600, 600, 0, Math.round(Math.PI * 2e4)],
    });
    const parsed = parseTimeline(serializeTimeline(built.timeline));
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    expect(record({ ...built, timeline: parsed.document.timeline }, 0)).toEqual(log);
  });

  it("draws nothing for a name that is no built-in, or a definition without its function", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.prop(marker);
    });
    const [track] = built.timeline.rows[0]?.tracks ?? [];
    const withData = (data: unknown): FrameSource => ({
      ...built,
      timeline: {
        ...built.timeline,
        rows: [{ tracks: [{ ...track, segments: [{ start: 0, end: null, data }] }] }],
      } as Timeline,
    });
    expect(indexOf(record(built, 0), "rect", 70000)).toBeGreaterThan(-1);
    for (const data of [
      { kind: "prop", name: "hasOwnProperty", definition: null, params: {} },
      { kind: "prop", name: "marker", definition: { draw: { $omitted: "function" } } },
      { kind: "prop", name: "marker", definition: "marker", params: {} },
    ]) {
      const calls = record(withData(data), 0).map((entry) => entry.call);
      expect(calls).not.toContain("translate");
      expect(calls).not.toContain("arc");
    }
  });

  it("names the prop when its drawing throws, and when its holder's motion does", () => {
    const broken = defineProp({
      name: "broken",
      description: "Throws.",
      draw() {
        throw new Error("no");
      },
    });
    const drawn = scene({ duration: 1 }, (stage) => {
      stage.prop(broken);
    });
    expect(() => record(drawn, 3)).toThrow(
      expect.objectContaining({
        code: "ERR_SCENE_DRAWING_FAILED",
        target: "row0/prop/broken/0",
        frame: 3,
      }),
    );
    const held = scene({ duration: 1 }, (stage) => {
      stage.actor().drive((t) => {
        if (t > 0.5) {
          throw new Error("no");
        }
        return { spine: 0 };
      });
      stage.prop(marker).hold("handR");
    });
    expect(() => record(held, 20)).toThrow(FrameItemError);
  });
});

describe("backdrops and effects", () => {
  const sky = defineBackdrop({
    name: "sky",
    description: "A backdrop of one marker call.",
    params: { size: { type: "number", default: 0.25, doc: "The marker's size." } },
    draw(ctx, { size }, moment) {
      ctx.rect(6, 6, size, moment.duration === Infinity ? 1 : moment.progress);
    },
  });
  const sweat = defineEffect({
    name: "sweat",
    description: "An effect of one marker call.",
    draw(ctx) {
      ctx.rect(8, 8, 1, 1);
    },
  });

  function rectIndex(log: readonly LogEntry[], first: number): number {
    return log.findIndex((entry) => entry.call === "rect" && entry.args[0] === first);
  }

  function groundIndex(log: readonly LogEntry[]): number {
    return log.findIndex(
      (entry) => entry.call === "moveTo" && entry.args[0] === -12500,
    );
  }

  function headIndex(log: readonly LogEntry[]): number {
    return log.findIndex((entry) => entry.call === "arc" && entry.args[2] === 900);
  }

  it("draws a backdrop before the ground line and an effect after the actor", () => {
    const built = scene({ duration: 1 }, (stage) => {
      // Recorded in reverse of the draw order, to show the order is the drawer's.
      stage.draw((ctx) => {
        ctx.rect(9, 9, 1, 1);
      });
      stage.effect(sweat);
      stage.actor();
      stage.backdrop(sky);
    });
    const log = record(built, 0);
    const backdrop = rectIndex(log, 60000);
    const effect = rectIndex(log, 80000);
    expect(backdrop).toBeGreaterThan(-1);
    expect(backdrop).toBeLessThan(groundIndex(log));
    expect(groundIndex(log)).toBeLessThan(headIndex(log));
    expect(effect).toBeGreaterThan(headIndex(log));
    // A free drawing stays frontmost.
    expect(rectIndex(log, 90000)).toBeGreaterThan(effect);
  });

  it("draws each at the row's origin with a free drawing's starting state", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.backdrop(sky);
    });
    const log = record(built, 0);
    const moved = log.findIndex((entry) => entry.call === "translate");
    expect(log.slice(moved, moved + 5)).toEqual([
      { call: "translate", args: [0, 0] },
      { call: "strokeStyle", args: ["#111111"] },
      { call: "fillStyle", args: ["#111111"] },
      { call: "lineWidth", args: [250] },
      { call: "rect", args: [60000, 60000, 2500, 10000] },
    ]);
  });

  it.each([
    // width, height, rows, the row's edges in units
    [1080, 1080, 1, -1.25, 1.25],
    [1920, 1080, 1, -40 / 18, 40 / 18],
    [1080, 1080, 4, -5, 5],
    [1920, 1080, 4, -80 / 9, 80 / 9],
  ])(
    "hands a backdrop, an effect and a free drawing the row's visible area: %i × %i, %i row(s)",
    (width, height, rows, left, right) => {
      const seen: RowView[] = [];
      const built = scene({ width, height, rows, duration: 1 }, (stage) => {
        const row = stage.row(rows - 1);
        row.backdrop(
          defineBackdrop({
            name: "wide",
            description: "A backdrop that notes the view.",
            draw: (_ctx, _params, { view }) => void seen.push(view),
          }),
        );
        row.effect(
          defineEffect({
            name: "wide",
            description: "An effect that notes the view.",
            draw: (_ctx, _params, { view }) => void seen.push(view),
          }),
        );
        row.draw((_ctx, _t, { view }) => void seen.push(view));
      });
      record(built, 0);
      expect(seen).toHaveLength(3);
      for (const view of seen) {
        expect(view.left).toBeCloseTo(left, 9);
        expect(view.right).toBeCloseTo(right, 9);
        expect(view.bottom).toBeCloseTo(-0.3, 9);
        expect(view.top).toBeCloseTo(2.2, 9);
      }
    },
  );

  it("hands a prop the visible area as seen from its own ground point", () => {
    const seen: RowView[] = [];
    const built = scene({ duration: 1 }, (stage) => {
      stage
        .prop(
          defineProp({
            name: "seer",
            description: "A prop that notes the view.",
            draw: (_ctx, _params, { view }) => void seen.push(view),
          }),
        )
        .place({ x: 0.5, y: 0.2 });
    });
    record(built, 0);
    expect(seen).toHaveLength(1);
    // The row runs from -1.25 to 1.25 and from -0.3 to 2.2; the prop stands at (0.5, 0.2).
    expect(seen[0]?.left).toBeCloseTo(-1.75, 9);
    expect(seen[0]?.right).toBeCloseTo(0.75, 9);
    expect(seen[0]?.bottom).toBeCloseTo(-0.5, 9);
    expect(seen[0]?.top).toBeCloseTo(2, 9);
  });

  it("gives a backdrop its parameters and draws it only while its segment covers the frame", () => {
    const built = scene({ duration: 2 }, (stage) => {
      stage.backdrop(sky, { size: 0.5, at: 1, duration: 1 });
      stage.effect(sweat, { duration: 0.5 });
    });
    expect(rectIndex(record(built, 29), 60000)).toBe(-1);
    expect(record(built, 45)).toContainEqual({
      call: "rect",
      args: [60000, 60000, 5000, 5000],
    });
    expect(rectIndex(record(built, 14), 80000)).toBeGreaterThan(-1);
    expect(rectIndex(record(built, 15), 80000)).toBe(-1);
  });

  it("resolves a segment without a definition by name from its own kind's built-ins", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.backdrop(sky);
    });
    const [track] = built.timeline.rows[0]?.tracks ?? [];
    const withTrack = (kind: string, data: unknown): FrameSource => ({
      ...built,
      timeline: {
        ...built.timeline,
        rows: [
          {
            tracks: [{ ...track, kind, segments: [{ start: 0, end: null, data }] }],
          },
        ],
      } as Timeline,
    });
    const calls = (source: FrameSource): readonly string[] =>
      record(source, 0).map((entry) => entry.call);
    // `ball` is a built-in prop, not a backdrop or an effect, so it draws nothing here.
    for (const kind of ["backdrop", "effect"]) {
      const named = withTrack(kind, {
        kind,
        name: "ball",
        definition: null,
        params: {},
      });
      expect(calls(named)).not.toContain("translate");
    }
    // A segment of another kind on the track is not the track's own and draws nothing.
    const foreign = withTrack("backdrop", {
      kind: "effect",
      name: "sky",
      definition: sky,
      params: {},
    });
    expect(calls(foreign)).not.toContain("translate");
  });

  it("draws nothing for a parsed timeline's placeholder", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.backdrop(sky);
      stage.effect(sweat);
    });
    const parsed = parseTimeline(serializeTimeline(built.timeline));
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    const log = record({ ...built, timeline: parsed.document.timeline }, 0);
    expect(log.map((entry) => entry.call)).not.toContain("translate");
    expect(groundIndex(log)).toBeGreaterThan(-1);
  });

  it("names the backdrop or effect whose drawing throws", () => {
    const fail = (): never => {
      throw new Error("no");
    };
    const built = {
      backdrop: scene({ duration: 1 }, (stage) => {
        stage.backdrop(
          defineBackdrop({ name: "broken", description: "Throws.", draw: fail }),
        );
      }),
      effect: scene({ duration: 1 }, (stage) => {
        stage.effect(
          defineEffect({ name: "broken", description: "Throws.", draw: fail }),
        );
      }),
    };
    for (const kind of ["backdrop", "effect"] as const) {
      expect(() => record(built[kind], 3)).toThrow(FrameItemError);
      expect(() => record(built[kind], 3)).toThrow(
        expect.objectContaining({
          code: "ERR_SCENE_DRAWING_FAILED",
          target: `row0/${kind}/broken/0`,
          frame: 3,
        }),
      );
    }
  });
});
