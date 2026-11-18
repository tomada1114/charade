import { describe, expect, it, vi } from "vitest";

import { RecordingContext } from "../src/check/recorder.js";
import {
  CharadeError,
  InvalidPathDataError,
  svgPath,
  type SvgPathOptions,
} from "../src/index.js";

/** The recording context logs every number multiplied by 1e4 and rounded. */
const q = (value: number): number => Math.round(value * 1e4);

function record(d: string, options?: SvgPathOptions): RecordingContext["log"] {
  const ctx = new RecordingContext();
  svgPath(ctx, d, options);
  return ctx.log;
}

function thrown(d: string): unknown {
  try {
    svgPath(new RecordingContext(), d);
  } catch (error) {
    return error;
  }
  return undefined;
}

/** Where an `ellipse` call's arc ends (or starts), from its logged arguments. */
function ellipseEnd(
  args: readonly unknown[],
  which: "start" | "end" = "end",
): { x: number; y: number } {
  const [cx, cy, rx, ry, rotation, begin, finish] = args.map(
    (value) => Number(value) / 1e4,
  );
  const end = which === "end" ? finish : begin;
  const ex = (rx ?? 0) * Math.cos(end ?? 0);
  const ey = (ry ?? 0) * Math.sin(end ?? 0);
  const cos = Math.cos(rotation ?? 0);
  const sin = Math.sin(rotation ?? 0);
  return { x: (cx ?? 0) + cos * ex - sin * ey, y: (cy ?? 0) + sin * ex + cos * ey };
}

describe("absolute commands", () => {
  it("issues moveTo, lineTo, lineTo, closePath for a closed triangle, y flipped", () => {
    expect(record("M0 0 L10 0 L10 10 Z")).toEqual([
      { call: "moveTo", args: [0, 0] },
      { call: "lineTo", args: [q(10), 0] },
      { call: "lineTo", args: [q(10), q(-10)] },
      { call: "closePath", args: [] },
    ]);
  });

  it("scales and places the origin point on the context's origin", () => {
    expect(record("M0 0 L10 10", { scale: 0.01, origin: { x: 5, y: 10 } })).toEqual([
      { call: "moveTo", args: [q(-0.05), q(0.1)] },
      { call: "lineTo", args: [q(0.05), 0] },
    ]);
  });

  it("mirrors the shape left to right under a negative scale, still standing", () => {
    expect(record("M2 3", { scale: -1 })).toEqual([
      { call: "moveTo", args: [q(-2), q(-3)] },
    ]);
  });

  it("issues one bezierCurveTo with six mapped numbers for a cubic", () => {
    expect(record("M0,0 C5,10 15,10 20,0")).toEqual([
      { call: "moveTo", args: [0, 0] },
      { call: "bezierCurveTo", args: [q(5), q(-10), q(15), q(-10), q(20), 0] },
    ]);
  });

  it("draws H and V as lines", () => {
    expect(record("M1 1 H4 V6")).toEqual([
      { call: "moveTo", args: [q(1), q(-1)] },
      { call: "lineTo", args: [q(4), q(-1)] },
      { call: "lineTo", args: [q(4), q(-6)] },
    ]);
  });

  it("issues quadraticCurveTo for Q", () => {
    expect(record("M0 0 Q5 10 10 0")).toEqual([
      { call: "moveTo", args: [0, 0] },
      { call: "quadraticCurveTo", args: [q(5), q(-10), q(10), 0] },
    ]);
  });

  it("reflects the previous cubic's second control point for S", () => {
    expect(record("M0 0 C0 10 10 10 10 0 S20 -10 20 0")[2]).toEqual({
      call: "bezierCurveTo",
      args: [q(10), q(10), q(20), q(10), q(20), 0],
    });
  });

  it("starts S at the current point when no cubic came before", () => {
    expect(record("M1 1 L2 2 S3 3 4 4")[2]).toEqual({
      call: "bezierCurveTo",
      args: [q(2), q(-2), q(3), q(-3), q(4), q(-4)],
    });
  });

  it("reflects the previous quadratic's control point for T", () => {
    expect(record("M0 0 Q5 10 10 0 T20 0")[2]).toEqual({
      call: "quadraticCurveTo",
      args: [q(15), q(10), q(20), 0],
    });
  });

  it("starts T at the current point after a cubic", () => {
    expect(record("M0 0 C1 1 2 2 3 3 T5 5")[2]).toEqual({
      call: "quadraticCurveTo",
      args: [q(3), q(-3), q(5), q(-5)],
    });
  });
});

describe("relative commands", () => {
  it.each([
    ["lines", "m1 1 l2 2 h3 v-4 z", "M1 1 L3 3 H6 V-1 Z"],
    ["cubics", "M1 1 c1 1 2 2 3 0 s4 -2 5 0", "M1 1 C2 2 3 3 4 1 S8 -1 9 1"],
    ["quadratics", "M0 0 q1 2 2 0 t2 0", "M0 0 Q1 2 2 0 T4 0"],
    ["arcs", "M2 0 a5 5 0 0 1 10 0", "M2 0 A5 5 0 0 1 12 0"],
    ["a second moveto", "M1 1 L2 2 m3 3 l1 0", "M1 1 L2 2 M5 5 L6 5"],
    ["a command after closepath", "M1 1 L5 1 Z l1 0", "M1 1 L5 1 Z L2 1"],
  ])("issue the same calls as their absolute equivalents: %s", (_label, rel, abs) => {
    expect(record(rel)).toEqual(record(abs));
  });

  it("reads pairs after m as relative linetos", () => {
    expect(record("m1 1 2 2 3 3")).toEqual([
      { call: "moveTo", args: [q(1), q(-1)] },
      { call: "lineTo", args: [q(3), q(-3)] },
      { call: "lineTo", args: [q(6), q(-6)] },
    ]);
  });
});

describe("the grammar", () => {
  it.each([
    ["an empty string", ""],
    ["whitespace only", " \t\r\n\f"],
  ])("issues no calls for %s", (_label, d) => {
    expect(record(d)).toEqual([]);
  });

  it("separates numbers by signs and dots and reads exponents", () => {
    expect(record("M1-2.5L.5e1-1E+1")).toEqual([
      { call: "moveTo", args: [q(1), q(2.5)] },
      { call: "lineTo", args: [q(5), q(10)] },
    ]);
  });

  it("accepts commas, newlines and repeated commands", () => {
    expect(record("M 0,0\nL 1 , 1 2,2 C1 1 2 2 3 3 4 4 5 5 6 6")).toEqual([
      { call: "moveTo", args: [0, 0] },
      { call: "lineTo", args: [q(1), q(-1)] },
      { call: "lineTo", args: [q(2), q(-2)] },
      { call: "bezierCurveTo", args: [q(1), q(-1), q(2), q(-2), q(3), q(-3)] },
      { call: "bezierCurveTo", args: [q(4), q(-4), q(5), q(-5), q(6), q(-6)] },
    ]);
  });

  it("reads arc flags written without separators", () => {
    expect(record("M0 0a5 5 0 0110 0")).toEqual(record("M0 0 A5 5 0 0 1 10 0"));
  });
});

describe("elliptical arcs", () => {
  it("draws a half circle over the top with an ellipse that ends at the arc's end", () => {
    const log = record("M0 0 A5 5 0 0 1 10 0");
    expect(log).toHaveLength(2);
    const [, arc] = log;
    expect(arc?.call).toBe("ellipse");
    expect(arc?.args.slice(0, 5)).toEqual([q(5), 0, q(5), q(5), 0]);
    const end = ellipseEnd(arc?.args ?? []);
    expect(end.x).toBeCloseTo(10, 3);
    expect(end.y).toBeCloseTo(0, 3);
    // Sweep 1 runs over the screen's top in SVG: from angle -π down to -2π in the row,
    // passing (5, 5).
    expect(arc?.args.slice(5)).toEqual([q(-Math.PI), q(-2 * Math.PI), true]);
  });

  it.each([
    ["a rotated large arc", "M0 0 A10 5 30 1 0 8 6", undefined, { x: 8, y: -6 }],
    ["a sweep-0 small arc", "M1 2 A3 2 -45 0 0 4 5", undefined, { x: 4, y: -5 }],
    [
      "a scaled and placed arc",
      "M0 0 A10 5 30 1 1 8 6",
      { scale: 0.1, origin: { x: 2, y: 1 } },
      { x: 0.6, y: -0.5 },
    ],
    ["a mirrored arc", "M0 0 A10 5 30 0 1 8 6", { scale: -1 }, { x: -8, y: -6 }],
    [
      "a mirrored, scaled and placed large arc",
      "M0 0 A10 5 30 1 0 8 6",
      { scale: -0.1, origin: { x: 2, y: 1 } },
      { x: -0.6, y: -0.5 },
    ],
    ["radii too small to reach", "M0 0 A1 1 0 0 1 10 0", undefined, { x: 10, y: 0 }],
  ])("ends at the arc's end point: %s", (_label, d, options, expected) => {
    const log = record(d, options);
    const arc = log.at(-1);
    expect(arc?.call).toBe("ellipse");
    // It also starts where the moveto left the pen, so no joining line is drawn.
    const [startX = 0, startY = 0] = (log[0]?.args ?? []).map((v) => Number(v) / 1e4);
    const start = ellipseEnd(arc?.args ?? [], "start");
    expect(start.x).toBeCloseTo(startX, 3);
    expect(start.y).toBeCloseTo(startY, 3);
    const end = ellipseEnd(arc?.args ?? []);
    expect(end.x).toBeCloseTo(expected.x, 3);
    expect(end.y).toBeCloseTo(expected.y, 3);
  });

  it("scales radii too small to reach the end point up to a half ellipse", () => {
    expect(record("M0 0 A1 1 0 0 1 10 0")[1]?.args.slice(0, 4)).toEqual([
      q(5),
      0,
      q(5),
      q(5),
    ]);
  });

  it("draws an arc with a zero radius as a line", () => {
    expect(record("M0 0 A0 5 0 0 1 10 0")).toEqual([
      { call: "moveTo", args: [0, 0] },
      { call: "lineTo", args: [q(10), 0] },
    ]);
  });

  it("leaves out an arc that ends where it starts", () => {
    expect(record("M3 3 A5 5 0 0 1 3 3")).toEqual([
      { call: "moveTo", args: [q(3), q(-3)] },
    ]);
  });
});

describe("malformed path data", () => {
  it.each([
    ["a missing number", "M0 0 L10", 8],
    ["a path not starting with a moveto", "L0 0", 0],
    ["leading whitespace before a bad command", "  x", 2],
    ["an unknown command", "M0 0 L1 1e", 9],
    ["a number after closepath", "M0 0 Z 1", 7],
    ["a trailing comma", "M0 0 L1,", 8],
    ["a comma after a command letter", "M,0 0", 1],
    ["a bad arc flag", "M0 0 A5 5 0 2 1 10 0", 12],
    ["a number too large to be finite", "M1e400 0", 1],
    ["a lone sign", "M- 0", 1],
  ])("raises InvalidPathDataError at the offset: %s", (_label, d, offset) => {
    const error = thrown(d);
    expect(error).toBeInstanceOf(InvalidPathDataError);
    expect(error).toBeInstanceOf(CharadeError);
    expect((error as InvalidPathDataError).code).toBe("ERR_SCENE_INVALID_PATH_DATA");
    expect((error as InvalidPathDataError).offset).toBe(offset);
  });

  it("carries the offset, never the rejected string", () => {
    const d = "M0 0 L10 zzz-unique";
    const error = thrown(d) as InvalidPathDataError;
    expect(Object.keys(error).sort()).toEqual(["code", "name", "offset"]);
    expect(Object.values(error)).not.toContain(d);
  });

  it("issues no call before throwing", () => {
    const ctx = new RecordingContext();
    expect(() => {
      svgPath(ctx, "M0 0 L1 1 L");
    }).toThrow(InvalidPathDataError);
    expect(ctx.log).toEqual([]);
  });
});

describe("no Path2D", () => {
  it("draws every command with Path2D stubbed to throw", () => {
    const path2d = vi.fn(() => {
      throw new Error("Path2D was constructed");
    });
    vi.stubGlobal("Path2D", path2d);
    expect(
      record("M0 0 L1 1 H2 V3 C1 1 2 2 3 3 S4 4 5 5 Q1 1 2 2 T3 3 A1 1 0 0 1 9 9 Z"),
    ).toHaveLength(10);
    expect(path2d).not.toHaveBeenCalled();
  });
});
