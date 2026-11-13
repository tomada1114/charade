import { describe, expect, it, vi } from "vitest";

import {
  type Actor,
  AsyncBuildError,
  type Finding,
  type Scene,
  scene,
  SceneClosedError,
  type Span,
  type Stage,
  type TimelineTrack,
  UnknownRowError,
} from "../src/index.js";
import { serializeTimeline } from "../src/timeline/json.js";

/** The value `run` throws, or `undefined` when it returns. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

function trackOf(built: Scene, row = 0, index = 0): TimelineTrack {
  const track = built.timeline.rows[row]?.tracks[index];
  if (track === undefined) {
    throw new Error(`no track ${String(index)} in row ${String(row)}`);
  }
  return track;
}

function codes(built: Scene): string[] {
  return built.findings.map((finding) => finding.code);
}

function onlyFinding(built: Scene): Finding {
  expect(built.findings).toHaveLength(1);
  const [finding] = built.findings;
  if (finding === undefined) {
    throw new Error("no finding");
  }
  return finding;
}

/** A one-row scene whose single actor is handed to `act`; a 1 s wait gives it a length. */
function acting(act: (actor: Actor, stage: Stage) => void): Scene {
  return scene((stage) => {
    const actor = stage.actor();
    actor.wait(1);
    act(actor, stage);
  });
}

/** Passes a value the types reject, as a scene written in JavaScript can. */
function untyped(value: unknown): never {
  return value as never;
}

describe("scene", () => {
  it("returns frozen data marked as a charade scene", () => {
    const built = scene((stage) => {
      stage.actor().pose({ kneeR: 1.2 }, { duration: 0.5 });
    });
    expect(built.kind).toBe("charade.scene");
    expect(built.version).toBe(1);
    expect(Object.isFrozen(built)).toBe(true);
    expect(built.findings).toEqual([]);
    expect(built.truncated).toBe(false);
  });

  it("freezes the timeline and the findings all the way down", () => {
    const built = scene({ rows: 2 }, (stage) => {
      stage.actor().pose({ kneeR: 1.2 }, { duration: 0.5 });
    });
    const segment = trackOf(built).segments[0];
    expect(Object.isFrozen(built.timeline)).toBe(true);
    expect(Object.isFrozen(built.timeline.rows)).toBe(true);
    expect(Object.isFrozen(trackOf(built).segments)).toBe(true);
    expect(Object.isFrozen(segment)).toBe(true);
    expect(Object.isFrozen(segment?.data)).toBe(true);
    expect(Object.isFrozen(built.findings)).toBe(true);
    expect(Object.isFrozen(built.findings[0])).toBe(true);
  });

  it("uses a 1080 square, 30 fps, one row and seed 0 by default", () => {
    const built = scene((stage) => {
      stage.actor().wait(1);
    });
    expect(built.width).toBe(1080);
    expect(built.height).toBe(1080);
    expect(built.font).toBeNull();
    expect(built.timeline.fps).toBe(30);
    expect(built.timeline.seed).toBe(0);
    expect(built.timeline.duration).toBeNull();
    expect(built.timeline.rows).toHaveLength(1);
  });

  it("takes the options it is given", () => {
    const built = scene(
      {
        width: 1920,
        height: 1080,
        fps: 60,
        rows: 3,
        seed: 7,
        font: "Noto Sans JP",
        duration: 4.1,
      },
      () => undefined,
    );
    expect(built.width).toBe(1920);
    expect(built.height).toBe(1080);
    expect(built.font).toBe("Noto Sans JP");
    expect(built.timeline.fps).toBe(60);
    expect(built.timeline.seed).toBe(7);
    expect(built.timeline.duration).toBe(4_100_000);
    expect(built.timeline.rows).toHaveLength(3);
    expect(built.findings).toEqual([]);
  });

  it("treats an explicit undefined option as absent", () => {
    const options = untyped({ fps: undefined });
    const built = scene(options, (stage) => {
      stage.actor().wait(1);
    });
    expect(built.timeline.fps).toBe(30);
    expect(built.findings).toEqual([]);
  });

  it("runs build once, synchronously, with the stage", () => {
    const build = vi.fn<(stage: Stage) => void>();
    scene({ duration: 1 }, build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0]?.[0]).toMatchObject({ id: "row0", index: 0 });
  });

  it("lets build return a value that is not a promise", () => {
    const built = scene({ rows: 4, duration: 1 }, (stage) => stage.row(3));
    expect(built.findings).toEqual([]);
  });

  it("lets an error thrown by build through", () => {
    const failure = new Error("the author's bug");
    expect(
      thrownBy(() =>
        scene(() => {
          throw failure;
        }),
      ),
    ).toBe(failure);
  });

  it.each([
    ["a promise", (): unknown => Promise.resolve()],
    ["a rejected promise", (): unknown => Promise.reject(new Error("late"))],
    ["a thenable", (): unknown => ({ then: () => undefined })],
    [
      "a callable thenable",
      (): unknown => Object.assign(() => undefined, { then: () => undefined }),
    ],
  ])("rejects a build that returns %s", (_label, build) => {
    const error = thrownBy(() => scene(build));
    expect(error).toBeInstanceOf(AsyncBuildError);
    expect(error).toMatchObject({ code: "ERR_SCENE_ASYNC_BUILD" });
  });

  it("answers what an async build does after its await with a closed scene", async () => {
    let late: unknown;
    const build = (stage: Stage): unknown =>
      Promise.resolve().then(() => {
        try {
          stage.actor();
        } catch (error) {
          late = error;
          throw error;
        }
      });
    expect(thrownBy(() => scene(build))).toBeInstanceOf(AsyncBuildError);
    await vi.waitFor(() => {
      expect(late).toBeInstanceOf(SceneClosedError);
    });
  });

  it.each([
    ["a missing build", [{}]],
    ["a build that is not a function", [{}, "build"]],
    ["nothing at all", []],
  ])("records %s as a finding and builds an empty scene", (_label, args) => {
    const call: (...given: unknown[]) => Scene = untyped(scene);
    const built = call(...args);
    expect(codes(built)).toEqual(["ERR_SCENE_INVALID_VALUE", "ERR_SCENE_NO_DURATION"]);
    expect(built.findings.every((finding) => finding.fix !== "")).toBe(true);
    expect(built.timeline.rows).toEqual([{ tracks: [] }]);
  });

  it("records options that are not an object and uses the defaults", () => {
    const built = scene(untyped(30), (stage) => {
      stage.actor().wait(1);
    });
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_INVALID_VALUE",
      severity: "error",
    });
    expect(built.timeline.fps).toBe(30);
  });

  it("names the nearest option for an unknown one", () => {
    const built = scene(untyped({ fsp: 24 }), (stage) => {
      stage.actor().wait(1);
    });
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_UNKNOWN_OPTION",
      severity: "error",
      nearest: ["fps"],
    });
    expect(built.timeline.fps).toBe(30);
  });

  it.each([
    ["width of 0", { width: 0 }],
    ["a negative height", { height: -1080 }],
    ["a fractional fps", { fps: 29.97 }],
    ["an fps that is a string", { fps: "30" }],
    ["an unsafe fps", { fps: Number.MAX_SAFE_INTEGER + 1 }],
    ["a fractional seed", { seed: 1.5 }],
    ["a non-finite seed", { seed: Number.NaN }],
    ["a negative duration", { duration: -1 }],
    ["an infinite duration", { duration: Infinity }],
    ["a duration that is a string", { duration: "4" }],
  ])("records %s as out of range and uses the default", (_label, options) => {
    const built = scene(untyped(options), (stage) => {
      stage.actor().wait(1);
    });
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_OUT_OF_RANGE",
      severity: "error",
    });
    expect(built.width).toBe(1080);
    expect(built.height).toBe(1080);
    expect(built.timeline.fps).toBe(30);
    expect(built.timeline.seed).toBe(0);
    expect(built.timeline.duration).toBeNull();
  });

  it.each([
    ["0 rows", 0, 1],
    ["5 rows", 5, 4],
    ["a huge row count", Number.MAX_SAFE_INTEGER, 4],
    ["a fractional row count", 2.5, 1],
    ["a negative row count", -2, 1],
    ["a row count that is a string", "2", 1],
  ])("records %s as out of range and continues", (_label, rows, used) => {
    const built = scene(untyped({ rows }), () => undefined);
    expect(codes(built)).toEqual(["ERR_SCENE_OUT_OF_RANGE", "ERR_SCENE_NO_DURATION"]);
    expect(built.timeline.rows).toHaveLength(used);
  });

  it.each([
    ["an empty font", ""],
    ["a font that is not a string", 12],
  ])("records %s and uses a system font", (_label, font) => {
    const built = scene(untyped({ font }), (stage) => {
      stage.actor().wait(1);
    });
    expect(onlyFinding(built)).toMatchObject({ code: "ERR_SCENE_INVALID_VALUE" });
    expect(built.font).toBeNull();
  });

  it("stores a seed of negative zero as zero", () => {
    const built = scene({ seed: -0, duration: 1 }, () => undefined);
    expect(Object.is(built.timeline.seed, 0)).toBe(true);
  });
});

describe("scene duration", () => {
  it("is valid with no actor when a duration is set", () => {
    const built = scene({ duration: 2 }, () => undefined);
    expect(built.findings).toEqual([]);
  });

  it("records a finding for a scene with nothing in it", () => {
    const built = scene(() => undefined);
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_NO_DURATION",
      severity: "error",
    });
    expect(onlyFinding(built).fix).not.toBe("");
  });

  it("records a finding for a scene with only open-ended calls", () => {
    const built = scene((stage) => {
      stage.actor().drive({ spine: (t) => t });
      stage.draw(() => undefined);
    });
    expect(codes(built)).toEqual(["ERR_SCENE_NO_DURATION"]);
  });

  it("accepts open-ended calls when a duration is set", () => {
    const built = scene({ duration: 3 }, (stage) => {
      stage.actor().drive({ spine: (t) => t });
    });
    expect(built.findings).toEqual([]);
  });

  it("records a scene too long to count frames of", () => {
    const built = scene((stage) => {
      stage.actor().wait(9e9);
    });
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_OUT_OF_RANGE",
      severity: "error",
    });
  });
});

describe("rows", () => {
  it("returns the same handle for a row on every call", () => {
    scene({ rows: 2, duration: 1 }, (stage) => {
      expect(stage.row(1)).toBe(stage.row(1));
      expect(stage.row(0)).not.toBe(stage.row(1));
      expect(stage.row(1)).toMatchObject({ id: "row1", index: 1 });
      expect(Object.isFrozen(stage.row(1))).toBe(true);
    });
  });

  it("has a last row at index 3 on a four-row scene", () => {
    const built = scene({ rows: 4 }, (stage) => {
      stage.row(3).actor().wait(1);
    });
    expect(built.findings).toEqual([]);
    expect(trackOf(built, 3).kind).toBe("actor");
  });

  it.each([
    ["the row past the last", 4],
    ["a negative row", -1],
    ["a fractional row", 1.5],
    ["a row that is not a number", Number.NaN],
    ["a huge row", Number.MAX_SAFE_INTEGER],
  ])("fails on the line that names %s", (_label, index) => {
    let after = false;
    const error = thrownBy(() =>
      scene({ rows: 4 }, (stage) => {
        stage.row(index);
        after = true;
      }),
    );
    expect(error).toBeInstanceOf(UnknownRowError);
    expect(error).toMatchObject({ code: "ERR_SCENE_UNKNOWN_ROW", rows: 4 });
    expect(after).toBe(false);
  });

  it("fails for row 1 of a one-row scene", () => {
    const error = thrownBy(() => scene((stage) => stage.row(1)));
    expect(error).toMatchObject({ code: "ERR_SCENE_UNKNOWN_ROW", rows: 1 });
  });

  it("lets a one-row scene use the stage as its row", () => {
    const built = scene((stage) => {
      stage.actor().wait(1);
      stage.draw(() => undefined);
      stage.row(0).draw(() => undefined);
    });
    expect(built.findings).toEqual([]);
    expect(built.timeline.rows[0]?.tracks.map((track) => track.kind)).toEqual([
      "actor",
      "draw",
      "draw",
    ]);
  });

  it.each([
    ["stage.actor()", (stage: Stage): unknown => stage.actor().wait(1)],
    ["stage.draw()", (stage: Stage): unknown => stage.draw(() => undefined)],
  ])("reports %s on a two-row scene with a fix that names stage.row(i)", (_l, call) => {
    const built = scene({ rows: 2, duration: 1 }, (stage) => {
      call(stage);
    });
    const finding = onlyFinding(built);
    expect(finding).toMatchObject({
      code: "ERR_SCENE_ROW_REQUIRED",
      severity: "error",
      row: 0,
    });
    expect(finding.fix).toContain("stage.row(i)");
    // The call was still recorded, on row 0, so the rest of the scene is checked.
    expect(built.timeline.rows[0]?.tracks).toHaveLength(1);
    expect(built.timeline.rows[1]?.tracks).toHaveLength(0);
  });

  it("does not report stage.row(i) calls on a scene with several rows", () => {
    const built = scene({ rows: 2 }, (stage) => {
      stage.row(0).actor().wait(1);
      stage.row(1).actor().wait(1);
      stage.row(1).draw(() => undefined);
    });
    expect(built.findings).toEqual([]);
  });
});

describe("handles", () => {
  it("builds an actor's id from its row, kind, name and occurrence", () => {
    scene({ rows: 2, duration: 1 }, (stage) => {
      expect(stage.row(0).actor().id).toBe("row0/actor/actor/0");
      expect(stage.row(1).actor({ name: "hero" }).id).toBe("row1/actor/hero/0");
      expect(Object.isFrozen(stage.row(0))).toBe(true);
    });
  });

  it("keeps a unicode name as it is", () => {
    const built = scene((stage) => {
      stage.actor({ name: "主人公🙂" }).wait(1);
    });
    expect(trackOf(built)).toMatchObject({ name: "主人公🙂", occurrence: 0 });
  });

  it("counts drawings of one name by occurrence", () => {
    const built = scene({ duration: 1 }, (stage) => {
      stage.draw(() => undefined, { name: "dust" });
      stage.draw(() => undefined, { name: "dust" });
      stage.draw(() => undefined);
    });
    expect(
      built.timeline.rows[0]?.tracks.map((track) => [track.name, track.occurrence]),
    ).toEqual([
      ["dust", 0],
      ["dust", 1],
      ["draw", 0],
    ]);
  });

  it("reports a second actor in a row and still records it", () => {
    const built = scene((stage) => {
      stage.actor().wait(1);
      expect(stage.actor().id).toBe("row0/actor/actor/1");
    });
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_ROW_HAS_ACTOR",
      severity: "error",
      row: 0,
      target: "row0/actor/actor/1",
    });
    expect(built.timeline.rows[0]?.tracks).toHaveLength(2);
  });

  it.each([
    ["an empty actor name", (stage: Stage): unknown => stage.actor({ name: "" })],
    [
      "an actor name that is not a string",
      (stage: Stage): unknown => stage.actor(untyped({ name: 7 })),
    ],
    [
      "a drawing name that is not a string",
      (stage: Stage): unknown => stage.draw(() => undefined, untyped({ name: null })),
    ],
  ])("records %s and uses the default name", (_label, call) => {
    const built = scene({ duration: 1 }, (stage) => {
      call(stage);
    });
    expect(onlyFinding(built)).toMatchObject({ code: "ERR_SCENE_INVALID_VALUE" });
    expect(["actor", "draw"]).toContain(trackOf(built).name);
  });

  it.each([
    ["stage.actor", (stage: Stage): unknown => stage.actor()],
    ["stage.draw", (stage: Stage): unknown => stage.draw(() => undefined)],
    ["stage.row", (stage: Stage): unknown => stage.row(0)],
    ["stage.sync", (stage: Stage): unknown => stage.sync()],
  ])("throws when %s is used after scene() returned", (_label, call) => {
    let kept: Stage | undefined;
    scene({ duration: 1 }, (stage) => {
      kept = stage;
    });
    const stage = kept;
    if (stage === undefined) {
      throw new Error("build did not run");
    }
    const error = thrownBy(() => call(stage));
    expect(error).toBeInstanceOf(SceneClosedError);
    expect(error).toMatchObject({ code: "ERR_SCENE_CLOSED" });
  });

  it.each([
    [
      "row.actor",
      (stage: Stage): (() => unknown) => {
        const row = stage.row(1);
        return () => row.actor();
      },
    ],
    [
      "row.draw",
      (stage: Stage): (() => unknown) => {
        const row = stage.row(1);
        return () => row.draw(() => undefined);
      },
    ],
    [
      "actor.pose",
      (stage: Stage): (() => unknown) => {
        const actor = stage.row(0).actor();
        return () => actor.pose({ spine: 0.1 });
      },
    ],
    [
      "actor.reach",
      (stage: Stage): (() => unknown) => {
        const actor = stage.row(0).actor();
        return () => actor.reach("handR", { x: 0.2, y: 0.8 });
      },
    ],
    [
      "actor.drive",
      (stage: Stage): (() => unknown) => {
        const actor = stage.row(0).actor();
        return () => actor.drive({ spine: (t) => t });
      },
    ],
    [
      "actor.wait",
      (stage: Stage): (() => unknown) => {
        const actor = stage.row(0).actor();
        return () => actor.wait(1);
      },
    ],
  ])("throws when %s is used after scene() returned", (_label, prepare) => {
    let late: (() => unknown) | undefined;
    scene({ rows: 2, duration: 1 }, (stage) => {
      late = prepare(stage);
    });
    expect(thrownBy(late ?? (() => undefined))).toBeInstanceOf(SceneClosedError);
  });
});

describe("recording", () => {
  it("starts a second pose without at where the first ends", () => {
    const spans: Span[] = [];
    scene((stage) => {
      const a = stage.actor();
      spans.push(a.pose({ kneeR: 1.2 }, { duration: 0.5 }));
      spans.push(a.pose({ kneeR: 0 }, { duration: 0.5 }));
    });
    expect(spans[0]).toEqual({ start: 0, end: 0.5, duration: 0.5, marks: {} });
    expect(spans[1]).toEqual({ start: 0.5, end: 1, duration: 0.5, marks: {} });
    expect(Object.isFrozen(spans[1])).toBe(true);
  });

  it("stores times as integer microseconds, summed after quantising", () => {
    const built = scene((stage) => {
      const a = stage.actor();
      a.wait(0.1);
      a.wait(0.2);
      a.pose({ kneeR: 1.2 }, { duration: 0.5 });
    });
    expect(trackOf(built).segments.map(({ start, end }) => [start, end])).toEqual([
      [0, 100_000],
      [100_000, 300_000],
      [300_000, 800_000],
    ]);
  });

  it("records a pose as its channels, mode and phases", () => {
    const built = scene((stage) => {
      stage.actor().pose(
        { kneeR: 1.2, eyeOpen: 0.5 },
        {
          duration: 1,
          blend: 0.3,
          anticipation: 0.1,
          followThrough: 0.2,
          mode: "add",
        },
      );
    });
    expect(trackOf(built).segments).toEqual([
      {
        start: 0,
        end: 1_000_000,
        data: {
          kind: "pose",
          channels: { kneeR: 1.2, eyeOpen: 0.5 },
          mode: "add",
          anticipation: 100_000,
          blend: 300_000,
          followThrough: 200_000,
        },
      },
    ]);
  });

  it("copies the author's map instead of freezing or sharing it", () => {
    const channels = { kneeR: 1.2 };
    const built = scene((stage) => {
      stage.actor().pose(channels, { duration: 0.5 });
    });
    channels.kneeR = 2;
    expect(Object.isFrozen(channels)).toBe(false);
    expect(trackOf(built).segments[0]?.data).toMatchObject({
      channels: { kneeR: 1.2 },
    });
  });

  it("stores a negative zero as zero", () => {
    const built = scene((stage) => {
      const a = stage.actor();
      a.pose({ spine: -0 }, { duration: 0.5 });
      a.reach("handR", { x: -0, y: -0 });
    });
    expect(serializeTimeline(built.timeline)).not.toContain("-0");
  });

  it("serialises a scene written at depth 2 without loss", () => {
    const built = scene((stage) => {
      const a = stage.actor();
      a.pose({ kneeR: 1.2 }, { duration: 0.5 });
      a.reach("handR", { x: 0.2, y: 0.8 });
      a.wait(0.5);
    });
    expect(serializeTimeline(built.timeline)).toContain('"lossy":false');
  });

  it("serialises a scene with depth 3 or 4 functions as lossy", () => {
    const driven = scene({ duration: 1 }, (stage) => {
      stage.actor().drive({ spine: (t) => t });
    });
    const drawn = scene({ duration: 1 }, (stage) => {
      stage.draw(() => undefined);
    });
    expect(serializeTimeline(driven.timeline)).toContain('"lossy":true');
    expect(serializeTimeline(drawn.timeline)).toContain('"lossy":true');
  });

  it("keeps the function a drive or a drawing was given", () => {
    const sway = (t: number): number => Math.sin(t * 3) * 0.1;
    const dust = (): void => undefined;
    const built = scene({ duration: 1 }, (stage) => {
      stage.actor().drive({ spine: sway }, { blend: 0.1, mode: "add" });
      stage.draw(dust, { at: 0.5, duration: 0.25 });
    });
    expect(trackOf(built, 0, 0).segments).toEqual([
      {
        start: 0,
        end: null,
        data: { kind: "drive", channels: { spine: sway }, mode: "add", blend: 100_000 },
      },
    ]);
    expect(trackOf(built, 0, 1).segments).toEqual([
      { start: 500_000, end: 750_000, data: { kind: "draw", draw: dust } },
    ]);
    expect(Object.isFrozen(sway)).toBe(false);
  });

  it("returns an open-ended span for a call without a duration", () => {
    const spans: Span[] = [];
    scene({ duration: 2 }, (stage) => {
      spans.push(stage.actor().drive({ spine: (t) => t }, { at: 0.5 }));
      spans.push(stage.draw(() => undefined));
      spans.push(stage.draw(() => undefined, { at: 1, duration: 0.5 }));
    });
    expect(spans).toEqual([
      { start: 0.5, end: Infinity, duration: Infinity, marks: {} },
      { start: 0, end: Infinity, duration: Infinity, marks: {} },
      { start: 1, end: 1.5, duration: 0.5, marks: {} },
    ]);
  });

  it("shortens a drive's blend to its duration", () => {
    const built = scene((stage) => {
      stage.actor().drive({ spine: (t) => t }, { duration: 0.1 });
    });
    expect(trackOf(built).segments[0]?.data).toMatchObject({ blend: 100_000 });
  });
});

describe("findings while authoring", () => {
  it("records a call without at after an open-ended one, with a fix line", () => {
    const spans: Span[] = [];
    const built = scene({ duration: 3 }, (stage) => {
      const a = stage.actor();
      a.wait(0.5);
      a.drive({ spine: (t) => t });
      spans.push(a.pose({ kneeR: 1.2 }, { duration: 0.5 }));
    });
    const finding = onlyFinding(built);
    expect(finding).toMatchObject({
      code: "ERR_SCENE_NO_CURSOR",
      severity: "error",
      row: 0,
      target: "row0/actor/actor/0",
    });
    expect(finding.fix).not.toBe("");
    // Authoring continues from where the open-ended call started.
    expect(spans[0]).toMatchObject({ start: 0.5, end: 1 });
  });

  it("records it for a wait as well", () => {
    const built = scene({ duration: 3 }, (stage) => {
      const a = stage.actor();
      a.drive({ spine: (t) => t });
      a.wait(1);
    });
    expect(codes(built)).toEqual(["ERR_SCENE_NO_CURSOR"]);
  });

  it("accepts a call with at after an open-ended one", () => {
    const built = scene({ duration: 3 }, (stage) => {
      const a = stage.actor();
      a.drive({ spine: (t) => t });
      a.pose({ kneeR: 1.2 }, { at: 1, duration: 0.5 });
      a.reach("handR", { x: 0.2, y: 0.8 }, { at: 0 });
      a.drive({ chest: (t) => t }, { at: 2, duration: 0.5 });
    });
    expect(built.findings).toEqual([]);
  });

  it("names the nearest channels for an unknown one and drops it", () => {
    const built = acting((a) => {
      a.pose(untyped({ kneR: 1.2, spine: 0.1 }), { duration: 0.5 });
    });
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_UNKNOWN_CHANNEL",
      severity: "error",
      joint: "kneR",
      nearest: ["kneeR", "kneeL"],
      row: 0,
      target: "row0/actor/actor/0",
    });
    expect(trackOf(built).segments[1]?.data).toMatchObject({
      channels: { spine: 0.1 },
    });
  });

  it("gives no nearest name to a word unlike any channel", () => {
    const built = acting((a) => {
      a.drive(untyped({ wingspan: (t: number) => t }), { duration: 0.5 });
    });
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_UNKNOWN_CHANNEL",
      nearest: [],
    });
  });

  it.each([
    ["pose", (a: Actor): unknown => a.pose(untyped({ handR: 1 }))],
    ["drive", (a: Actor): unknown => a.drive(untyped({ handR: (t: number) => t }))],
  ])("names the chain when %s uses an effector as a channel", (_label, call) => {
    const built = scene({ duration: 1 }, (stage) => {
      call(stage.actor());
    });
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_EFFECTOR_AS_CHANNEL",
      severity: "error",
      joint: "handR",
      nearest: ["shoulderR", "elbowR"],
    });
  });

  it.each([
    ["NaN", Number.NaN],
    ["an infinity", -Infinity],
    ["a string", "1.2"],
    ["null", null],
  ])(
    "records a pose value of %s as out of range and drops the channel",
    (_l, value) => {
      const built = acting((a) => {
        a.pose(untyped({ kneeR: value, spine: 0.1 }));
      });
      expect(onlyFinding(built)).toMatchObject({
        code: "ERR_SCENE_OUT_OF_RANGE",
        joint: "kneeR",
      });
      expect(trackOf(built).segments[1]?.data).toMatchObject({
        channels: { spine: 0.1 },
      });
    },
  );

  it("records a drive value that is not a function and drops the channel", () => {
    const built = acting((a) => {
      a.drive(untyped({ spine: 0.1, chest: (t: number) => t }), { duration: 1 });
    });
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_INVALID_VALUE",
      joint: "spine",
    });
    expect(trackOf(built).segments[1]?.data).toEqual({
      kind: "drive",
      channels: { chest: expect.any(Function) as unknown },
      mode: "replace",
      blend: 200_000,
    });
  });

  it.each([
    ["pose", (a: Actor): unknown => a.pose(untyped(undefined))],
    ["pose given an array", (a: Actor): unknown => a.pose(untyped([1, 2]))],
    ["drive", (a: Actor): unknown => a.drive(untyped("spine"), { duration: 1 })],
  ])("records %s without a channel map and keeps its time", (_label, call) => {
    const built = acting((a) => {
      call(a);
    });
    expect(onlyFinding(built)).toMatchObject({ code: "ERR_SCENE_INVALID_VALUE" });
    expect(trackOf(built).segments).toHaveLength(2);
  });

  it.each([
    ["a negative at", { at: -1 }],
    ["a NaN at", { at: Number.NaN }],
    ["a string at", { at: "1" }],
    ["an infinite duration", { duration: Infinity }],
    ["a negative blend", { blend: -0.2 }],
    ["an unsafely large anticipation", { anticipation: Number.MAX_SAFE_INTEGER }],
    ["a null followThrough", { followThrough: null }],
  ])("records %s as out of range and uses the default", (_label, options) => {
    const spans: Span[] = [];
    const built = acting((a) => {
      spans.push(a.pose({ kneeR: 1.2 }, untyped(options)));
    });
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_OUT_OF_RANGE",
      severity: "error",
      target: "row0/actor/actor/0",
    });
    expect(onlyFinding(built).fix).not.toBe("");
    expect(spans[0]).toEqual({ start: 1, end: 1.2, duration: 0.2, marks: {} });
  });

  it.each([
    [
      "drive",
      (a: Actor): unknown => a.drive({ spine: (t) => t }, { at: 0, blend: -1 }),
    ],
    ["reach", (a: Actor): unknown => a.reach("handR", { x: 0, y: 1 }, { blend: -1 })],
    ["draw", (_a: Actor, s: Stage): unknown => s.draw(() => undefined, { at: -1 })],
    [
      "draw's duration",
      (_a: Actor, s: Stage): unknown => s.draw(() => undefined, { duration: -1 }),
    ],
    ["wait", (a: Actor): unknown => a.wait(-1)],
    ["a wait that is not a number", (a: Actor): unknown => a.wait(untyped("1"))],
  ])("records an out-of-range time given to %s", (_label, call) => {
    const built = acting((a, stage) => {
      call(a, stage);
    });
    expect(onlyFinding(built)).toMatchObject({ code: "ERR_SCENE_OUT_OF_RANGE" });
  });

  it.each([
    ["pose", (a: Actor): unknown => a.pose({ spine: 0.1 }, untyped({ durtion: 1 }))],
    [
      "reach",
      (a: Actor): unknown => a.reach("handR", { x: 0, y: 1 }, untyped({ mode: "add" })),
    ],
    [
      "drive",
      (a: Actor): unknown =>
        a.drive({ spine: (t) => t }, untyped({ at: 0, ease: "out" })),
    ],
    [
      "draw",
      (_a: Actor, s: Stage): unknown => s.draw(() => undefined, untyped({ layer: 1 })),
    ],
    [
      "actor",
      (_a: Actor, s: Stage): unknown =>
        s.row(0).draw(() => undefined, untyped({ nme: "x" })),
    ],
  ])("records an option %s does not have", (_label, call) => {
    const built = acting((a, stage) => {
      call(a, stage);
    });
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_UNKNOWN_OPTION",
      severity: "error",
    });
  });

  it("names the nearest option of a call", () => {
    const built = acting((a) => {
      a.pose({ spine: 0.1 }, untyped({ durtion: 1 }));
    });
    expect(onlyFinding(built).nearest).toEqual(["duration"]);
  });

  it.each([
    ["pose", (a: Actor): unknown => a.pose({ spine: 0.1 }, untyped(0.5))],
    [
      "actor",
      (_a: Actor, s: Stage): unknown => s.draw(() => undefined, untyped("dust")),
    ],
  ])("records options of %s that are not an object", (_label, call) => {
    const built = acting((a, stage) => {
      call(a, stage);
    });
    expect(onlyFinding(built)).toMatchObject({ code: "ERR_SCENE_INVALID_VALUE" });
  });

  it.each([
    ["a misspelt mode", "ad", ["add"]],
    ["a mode that is not a string", 1, []],
  ])("records %s and replaces instead", (_label, mode, nearest) => {
    const built = acting((a) => {
      a.pose({ spine: 0.1 }, untyped({ mode }));
      a.drive({ spine: (t) => t }, untyped({ mode, duration: 1 }));
    });
    expect(built.findings).toHaveLength(2);
    expect(built.findings[0]).toMatchObject({
      code: "ERR_SCENE_UNKNOWN_MODE",
      nearest,
    });
    expect(trackOf(built).segments[1]?.data).toMatchObject({ mode: "replace" });
    expect(trackOf(built).segments[2]?.data).toMatchObject({ mode: "replace" });
  });

  it.each([
    ["a misspelt effector", "handr", ["handR", "handL"]],
    ["a channel", "kneeR", []],
    ["an effector that is not a string", 3, []],
  ])(
    "records %s given to reach and keeps the call's time",
    (_label, effector, nearest) => {
      const spans: Span[] = [];
      const built = acting((a) => {
        spans.push(a.reach(untyped(effector), { x: 0.2, y: 0.8 }, { duration: 0.5 }));
      });
      expect(onlyFinding(built)).toMatchObject({
        code: "ERR_SCENE_UNKNOWN_EFFECTOR",
        severity: "error",
        nearest,
      });
      expect(spans[0]).toMatchObject({ start: 1, end: 1.5 });
      expect(trackOf(built).segments[1]).toEqual({
        start: 1_000_000,
        end: 1_500_000,
        data: { kind: "wait" },
      });
    },
  );

  it.each([
    ["no point", undefined],
    ["a point without y", { x: 1 }],
    ["a point with a NaN", { x: Number.NaN, y: 0 }],
    ["a point with an infinity", { x: 0, y: Infinity }],
    ["a point of strings", { x: "0", y: "1" }],
  ])("records a reach to %s as out of range", (_label, target) => {
    const built = acting((a) => {
      a.reach("handR", untyped(target));
    });
    expect(onlyFinding(built)).toMatchObject({ code: "ERR_SCENE_OUT_OF_RANGE" });
    expect(trackOf(built).segments[1]?.data).toEqual({ kind: "wait" });
  });

  it("records a drawing that is not a function and records no track for it", () => {
    const spans: Span[] = [];
    const built = scene({ duration: 1 }, (stage) => {
      spans.push(stage.draw(untyped("circle"), { at: 0.5, duration: 0.25 }));
    });
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_INVALID_VALUE",
      row: 0,
    });
    expect(built.timeline.rows[0]?.tracks).toEqual([]);
    expect(spans[0]).toMatchObject({ start: 0.5, end: 0.75 });
  });

  it("stops recording at twenty findings and says so", () => {
    const built = scene((stage) => {
      const a = stage.actor();
      for (let index = 0; index < 21; index += 1) {
        a.wait(-1);
      }
      a.wait(1);
    });
    expect(built.findings).toHaveLength(20);
    expect(built.truncated).toBe(true);
  });
});

describe("full-body calls", () => {
  const body = {
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

  it("warns when one starts while an earlier one is still playing", () => {
    const built = scene((stage) => {
      const a = stage.actor();
      a.pose(body, { duration: 2 });
      a.pose(body, { at: 1, duration: 2 });
    });
    expect(onlyFinding(built)).toMatchObject({
      code: "ERR_SCENE_FULL_BODY_CUT",
      severity: "warning",
      time: [1, 2],
      target: "row0/actor/actor/0",
    });
  });

  it("does not warn when they play one after the other", () => {
    const built = scene((stage) => {
      const a = stage.actor();
      a.pose(body, { duration: 2 });
      a.pose(body, { duration: 2 });
    });
    expect(built.findings).toEqual([]);
  });

  it("does not warn for a pose of some joints, or one that adds", () => {
    const built = scene((stage) => {
      const a = stage.actor();
      a.pose(body, { duration: 2 });
      a.pose({ spine: 0.4, kneeR: 1 }, { at: 1, duration: 0.5 });
      a.pose(body, { at: 1, duration: 0.5, mode: "add" });
    });
    expect(built.findings).toEqual([]);
  });
});
