import { describe, expect, it } from "vitest";

import { checkScene } from "../src/check/check.js";
import { describeState, formatState } from "../src/check/describe.js";
import { type LogEntry, RecordingContext } from "../src/check/recorder.js";
import { drawFrame } from "../src/draw/frame.js";
import {
  drawText,
  type Finding,
  type Scene,
  scene,
  type ShapeContext,
  type Span,
  type Stage,
} from "../src/index.js";

/** 100 px to a unit: one row, 2.5 units wide and high, so sizes in px are easy to read. */
const SQUARE = { width: 250, height: 250, duration: 1 };

function square(build: (stage: Stage) => void): Scene {
  return scene(SQUARE, build);
}

function record(built: Scene, frame = 0): readonly LogEntry[] {
  const ctx = new RecordingContext();
  drawFrame(ctx, built, frame);
  return ctx.log;
}

function calls(log: readonly LogEntry[], call: string): readonly LogEntry[] {
  return log.filter((entry) => entry.call === call);
}

function codes(findings: readonly Finding[]): string[] {
  return findings.map((finding) => finding.code);
}

function untyped(value: unknown): never {
  return value as never;
}

describe("speech bubbles", () => {
  // R1
  it("draws a bubble above the head with the hiragana laid out by the fake measurer", () => {
    const built = square((stage) => {
      stage.actor().say("こんにちは");
    });
    const log = record(built);
    // The fake advances 0.6 of the size per character: five at 0.16 units are 0.48
    // wide. Padding makes the bubble 0.672 by 0.344, its tail's tip 0.04 above the
    // head's top at 1.0, its body 0.12 above that.
    expect(calls(log, "measureText")).toContainEqual({
      call: "measureText",
      args: ["こんにちは"],
    });
    expect(calls(log, "moveTo").at(-1)).toEqual({
      call: "moveTo",
      args: [-2400, 11600],
    });
    expect(calls(log, "lineTo").slice(-7, -4)).toEqual([
      { call: "lineTo", args: [-640, 11600] },
      { call: "lineTo", args: [0, 10400] },
      { call: "lineTo", args: [640, 11600] },
    ]);
    expect(calls(log, "arcTo")).toHaveLength(4);
    expect(calls(log, "translate").at(-1)).toEqual({
      call: "translate",
      args: [0, 13320],
    });
    expect(calls(log, "fillText")).toEqual([
      { call: "fillText", args: ["こんにちは", 0, 0] },
    ]);
  });

  it("draws the text under a flip of its own, so y up does not mirror it", () => {
    const built = square((stage) => {
      stage.actor().say("あ");
    });
    // 0.16 units over the context's 10 px font, negated along y.
    expect(calls(record(built), "scale").at(-1)).toEqual({
      call: "scale",
      args: [160, -160],
    });
  });

  it("returns a span that lasts a reading time and moves the actor's cursor", () => {
    const spans: Span[] = [];
    const built = scene((stage) => {
      const hero = stage.actor();
      spans.push(hero.say("こんにちは"));
      spans.push(hero.pose({ neck: 0.2 }));
      spans.push(hero.say("Hi", { at: 0.5, duration: 0.25 }));
    });
    // 1 s and 0.08 s for each of five characters.
    expect(spans[0]).toMatchObject({ start: 0, end: 1.4, duration: 1.4 });
    expect(spans[1]?.start).toBe(1.4);
    expect(spans[2]).toMatchObject({ start: 0.5, end: 0.75 });
    expect(built.findings).toEqual([]);
  });

  it("keeps every bubble of one actor on one track named after it", () => {
    const built = scene((stage) => {
      const hero = stage.actor({ name: "hero" });
      hero.say("one");
      hero.say("two");
    });
    const tracks = built.timeline.rows[0]?.tracks ?? [];
    expect(tracks.map((track) => [track.kind, track.name])).toEqual([
      ["actor", "hero"],
      ["bubble", "hero"],
    ]);
    expect(tracks[1]?.segments).toHaveLength(2);
  });

  it("shows the bubble only while its span lasts", () => {
    const built = square((stage) => {
      stage.actor().say("あ", { at: 0.5, duration: 0.2 });
    });
    expect(calls(record(built, 14), "fillText")).toHaveLength(0);
    expect(calls(record(built, 15), "fillText")).toHaveLength(1);
    expect(calls(record(built, 21), "fillText")).toHaveLength(0);
  });

  it("shows the later of two bubbles that overlap in time", () => {
    const built = square((stage) => {
      const hero = stage.actor();
      hero.say("first", { at: 0, duration: 1 });
      hero.say("second", { at: 0.5, duration: 0.5 });
    });
    expect(calls(record(built, 20), "fillText")).toEqual([
      { call: "fillText", args: ["second", 0, 0] },
    ]);
  });

  it("follows the head", () => {
    const built = square((stage) => {
      const hero = stage.actor();
      hero.pose({ pelvisX: 0.5 }, { duration: 0, blend: 0 });
      hero.say("あ", { at: 0, duration: 1 });
    });
    // The tail's tip stays 0.13 above the head's centre, now at x = 0.5.
    expect(calls(record(built, 10), "lineTo").slice(-6, -5)).toEqual([
      { call: "lineTo", args: [5000, 10400] },
    ]);
  });

  it("stays inside the row's side edges when the speaker stands at one", () => {
    const built = square((stage) => {
      const hero = stage.actor();
      hero.pose({ pelvisX: 1.1 }, { duration: 0, blend: 0 });
      hero.say("こんにちは", { at: 0, duration: 1 });
    });
    // 0.672 wide, held 0.05 inside the edge at 1.25: its left corner starts at 0.528.
    expect(calls(record(built, 10), "moveTo").at(-1)).toEqual({
      call: "moveTo",
      args: [6240, 11600],
    });
    expect(codes(checkScene(built).findings)).toEqual([]);
  });

  it("wraps at twelve sizes by default and at the width given", () => {
    const built = square((stage) => {
      const hero = stage.actor();
      // 0.096 units a character: twelve sizes, 1.92 units, hold twenty of them.
      hero.say("aaaaaaaaa bbbbbbbbb ccccccccc", { at: 0, duration: 0.5 });
      hero.say("one two", { at: 0.5, duration: 0.5, width: 0.4 });
    });
    expect(calls(record(built, 0), "fillText").map((entry) => entry.args[0])).toEqual([
      "aaaaaaaaa bbbbbbbbb",
      "ccccccccc",
    ]);
    expect(calls(record(built, 20), "fillText").map((entry) => entry.args[0])).toEqual([
      "one",
      "two",
    ]);
  });

  it("breaks Japanese between characters, never before a closing mark", () => {
    const built = square((stage) => {
      stage.actor().say("あいう。「えお」か", { width: 0.3 });
    });
    // Three characters fit in 0.3 units; 。 stays with う, 「 with え and 」 with お.
    expect(calls(record(built), "fillText").map((entry) => entry.args[0])).toEqual([
      "あい",
      "う。",
      "「え",
      "お」か",
    ]);
  });

  it.each([
    ["an empty string", ""],
    ["only spaces", "  \n "],
    ["a number", 5],
  ])("records %s as a finding and a wait", (_label, text) => {
    const spans: Span[] = [];
    const built = scene({ duration: 1 }, (stage) => {
      spans.push(stage.actor().say(untyped(text)));
    });
    expect(codes(built.findings)).toEqual(["ERR_SCENE_INVALID_VALUE"]);
    expect(spans[0]).toMatchObject({ start: 0, end: 0 });
    expect(built.timeline.rows[0]?.tracks.map((track) => track.kind)).toEqual([
      "actor",
    ]);
  });

  it.each([
    ["a size of 0", { size: 0 }, "ERR_SCENE_OUT_OF_RANGE"],
    ["a negative width", { width: -1 }, "ERR_SCENE_OUT_OF_RANGE"],
    ["a size that is not a number", { size: "big" }, "ERR_SCENE_OUT_OF_RANGE"],
    ["an unknown option", { colour: "red" }, "ERR_SCENE_UNKNOWN_OPTION"],
  ])("records %s as a finding and uses the default", (_label, options, code) => {
    const built = scene((stage) => {
      stage.actor().say("あ", untyped(options));
    });
    expect(codes(built.findings)).toEqual([code]);
    expect(built.timeline.rows[0]?.tracks[1]?.segments[0]?.data).toMatchObject({
      size: 0.16,
      width: 1.92,
    });
  });

  it("reports a bubble whose speaker cannot be posed, for the frames it is shown", () => {
    const built = square((stage) => {
      const hero = stage.actor();
      hero.drive(
        (t) => {
          if (t > 0.5) {
            throw new Error("no pose");
          }
          return { neck: 0 };
        },
        { duration: 1 },
      );
      hero.say("あ", { at: 0, duration: 1 });
    });
    const failed = checkScene(built).findings.filter(
      (finding) => finding.target === "row0/bubble/actor/0",
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      code: "ERR_SCENE_DRAWING_FAILED",
      severity: "error",
      frames: [16, 29],
    });
  });
});

describe("labels", () => {
  it("is open-ended without a duration and does not make the scene longer", () => {
    const spans: Span[] = [];
    const built = scene((stage) => {
      spans.push(stage.row(0).label("Before", { at: 0 }));
      stage.actor().wait(1);
    });
    expect(spans[0]).toMatchObject({ start: 0, end: Infinity, duration: Infinity });
    expect(built.timeline.rows[0]?.tracks[0]).toMatchObject({
      kind: "label",
      name: "label",
      segments: [{ start: 0, end: null }],
    });
    expect(built.findings).toEqual([]);
    // One second at 30 fps: the label's frames end with the actor's.
    expect(calls(record(built, 30), "fillText")).toHaveLength(1);
  });

  it("lengthens the scene when it has a duration", () => {
    const built = scene((stage) => {
      stage.label("Before", { at: 1, duration: 2, name: "title" });
    });
    expect(built.findings).toEqual([]);
    expect(describeState(built, 89).rows[0]?.texts).toEqual([
      { id: "row0/label/title/0", text: "Before" },
    ]);
    expect(describeState(built, 29).rows[0]?.texts).toEqual([]);
  });

  it("draws centred near the top of the row, in ink over a paper halo", () => {
    const log = record(
      square((stage) => {
        stage.label("Before");
      }),
    );
    expect(calls(log, "translate").at(-1)).toEqual({
      call: "translate",
      args: [0, 20000],
    });
    expect(calls(log, "textAlign").at(-1)?.args).toEqual(["center"]);
    expect(calls(log, "strokeText")).toEqual([
      { call: "strokeText", args: ["Before", 0, 0] },
    ]);
    expect(calls(log, "fillText")).toEqual([
      { call: "fillText", args: ["Before", 0, 0] },
    ]);
    expect(log.findLast((entry) => entry.call === "fillStyle")?.args).toEqual([
      "#111111",
    ]);
  });

  it("puts each line of a multi-line label 1.35 sizes below the last", () => {
    const log = record(
      square((stage) => {
        stage.label("one\ntwo", { x: -1, y: 1, size: 0.2, align: "left" });
      }),
    );
    expect(calls(log, "translate").at(-1)?.args).toEqual([-10000, 10000]);
    expect(calls(log, "textAlign").at(-1)?.args).toEqual(["left"]);
    // In the context's 10 px font a line is 13.5 px: half above the middle, half below.
    expect(calls(log, "fillText")).toEqual([
      { call: "fillText", args: ["one", 0, -67500] },
      { call: "fillText", args: ["two", 0, 67500] },
    ]);
  });

  it("wraps at the width given", () => {
    const log = record(
      square((stage) => {
        stage.label("one two three", { width: 0.7 });
      }),
    );
    expect(calls(log, "fillText").map((entry) => entry.args[0])).toEqual([
      "one two",
      "three",
    ]);
  });

  it.each([
    ["an x that is not finite", { x: Infinity }, "ERR_SCENE_OUT_OF_RANGE"],
    ["a y that is not a number", { y: "top" }, "ERR_SCENE_OUT_OF_RANGE"],
    ["a size of 0", { size: 0 }, "ERR_SCENE_OUT_OF_RANGE"],
    ["an unknown alignment", { align: "centre" }, "ERR_SCENE_INVALID_VALUE"],
    ["an alignment that is not a string", { align: 1 }, "ERR_SCENE_INVALID_VALUE"],
    ["an empty name", { name: "" }, "ERR_SCENE_INVALID_VALUE"],
  ])("records %s as a finding and uses the default", (_label, options, code) => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.label("Before", untyped(options));
    });
    expect(codes(built.findings)).toEqual([code]);
    expect(built.timeline.rows[0]?.tracks[0]).toMatchObject({
      name: "label",
      segments: [{ data: { x: 0, y: 2, size: 0.16, align: "center", width: null } }],
    });
  });

  it("names the nearest alignment", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.label("Before", untyped({ align: "centre" }));
    });
    expect(built.findings[0]?.nearest).toEqual(["center"]);
  });

  it("records no track for text that shows nothing", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.label(untyped(undefined));
    });
    expect(codes(built.findings)).toEqual(["ERR_SCENE_INVALID_VALUE"]);
    expect(built.timeline.rows[0]?.tracks).toEqual([]);
  });

  it("asks for a row on a scene with more than one", () => {
    const built = scene({ rows: 2, duration: 1 }, (stage) => {
      stage.label("Before");
      stage.row(1).label("After");
    });
    expect(codes(built.findings)).toEqual(["ERR_SCENE_ROW_REQUIRED"]);
    expect(built.timeline.rows.map((row) => row.tracks.length)).toEqual([1, 1]);
  });

  it("lists the text a frame shows in its description", () => {
    const built = square((stage) => {
      stage.label("Before");
      stage.actor().say("こんにちは", { duration: 0.5 });
    });
    expect(formatState(describeState(built, 0))).toContain(
      '  text row0/label/label/0: "Before"\n  text row0/bubble/actor/0: "こんにちは"\n',
    );
    expect(formatState(describeState(built, 20))).not.toContain("bubble");
  });

  it("does not call a row with only a label empty", () => {
    const built = square((stage) => {
      stage.label("Before");
    });
    expect(formatState(describeState(built, 0))).not.toContain("empty");
  });

  it("draws nothing for a hand-built track without text", () => {
    const built = square((stage) => {
      stage.label("Before");
    });
    const bare = {
      ...built,
      timeline: {
        ...built.timeline,
        rows: [
          {
            tracks: [
              {
                kind: "label",
                name: "label",
                occurrence: 0,
                segments: [
                  { start: 0, end: null, data: { kind: "label" } },
                  { start: 0, end: null, data: null },
                ],
              },
              {
                kind: "bubble",
                name: "ghost",
                occurrence: 0,
                segments: [
                  {
                    start: 0,
                    end: null,
                    data: { kind: "say", text: "あ", actor: { name: "ghost" } },
                  },
                ],
              },
              {
                kind: "bubble",
                name: "none",
                occurrence: 0,
                segments: [{ start: 0, end: null, data: { kind: "say", text: "あ" } }],
              },
            ],
          },
        ],
      },
    };
    expect(calls(record(bare), "fillText")).toEqual([]);
    expect(checkScene(bare).findings).toEqual([]);
  });

  it("fills in what a hand-built label leaves out", () => {
    const built = square((stage) => {
      stage.label("Before");
    });
    const sparse = {
      ...built,
      timeline: {
        ...built.timeline,
        rows: [
          {
            tracks: [
              {
                kind: "label",
                name: "label",
                occurrence: 0,
                segments: [
                  {
                    start: 0,
                    end: null,
                    data: { kind: "label", text: "Before", align: "right" },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const log = record(sparse);
    expect(calls(log, "translate").at(-1)?.args).toEqual([0, 20000]);
    expect(calls(log, "textAlign").at(-1)?.args).toEqual(["right"]);
  });
});

describe("text checks", () => {
  // R2, and the boundary: 12 px is not reported, one pixel below is.
  it.each([
    { label: "at the threshold", size: 0.12, reported: false },
    { label: "one pixel below it", size: 0.11, reported: true },
  ])("a label $label: reported $reported", ({ size, reported }) => {
    const built = square((stage) => {
      stage.label("Before", { size });
    });
    const { findings } = checkScene(built);
    expect(codes(findings)).toEqual(reported ? ["ERR_CHECK_TEXT_TOO_SMALL"] : []);
  });

  // R2
  it("reports text below the threshold with the size it measured", () => {
    const built = square((stage) => {
      stage.label("Before", { size: 0.11, at: 0.5 });
    });
    const { findings } = checkScene(built);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "ERR_CHECK_TEXT_TOO_SMALL",
      severity: "warning",
      row: 0,
      target: "row0/label/label/0",
      frames: [15, 30],
      measured: { size: 11, min: 12 },
    });
    expect(findings[0]?.fix).toContain("0.12 units");
  });

  it("measures the size at the output: the same label is too small on four rows", () => {
    const built = scene({ width: 250, height: 250, rows: 4, duration: 1 }, (stage) => {
      stage.row(2).actor().say("こんにちは", { size: 0.4 });
    });
    // A row is 62.5 px high, 25 px to a unit: 0.4 units are 10 px.
    expect(checkScene(built).findings[0]).toMatchObject({
      code: "ERR_CHECK_TEXT_TOO_SMALL",
      row: 2,
      target: "row2/bubble/actor/0",
      measured: { size: 10, min: 12 },
    });
  });

  it("names a size that clears the check when the threshold is not a round number", () => {
    const built = scene({ width: 700, height: 700, duration: 1 }, (stage) => {
      stage.label("Before", { size: 0.04 });
    });
    // 280 px to a unit: 12 px are 0.042857… units, which 0.042 would still miss.
    expect(checkScene(built).findings[0]?.fix).toContain("0.043 units");
  });

  // R3
  it("reports a label whose box extends past the row's visible area", () => {
    const built = square((stage) => {
      // Five characters at 0.096 units: 0.48 wide, so its right edge is at 1.44.
      stage.label("abcde", { x: 1.2 });
    });
    const { findings } = checkScene(built);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "ERR_CHECK_OFF_FRAME",
      severity: "warning",
      row: 0,
      target: "row0/label/label/0",
      frames: [0, 30],
    });
    expect(findings[0]?.measured?.["overshoot"]).toBeCloseTo(0.19, 10);
  });

  it.each([
    { label: "left-aligned at the left edge", options: { x: -1.25, align: "left" } },
    { label: "right-aligned at the right edge", options: { x: 1.25, align: "right" } },
    { label: "touching the top", options: { y: 2.092 } },
  ] as const)("does not report a label $label", ({ options }) => {
    const built = square((stage) => {
      stage.label("abcde", options);
    });
    expect(checkScene(built).findings).toEqual([]);
  });

  it("reports a bubble pushed past the top of its row", () => {
    const built = square((stage) => {
      const hero = stage.actor();
      hero.pose({ pelvisY: 0.9 }, { duration: 0, blend: 0 });
      hero.say("あ", { at: 0, duration: 1 });
    });
    expect(
      checkScene(built).findings.map((finding) => [finding.code, finding.target]),
    ).toContainEqual(["ERR_CHECK_OFF_FRAME", "row0/bubble/actor/0"]);
  });

  // The actor/text overlap check of the computed checks, end to end.
  it("reports an actor that stands behind a label", () => {
    const built = square((stage) => {
      stage.actor().wait(1);
      stage.label("Before", { y: 0.9, at: 0.5 });
    });
    const { findings } = checkScene(built);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "ERR_CHECK_TEXT_OVERLAP",
      severity: "warning",
      row: 0,
      target: "row0/actor/actor/0",
      frames: [15, 30],
    });
    expect(findings[0]?.message).toContain("row0/label/label/0");
  });

  it("keeps the bubble out of reach of its speaker's raised hand", () => {
    const built = square((stage) => {
      const hero = stage.actor();
      hero.say("こんにちは", { duration: 1 });
      hero.reach("handR", { x: 0.1, y: 1.3 }, { at: 0, duration: 1, blend: 0 });
    });
    expect(checkScene(built).findings).toEqual([]);
  });

  it("does not report a label clear of the actor", () => {
    const built = square((stage) => {
      stage.actor().say("こんにちは", { duration: 1 });
      stage.label("Before");
    });
    expect(checkScene(built).findings).toEqual([]);
  });

  it("measures with the context it is given", () => {
    const built = square((stage) => {
      stage.label("abcde", { x: 1 });
    });
    const wide = new RecordingContext();
    wide.font = "5px sans-serif";
    // The fake's advance is 0.6 of the font size whatever the size, so the width is
    // unchanged; a measurer three times as wide pushes the label off the frame.
    expect(checkScene(built, { measurer: wide }).findings).toEqual([]);
    const { findings } = checkScene(built, {
      measurer: {
        font: "10px sans-serif",
        measureText: (text) => {
          const measured = wide.measureText(text);
          return { ...measured, width: measured.width * 6 };
        },
      },
    });
    expect(codes(findings)).toEqual(["ERR_CHECK_OFF_FRAME"]);
  });

  it("reports findings about the machine after the scene's own", () => {
    const built = scene(untyped({ duration: 1, nope: 1 }), (stage: Stage) => {
      stage.label("abcde", { x: 1.2 });
    });
    const machine: Finding = {
      code: "ERR_ENV_FONT_MISSING",
      severity: "warning",
      message: "no font",
      fix: "install one",
    };
    expect(codes(checkScene(built, { environment: [machine] }).findings)).toEqual([
      "ERR_SCENE_UNKNOWN_OPTION",
      "ERR_ENV_FONT_MISSING",
      "ERR_CHECK_OFF_FRAME",
    ]);
  });
});

describe("drawText", () => {
  function drawn(draw: (ctx: ShapeContext) => void): readonly LogEntry[] {
    return record(
      square((stage) => {
        stage.draw(draw);
      }),
    );
  }

  it("draws text the right way up in a free drawing, centred on the origin", () => {
    const log = drawn((ctx) => {
      drawText(ctx, "止まれ");
    });
    expect(calls(log, "translate").at(-1)?.args).toEqual([0, 0]);
    expect(calls(log, "scale").at(-1)?.args).toEqual([160, -160]);
    expect(calls(log, "textAlign").at(-1)?.args).toEqual(["center"]);
    expect(calls(log, "textBaseline").at(-1)?.args).toEqual(["middle"]);
    expect(calls(log, "fillText")).toEqual([
      { call: "fillText", args: ["止まれ", 0, 0] },
    ]);
    expect(calls(log, "strokeText")).toEqual([]);
  });

  it("takes a point, a size, an alignment and a wrapping width", () => {
    const log = drawn((ctx) => {
      drawText(ctx, "one two", { x: 0.5, y: 1, size: 0.1, align: "right", width: 0.2 });
    });
    expect(calls(log, "translate").at(-1)?.args).toEqual([5000, 10000]);
    expect(calls(log, "scale").at(-1)?.args).toEqual([100, -100]);
    expect(calls(log, "textAlign").at(-1)?.args).toEqual(["right"]);
    expect(calls(log, "fillText").map((entry) => entry.args[0])).toEqual([
      "one",
      "two",
    ]);
  });

  it("returns the size of the block it drew", () => {
    const sizes: unknown[] = [];
    drawn((ctx) => {
      sizes.push(drawText(ctx, "abcde\nab", { size: 0.1 }));
    });
    // Five characters at 0.06 units, and two lines of 0.135.
    expect(sizes).toHaveLength(1);
    expect(sizes[0]).toMatchObject({ width: expect.closeTo(0.3, 10) as number });
    expect(sizes[0]).toMatchObject({ height: expect.closeTo(0.27, 10) as number });
  });

  it("leaves the context's state as it found it", () => {
    const log = drawn((ctx) => {
      drawText(ctx, "a");
    });
    const from = log.findLastIndex((entry) => entry.call === "translate");
    expect(log[from - 1]?.call).toBe("save");
    expect(log.slice(from).map((entry) => entry.call)).toContain("restore");
  });

  it("uses the pixel size of the font the frame was given", () => {
    const built = square((stage) => {
      stage.draw((ctx) => {
        drawText(ctx, "a");
      });
    });
    const ctx = new RecordingContext();
    drawFrame(ctx, { ...built, textFont: '"Some Font", sans-serif' }, 0);
    expect(calls(ctx.log, "font")).toEqual([
      { call: "font", args: ['100px "Some Font", sans-serif'] },
    ]);
    // 0.16 units over a 100 px font.
    expect(calls(ctx.log, "scale").at(-1)?.args).toEqual([16, -16]);
  });

  it("draws nothing on a context without text members", () => {
    const seen: string[] = [];
    const bare = new Proxy(
      {},
      {
        has: () => false,
        get: (_target, key) => {
          seen.push(String(key));
          return undefined;
        },
      },
    );
    expect(drawText(untyped(bare), "a")).toEqual({ width: 0, height: 0 });
    expect(seen).toEqual([]);
  });
});
