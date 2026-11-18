import { describe, expect, it } from "vitest";

import { type LogEntry, RecordingContext } from "../src/check/recorder.js";
import {
  drawGhosts,
  drawRowFrame,
  drawSheetLabels,
  findActor,
  ghostLayout,
  rowAspect,
  sheetLayout,
  spreadFrames,
} from "../src/check/sheet.js";
import { drawFrame, FrameItemError } from "../src/draw/frame.js";
import { defineBackdrop, defineEffect, scene } from "../src/index.js";

describe("spreadFrames", () => {
  // R2: a 4 s scene at 30 fps has 121 frames, 0 to 120.
  it("picks 12 frames of 121, the first and the last included", () => {
    const frames = spreadFrames(0, 120, 12);
    expect(frames).toHaveLength(12);
    expect(frames[0]).toBe(0);
    expect(frames.at(-1)).toBe(120);
    // i × 120 / 11 to the nearest frame: 10.9, 21.8, 32.7, 43.6, 54.5 (a half, up),
    // 65.5 (65.45, down), 76.4, 87.3, 98.2, 109.1.
    expect(frames).toEqual([0, 11, 22, 33, 44, 55, 65, 76, 87, 98, 109, 120]);
  });

  it.each([
    { label: "one frame", first: 0, last: 0, count: 12, frames: [0] },
    { label: "two frames", first: 0, last: 1, count: 12, frames: [0, 1] },
    {
      label: "exactly as many frames as cells",
      first: 0,
      last: 3,
      count: 4,
      frames: [0, 1, 2, 3],
    },
    { label: "a range", first: 30, last: 60, count: 4, frames: [30, 40, 50, 60] },
    { label: "a half rounds up", first: 0, last: 5, count: 3, frames: [0, 3, 5] },
  ])("gives $label", ({ first, last, count, frames }) => {
    expect(spreadFrames(first, last, count)).toEqual(frames);
  });
});

describe("sheetLayout", () => {
  const twelve = [0, 11, 22, 33, 44, 55, 65, 76, 87, 98, 109, 120];

  it("lays twelve 16:9 frames out four to a row on a sheet 1568 px wide", () => {
    const layout = sheetLayout(1920, 1080, twelve, 30);
    // (1568 − 5 × 8) / 4 = 382 px a cell, 382 × 9 / 16 = 214.9 → 215 px high; three
    // rows of 215 + 24 (label) + 8 (gap), and one gap above.
    expect(layout.width).toBe(1568);
    expect(layout.height).toBe(749);
    expect(layout.cells).toHaveLength(12);
    expect(layout.cells[0]).toEqual({
      frame: 0,
      time: 0,
      x: 8,
      y: 8,
      width: 382,
      height: 215,
      label: "0 s  frame 0",
    });
    expect(layout.cells[5]).toMatchObject({ frame: 55, time: 1.833, x: 398, y: 255 });
    expect(layout.cells[11]).toMatchObject({
      frame: 120,
      time: 4,
      x: 1178,
      y: 502,
      label: "4 s  frame 120",
    });
  });

  it("shrinks the cells of a tall scene until the sheet is 1568 px high at most", () => {
    const layout = sheetLayout(1080, 1920, twelve, 30);
    // floor(1560 / 3) − 32 = 488 px high, 488 × 9 / 16 = 274.5 → 275 px wide.
    expect(layout.cells[0]).toMatchObject({ width: 275, height: 488 });
    expect(layout.width).toBe(1140);
    expect(layout.height).toBe(1568);
  });

  it("uses as many columns as there are frames when they are fewer than four", () => {
    const layout = sheetLayout(1000, 500, [3, 9], 30);
    expect(layout.cells.map(({ x, y, width }) => [x, y, width])).toEqual([
      [8, 8, 772],
      [788, 8, 772],
    ]);
    expect(layout.width).toBe(1568);
  });

  it("keeps a cell at least one pixel in each direction", () => {
    const frames = Array.from({ length: 48 }, (_, i) => i);
    const wide = sheetLayout(100_000, 1, frames, 30);
    expect(wide.cells[0]).toMatchObject({ width: 382, height: 1 });
    const tall = sheetLayout(1, 100_000, frames, 30);
    expect(tall.cells[0]).toMatchObject({ width: 1, height: 98 });
    expect(tall.height).toBeLessThanOrEqual(1568);
  });
});

function calls(log: readonly LogEntry[], call: string): LogEntry[] {
  return log.filter((entry) => entry.call === call);
}

describe("drawSheetLabels", () => {
  it("outlines every cell and writes its time and frame beneath it", () => {
    const ctx = new RecordingContext();
    drawSheetLabels(ctx, sheetLayout(1920, 1080, [0, 45], 30));
    expect(calls(ctx.log, "font")).toEqual([
      { call: "font", args: ["16px sans-serif"] },
    ]);
    expect(calls(ctx.log, "strokeRect")).toHaveLength(2);
    // Two columns of (1568 − 24) / 2 = 772 px, 434 px high; the label's middle is
    // 13 px under the cell. Arguments are logged × 1e4.
    expect(calls(ctx.log, "fillText")).toEqual([
      { call: "fillText", args: ["0 s  frame 0", 80_000, 4_550_000, 7_720_000] },
      { call: "fillText", args: ["1.5 s  frame 45", 7_880_000, 4_550_000, 7_720_000] },
    ]);
  });
});

const twoRows = scene({ duration: 2, width: 800, height: 400, rows: 2 }, (stage) => {
  stage.row(0).actor({ name: "ada" }).pose({ pelvisX: 1 }, { duration: 2 });
  stage
    .row(1)
    .actor({ name: "bob" })
    .drive((t) => ({ spine: 0.1 * t }), { duration: 2 });
});

describe("drawRowFrame", () => {
  it("draws the row as the whole frame draws it, filling the picture", () => {
    // Row 1 alone on 800 × 200 is the lower half of the 800 × 400 frame moved up:
    // the same scale, so the same calls in row units.
    const whole = new RecordingContext();
    drawFrame(whole, twoRows, 30);
    const alone = new RecordingContext();
    drawRowFrame(alone, { ...twoRows, height: 200 }, 1, 30);

    const strokes = (log: readonly LogEntry[]): LogEntry[] =>
      log.filter(({ call }) => call === "lineTo" || call === "arc");
    expect(strokes(alone.log)).toEqual(
      strokes(whole.log).slice(strokes(alone.log).length),
    );
    expect(calls(alone.log, "rect")).toEqual([
      { call: "rect", args: [0, 0, 8_000_000, 2_000_000] },
    ]);
  });

  it("rejects a frame that is not a whole number", () => {
    expect(() => {
      drawRowFrame(new RecordingContext(), twoRows, 0, 1.5);
    }).toThrow();
  });
});

describe("rowAspect", () => {
  it("is the scene's width over one row's share of its height", () => {
    expect(rowAspect(1920, 1080, 2)).toEqual({ width: 1920, height: 540 });
  });
});

describe("ghosts", () => {
  it("sizes the image to the row at 1568 px wide with a legend strip below", () => {
    expect(ghostLayout(800, 200, "row0/actor/ada/0", [0, 30, 60])).toEqual({
      width: 1568,
      height: 416,
      band: 392,
      legend: "ghost row0/actor/ada/0, faint to solid: frames 0, 30, 60",
    });
  });

  it("shrinks a tall row so the image is 1568 px high at most", () => {
    expect(ghostLayout(100, 400, "a", [0])).toMatchObject({
      width: 386,
      height: 1568,
      band: 1544,
    });
  });

  it("draws the actor once per frame, the earliest faintest and the last solid", () => {
    const { timeline } = twoRows;
    const actor = findActor(timeline, "ada");
    if (actor.kind !== "found") {
      throw new Error("ada was not found");
    }
    const frames = [0, 15, 30, 45, 60];
    const layout = ghostLayout(800, 200, "row0/actor/ada/0", frames);
    const ctx = new RecordingContext();
    drawGhosts(ctx, timeline, actor.row, actor.track, frames, layout);

    // 0.15 to 1 in four equal steps of 0.2125, logged × 1e4.
    expect(calls(ctx.log, "globalAlpha").map(({ args }) => args[0])).toEqual([
      1500, 3625, 5750, 7875, 10_000,
    ]);
    // One head circle a ghost.
    const heads = calls(ctx.log, "arc").filter(({ args }) => args[2] === 900);
    expect(heads).toHaveLength(5);
    expect(calls(ctx.log, "fillText")).toEqual([
      { call: "fillText", args: [layout.legend, 80_000, 4_040_000, 15_520_000] },
    ]);
  });

  it("draws a single ghost solid", () => {
    const actor = findActor(twoRows.timeline, "ada");
    if (actor.kind !== "found") {
      throw new Error("ada was not found");
    }
    const ctx = new RecordingContext();
    drawGhosts(
      ctx,
      twoRows.timeline,
      actor.row,
      actor.track,
      [7],
      ghostLayout(800, 200, "x", [7]),
    );
    expect(calls(ctx.log, "globalAlpha")).toEqual([
      { call: "globalAlpha", args: [10_000] },
    ]);
  });

  it("draws the row's backdrop at the last ghost's frame under the ghosts, and no effect", () => {
    const built = scene({ duration: 2 }, (stage) => {
      stage.actor();
      stage.backdrop(
        defineBackdrop({
          name: "wall",
          description: "A marker.",
          draw(ctx) {
            ctx.rect(6, 6, 1, 1);
          },
        }),
        { at: 1 },
      );
      stage.effect(
        defineEffect({
          name: "spark",
          description: "A marker.",
          draw(ctx) {
            ctx.rect(8, 8, 1, 1);
          },
        }),
      );
    });
    const actor = findActor(built.timeline, "actor");
    if (actor.kind !== "found") {
      throw new Error("the actor was not found");
    }
    const ghosts = (frames: readonly number[]): readonly LogEntry[] => {
      const ctx = new RecordingContext();
      drawGhosts(
        ctx,
        built.timeline,
        actor.row,
        actor.track,
        frames,
        ghostLayout(1080, 1080, "x", frames),
      );
      return ctx.log;
    };
    const rects = (log: readonly LogEntry[]): unknown[] =>
      calls(log, "rect").map(({ args }) => args[0]);
    expect(rects(ghosts([0, 15]))).not.toContain(60_000);
    const log = ghosts([0, 30]);
    expect(rects(log)).toContain(60_000);
    expect(rects(log)).not.toContain(80_000);
    const wall = log.findIndex(
      ({ call, args }) => call === "rect" && args[0] === 60_000,
    );
    const head = log.findIndex(({ call, args }) => call === "arc" && args[2] === 900);
    expect(wall).toBeLessThan(head);
  });

  it("wraps a pose that cannot be composed in the frame drawer's error", () => {
    const failing = scene({ duration: 2 }, (stage) => {
      stage.actor().drive(
        (t) => {
          if (t > 0.5) {
            throw new Error("late");
          }
          return { spine: 0.1 };
        },
        { duration: 2 },
      );
    });
    const actor = findActor(failing.timeline, "actor");
    if (actor.kind !== "found") {
      throw new Error("the actor was not found");
    }
    let thrown: unknown;
    try {
      drawGhosts(
        new RecordingContext(),
        failing.timeline,
        actor.row,
        actor.track,
        [0, 30],
        ghostLayout(1080, 1080, "x", [0, 30]),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FrameItemError);
    expect(thrown).toMatchObject({
      code: "ERR_SCENE_DRAWING_FAILED",
      row: 0,
      target: "row0/actor/actor/0",
      frame: 30,
      time: 1,
    });
  });
});

describe("findActor", () => {
  const sameName = scene({ duration: 1, rows: 2 }, (stage) => {
    stage.row(0).actor().wait(1);
    stage.row(1).actor().wait(1);
  });

  it("finds an actor by its bare name when one actor has it", () => {
    expect(findActor(twoRows.timeline, "bob")).toMatchObject({ kind: "found", row: 1 });
  });

  it("finds an actor by its id", () => {
    expect(findActor(sameName.timeline, "row1/actor/actor/0")).toMatchObject({
      kind: "found",
      row: 1,
    });
  });

  it.each([
    { label: "a name two actors share", built: sameName, name: "actor" },
    { label: "a name no actor has", built: sameName, name: "ada" },
    { label: "an empty name", built: sameName, name: "" },
  ])("lists the ids to choose from for $label", ({ built, name }) => {
    expect(findActor(built.timeline, name)).toEqual({
      kind: "none",
      ids: ["row0/actor/actor/0", "row1/actor/actor/0"],
    });
  });
});
