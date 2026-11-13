import { describe, expect, it } from "vitest";

import {
  ForeignGradientError,
  NonFiniteDrawingError,
  RecordingContext,
} from "../src/check/recorder.js";
import { CharadeError, type DrawingContext } from "../src/index.js";

describe("number quantisation", () => {
  it("logs a property write, then a call, with numbers scaled by 1e4", () => {
    const ctx = new RecordingContext();
    ctx.lineWidth = 0.025;
    ctx.moveTo(0.1, 1);
    expect(ctx.log).toEqual([
      { call: "lineWidth", args: [250] },
      { call: "moveTo", args: [1000, 10000] },
    ]);
  });

  it("normalises -0 and rounds a value below half a step to 0", () => {
    const ctx = new RecordingContext();
    ctx.arc(0, -0, 0.00004, 0, Math.PI * 2);
    expect(ctx.log).toEqual([{ call: "arc", args: [0, 0, 0, 0, 62832] }]);
  });

  it("writes 0 for a negative value that rounds to zero", () => {
    const ctx = new RecordingContext();
    ctx.lineTo(-0.00004, 0);
    const [x] = ctx.log[0]?.args ?? [];
    expect(Object.is(x, 0)).toBe(true);
  });

  it.each([
    ["half a step up", 0.00005, 1],
    ["a negative half step", -0.00005, 0],
    ["a negative value", -1.23456, -12346],
    ["one", 1, 10000],
    ["a large value", 123456.7, 1234567000],
  ])("rounds %s", (_label, value, logged) => {
    const ctx = new RecordingContext();
    ctx.rotate(value);
    expect(ctx.log).toEqual([{ call: "rotate", args: [logged] }]);
  });

  it("quantises every element of an array argument", () => {
    const ctx = new RecordingContext();
    ctx.setLineDash([0.01, 0.02]);
    ctx.roundRect(0, 0, 1, 1, [0.1, 0.2]);
    expect(ctx.log).toEqual([
      { call: "setLineDash", args: [[100, 200]] },
      { call: "roundRect", args: [0, 0, 10000, 10000, [1000, 2000]] },
    ]);
  });
});

describe("non-finite arguments", () => {
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("throws on %s", (_label, value) => {
    const ctx = new RecordingContext();
    expect(() => {
      ctx.lineTo(value, 0);
    }).toThrow(NonFiniteDrawingError);
  });

  it("names the member and the argument position", () => {
    const ctx = new RecordingContext();
    let caught: unknown;
    try {
      ctx.bezierCurveTo(0, 0, 0, Number.NaN, 0, 0);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CharadeError);
    expect(caught).toMatchObject({
      code: "ERR_SCENE_NON_FINITE_DRAWING",
      call: "bezierCurveTo",
      argument: 3,
    });
  });

  it("throws on a property write and logs nothing", () => {
    const ctx = new RecordingContext();
    expect(() => {
      ctx.globalAlpha = Number.NaN;
    }).toThrow(NonFiniteDrawingError);
    expect(ctx.globalAlpha).toBe(1);
    expect(ctx.log).toEqual([]);
  });

  it("throws on a value whose scaled form overflows", () => {
    const ctx = new RecordingContext();
    expect(() => {
      ctx.scale(Number.MAX_VALUE, 1);
    }).toThrow(NonFiniteDrawingError);
  });

  it("throws on a non-finite element of an array", () => {
    const ctx = new RecordingContext();
    expect(() => {
      ctx.setLineDash([1, Number.NaN]);
    }).toThrow(NonFiniteDrawingError);
    expect(ctx.getLineDash()).toEqual([]);
  });

  it("throws on a non-finite colour stop offset", () => {
    const ctx = new RecordingContext();
    const gradient = ctx.createLinearGradient(0, 0, 1, 0);
    expect(() => {
      gradient.addColorStop(Number.NaN, "red");
    }).toThrow(NonFiniteDrawingError);
  });
});

describe("gradients", () => {
  it("logs each gradient by its creation index", () => {
    const ctx = new RecordingContext();
    const linear = ctx.createLinearGradient(0, 0, 1, 0);
    const radial = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    const conic = ctx.createConicGradient(0, 0.5, 0.5);
    radial.addColorStop(0.5, "#fff");
    ctx.fillStyle = radial;
    ctx.strokeStyle = linear;
    ctx.fillStyle = conic;
    expect(ctx.log).toEqual([
      { call: "createLinearGradient", args: [0, 0, 10000, 0] },
      { call: "createRadialGradient", args: [0, 0, 0, 0, 0, 10000] },
      { call: "createConicGradient", args: [0, 5000, 5000] },
      { call: "addColorStop", args: [{ gradient: 1 }, 5000, "#fff"] },
      { call: "fillStyle", args: [{ gradient: 1 }] },
      { call: "strokeStyle", args: [{ gradient: 0 }] },
      { call: "fillStyle", args: [{ gradient: 2 }] },
    ]);
    expect(ctx.fillStyle).toBe(conic);
    expect(ctx.strokeStyle).toBe(linear);
  });

  it("rejects a gradient another context created", () => {
    const ctx = new RecordingContext();
    const other = new RecordingContext().createLinearGradient(0, 0, 1, 0);
    let caught: unknown;
    try {
      ctx.fillStyle = other;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForeignGradientError);
    expect(caught).toMatchObject({
      code: "ERR_SCENE_FOREIGN_GRADIENT",
      call: "fillStyle",
    });
  });
});

describe("optional arguments", () => {
  it("logs only the arguments given", () => {
    const ctx = new RecordingContext();
    ctx.arc(0, 0, 1, 0, 1, true);
    ctx.fill();
    ctx.fill("evenodd");
    ctx.fillText("hi", 0, 0, undefined);
    expect(ctx.log).toEqual([
      { call: "arc", args: [0, 0, 10000, 0, 10000, true] },
      { call: "fill", args: [] },
      { call: "fill", args: ["evenodd"] },
      { call: "fillText", args: ["hi", 0, 0] },
    ]);
  });
});

/** Every method of the full interface, with arguments and the log it should leave. */
const calls: readonly (readonly [
  string,
  (ctx: DrawingContext) => unknown,
  readonly unknown[],
])[] = [
  ["save", (ctx) => ctx.save(), []],
  ["restore", (ctx) => ctx.restore(), []],
  ["reset", (ctx) => ctx.reset(), []],
  ["translate", (ctx) => ctx.translate(1, 2), [10000, 20000]],
  ["rotate", (ctx) => ctx.rotate(0.5), [5000]],
  ["scale", (ctx) => ctx.scale(2, -1), [20000, -10000]],
  [
    "transform",
    (ctx) => ctx.transform(1, 0, 0, 1, 0.5, 0.25),
    [10000, 0, 0, 10000, 5000, 2500],
  ],
  [
    "setTransform",
    (ctx) => ctx.setTransform(1, 0, 0, -1, 0, 0),
    [10000, 0, 0, -10000, 0, 0],
  ],
  ["resetTransform", (ctx) => ctx.resetTransform(), []],
  ["beginPath", (ctx) => ctx.beginPath(), []],
  ["closePath", (ctx) => ctx.closePath(), []],
  ["moveTo", (ctx) => ctx.moveTo(1, 2), [10000, 20000]],
  ["lineTo", (ctx) => ctx.lineTo(1, 2), [10000, 20000]],
  [
    "bezierCurveTo",
    (ctx) => ctx.bezierCurveTo(1, 2, 3, 4, 5, 6),
    [10000, 20000, 30000, 40000, 50000, 60000],
  ],
  [
    "quadraticCurveTo",
    (ctx) => ctx.quadraticCurveTo(1, 2, 3, 4),
    [10000, 20000, 30000, 40000],
  ],
  ["arc", (ctx) => ctx.arc(0, 0, 1, 0, 1), [0, 0, 10000, 0, 10000]],
  ["arcTo", (ctx) => ctx.arcTo(0, 0, 1, 1, 0.5), [0, 0, 10000, 10000, 5000]],
  [
    "ellipse",
    (ctx) => ctx.ellipse(0, 0, 1, 2, 0, 0, 1, false),
    [0, 0, 10000, 20000, 0, 0, 10000, false],
  ],
  ["rect", (ctx) => ctx.rect(0, 0, 1, 2), [0, 0, 10000, 20000]],
  ["roundRect", (ctx) => ctx.roundRect(0, 0, 1, 2, 0.1), [0, 0, 10000, 20000, 1000]],
  ["fill", (ctx) => ctx.fill("nonzero"), ["nonzero"]],
  ["stroke", (ctx) => ctx.stroke(), []],
  ["clip", (ctx) => ctx.clip("evenodd"), ["evenodd"]],
  ["fillRect", (ctx) => ctx.fillRect(0, 0, 1, 1), [0, 0, 10000, 10000]],
  ["strokeRect", (ctx) => ctx.strokeRect(0, 0, 1, 1), [0, 0, 10000, 10000]],
  ["clearRect", (ctx) => ctx.clearRect(0, 0, 1, 1), [0, 0, 10000, 10000]],
  [
    "createLinearGradient",
    (ctx) => ctx.createLinearGradient(0, 0, 1, 1),
    [0, 0, 10000, 10000],
  ],
  [
    "createRadialGradient",
    (ctx) => ctx.createRadialGradient(0, 0, 0, 1, 1, 1),
    [0, 0, 0, 10000, 10000, 10000],
  ],
  ["createConicGradient", (ctx) => ctx.createConicGradient(0, 1, 1), [0, 10000, 10000]],
  ["setLineDash", (ctx) => ctx.setLineDash([1]), [[10000]]],
  ["getLineDash", (ctx) => ctx.getLineDash(), []],
  ["fillText", (ctx) => ctx.fillText("a", 1, 2), ["a", 10000, 20000]],
  ["strokeText", (ctx) => ctx.strokeText("a", 1, 2, 3), ["a", 10000, 20000, 30000]],
  ["measureText", (ctx) => ctx.measureText("a"), ["a"]],
];

describe("every method", () => {
  it.each(calls)("logs %s", (name, invoke, args) => {
    const ctx = new RecordingContext();
    invoke(ctx);
    expect(ctx.log).toEqual([{ call: name, args }]);
  });
});

type PropertyName = {
  [K in keyof DrawingContext]: DrawingContext[K] extends (...args: never[]) => unknown
    ? never
    : K;
}[keyof DrawingContext];

/** Every property, its initial value, and a value to write with the log it leaves. */
const properties: readonly (readonly [
  PropertyName,
  unknown,
  (ctx: DrawingContext) => void,
  unknown,
])[] = [
  ["fillStyle", "#000000", (ctx) => (ctx.fillStyle = "red"), "red"],
  ["strokeStyle", "#000000", (ctx) => (ctx.strokeStyle = "red"), "red"],
  ["lineWidth", 1, (ctx) => (ctx.lineWidth = 2), 20000],
  ["lineCap", "butt", (ctx) => (ctx.lineCap = "round"), "round"],
  ["lineJoin", "miter", (ctx) => (ctx.lineJoin = "bevel"), "bevel"],
  ["miterLimit", 10, (ctx) => (ctx.miterLimit = 4), 40000],
  ["lineDashOffset", 0, (ctx) => (ctx.lineDashOffset = 0.5), 5000],
  ["globalAlpha", 1, (ctx) => (ctx.globalAlpha = 0.5), 5000],
  [
    "globalCompositeOperation",
    "source-over",
    (ctx) => (ctx.globalCompositeOperation = "multiply"),
    "multiply",
  ],
  ["filter", "none", (ctx) => (ctx.filter = "blur(2px)"), "blur(2px)"],
  ["shadowBlur", 0, (ctx) => (ctx.shadowBlur = 3), 30000],
  ["shadowColor", "rgba(0, 0, 0, 0)", (ctx) => (ctx.shadowColor = "#000"), "#000"],
  ["shadowOffsetX", 0, (ctx) => (ctx.shadowOffsetX = 1), 10000],
  ["shadowOffsetY", 0, (ctx) => (ctx.shadowOffsetY = -1), -10000],
  ["font", "10px sans-serif", (ctx) => (ctx.font = "20px serif"), "20px serif"],
  ["textAlign", "start", (ctx) => (ctx.textAlign = "center"), "center"],
  ["textBaseline", "alphabetic", (ctx) => (ctx.textBaseline = "top"), "top"],
  ["direction", "inherit", (ctx) => (ctx.direction = "rtl"), "rtl"],
  ["letterSpacing", "0px", (ctx) => (ctx.letterSpacing = "1px"), "1px"],
  ["wordSpacing", "0px", (ctx) => (ctx.wordSpacing = "2px"), "2px"],
  ["fontKerning", "auto", (ctx) => (ctx.fontKerning = "none"), "none"],
  ["fontStretch", "normal", (ctx) => (ctx.fontStretch = "condensed"), "condensed"],
  [
    "textRendering",
    "auto",
    (ctx) => (ctx.textRendering = "geometricPrecision"),
    "geometricPrecision",
  ],
];

describe("every property", () => {
  it.each(properties)("starts %s at the standard default", (name, initial) => {
    expect(new RecordingContext()[name]).toEqual(initial);
  });

  it.each(properties)(
    "logs a write to %s as a call",
    (name, _initial, write, logged) => {
      const ctx = new RecordingContext();
      write(ctx);
      expect(ctx.log).toEqual([{ call: name, args: [logged] }]);
    },
  );

  it.each(properties)("reads %s back as written", (name, initial, write) => {
    const ctx = new RecordingContext();
    write(ctx);
    expect(ctx[name]).not.toEqual(initial);
  });

  it("does not log a read", () => {
    const ctx = new RecordingContext();
    expect(ctx.lineWidth).toBe(1);
    expect(ctx.log).toEqual([]);
  });
});

describe("state", () => {
  it("restores what save stored", () => {
    const ctx = new RecordingContext();
    ctx.lineWidth = 2;
    ctx.setLineDash([1, 2]);
    ctx.save();
    ctx.lineWidth = 3;
    ctx.setLineDash([4]);
    ctx.restore();
    expect(ctx.lineWidth).toBe(2);
    expect(ctx.getLineDash()).toEqual([1, 2]);
  });

  it("keeps the state when restore has nothing to pop", () => {
    const ctx = new RecordingContext();
    ctx.lineWidth = 2;
    ctx.restore();
    expect(ctx.lineWidth).toBe(2);
  });

  it("returns every property to its default on reset and empties the stack", () => {
    const ctx = new RecordingContext();
    ctx.font = "20px serif";
    ctx.save();
    ctx.lineWidth = 5;
    ctx.reset();
    ctx.restore();
    expect(ctx.font).toBe("10px sans-serif");
    expect(ctx.lineWidth).toBe(1);
  });

  it("returns a copy of the dash pattern", () => {
    const ctx = new RecordingContext();
    const segments = [1, 2];
    ctx.setLineDash(segments);
    segments.push(3);
    ctx.getLineDash().push(4);
    expect(ctx.getLineDash()).toEqual([1, 2]);
  });
});

describe("the fake text measurer", () => {
  it("measures 0.6 of the pixel size per code point, ascent 0.8 and descent 0.2", () => {
    const ctx = new RecordingContext();
    ctx.font = "bold 20px sans-serif";
    expect(ctx.measureText("Hi!")).toEqual({
      width: 36,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 36,
      actualBoundingBoxAscent: 16,
      actualBoundingBoxDescent: 4,
      fontBoundingBoxAscent: 16,
      fontBoundingBoxDescent: 4,
    });
  });

  it("uses 10px when the font names no pixel size", () => {
    const ctx = new RecordingContext();
    ctx.font = "1em serif";
    expect(ctx.measureText("ab").width).toBe(12);
  });

  it("reads a fractional size", () => {
    const ctx = new RecordingContext();
    ctx.font = ".5px serif";
    expect(ctx.measureText("abcd").width).toBeCloseTo(1.2, 10);
  });

  it("counts an emoji as one code point", () => {
    expect(new RecordingContext().measureText("😀").width).toBe(6);
  });

  it("measures the empty string as zero wide", () => {
    expect(new RecordingContext().measureText("").width).toBe(0);
  });

  it.each([
    ["start", 0],
    ["left", 0],
    ["center", 6],
    ["right", 12],
    ["end", 12],
  ] as const)("puts the box left of a %s alignment point by %d", (align, left) => {
    const ctx = new RecordingContext();
    ctx.textAlign = align;
    const measured = ctx.measureText("ab");
    expect(measured.actualBoundingBoxLeft).toBe(left);
    expect(measured.actualBoundingBoxRight).toBe(12 - left);
  });
});
