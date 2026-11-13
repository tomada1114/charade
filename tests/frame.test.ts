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
import { type Moment, type Scene, scene, type Timeline } from "../src/index.js";

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

  it("never gives an arc a negative radius when eyeOpen overshoots below 0", () => {
    const blink = scene({ duration: 1 }, (stage) => {
      stage.actor().pose({ eyeOpen: 0 }, { followThrough: 0.2 });
    });
    const frames = Array.from({ length: 31 }, (_, n) => actorLog(blink.timeline, n));
    const radii = frames
      .flat()
      .filter((entry) => entry.call === "arc")
      .map((entry) => entry.args[2]);
    expect(radii.length).toBeGreaterThan(0);
    for (const radius of radii) {
      expect(radius).toBeGreaterThanOrEqual(0);
    }
  });
});
