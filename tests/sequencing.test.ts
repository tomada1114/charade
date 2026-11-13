import { describe, expect, it } from "vitest";

import {
  type Actor,
  type Moment,
  type Scene,
  scene,
  type Span,
  type Timeline,
} from "../src/index.js";
import { poseAtFrame } from "../src/rig/compose.js";
import { forwardKinematics } from "../src/rig/kinematics.js";
import type { Pose } from "../src/rig/rig.js";
import { parseTimeline, serializeTimeline } from "../src/timeline/json.js";
import { randomSource } from "../src/timeline/random.js";

/** The rest pose, written out: every angle and offset 0, eyes open, mouth normal. */
const REST = {
  pelvis: 0,
  spine: 0,
  chest: 0,
  neck: 0,
  shoulderL: 0,
  shoulderR: 0,
  elbowL: 0,
  elbowR: 0,
  hipL: 0,
  hipR: 0,
  kneeL: 0,
  kneeR: 0,
  ankleL: 0,
  ankleR: 0,
  pelvisX: 0,
  pelvisY: 0,
  eyeOpen: 1,
  gazeX: 0,
  gazeY: 0,
  browHeight: 0,
  browTilt: 0,
  mouthCurve: 0,
  mouthOpen: 0,
  mouthWidth: 1,
};

/** The pose of a track at `frame`. */
function poseOf(timeline: Timeline, frame: number, row = 0, index = 0): Pose {
  const track = timeline.rows[row]?.tracks[index];
  if (track === undefined) {
    throw new Error(`no track ${String(index)} in row ${String(row)}`);
  }
  return poseAtFrame(timeline, row, track, frame);
}

/**
 * A one-actor scene at 100 fps, so frame `n` is `n` hundredths of a second, and the
 * actor's pose at each of `frames`.
 */
function play(act: (actor: Actor) => void): (frame: number) => Pose {
  const built = scene({ fps: 100, duration: 10 }, (stage) => {
    act(stage.actor());
  });
  expect(built.findings).toEqual([]);
  return (frame) => poseOf(built.timeline, frame);
}

describe("the cursor", () => {
  it("plays consecutive calls in order", () => {
    const spans: Span[] = [];
    scene((stage) => {
      const a = stage.actor();
      spans.push(a.pose({ kneeR: 1.2 }, { duration: 0.5 }));
      spans.push(a.reach("handR", { x: 0.2, y: 0.7 }, { duration: 0.25 }));
      spans.push(a.drive((t) => ({ spine: t }), { duration: 1 }));
      spans.push(a.wait(0.25));
      spans.push(a.pose({ kneeR: 0 }, { duration: 0.5 }));
    });
    expect(spans.map((span) => [span.start, span.end])).toEqual([
      [0, 0.5],
      [0.5, 0.75],
      [0.75, 1.75],
      [1.75, 2],
      [2, 2.5],
    ]);
  });

  it("takes at as absolute scene time", () => {
    const spans: Span[] = [];
    scene((stage) => {
      const a = stage.actor();
      a.wait(3);
      spans.push(a.pose({ kneeR: 1.2 }, { at: 1.2, duration: 0.5 }));
      spans.push(a.pose({ kneeR: 1.2 }, { at: 0, duration: 0.5 }));
    });
    expect(spans).toEqual([
      { start: 1.2, end: 1.7, duration: 0.5, marks: {} },
      { start: 0, end: 0.5, duration: 0.5, marks: {} },
    ]);
  });

  it("is not pulled back by a call that ends earlier", () => {
    const spans: Span[] = [];
    scene((stage) => {
      const a = stage.actor();
      a.pose({ kneeR: 1.2 }, { duration: 2 });
      a.pose({ spine: 0.2 }, { at: 0.5, duration: 0.5 });
      spans.push(a.pose({ kneeR: 0 }, { duration: 0.5 }));
    });
    expect(spans[0]).toMatchObject({ start: 2, end: 2.5 });
  });

  it("moves past a call placed later with at", () => {
    const spans: Span[] = [];
    scene((stage) => {
      const a = stage.actor();
      a.pose({ kneeR: 1.2 }, { at: 3, duration: 0.5 });
      spans.push(a.wait(1));
    });
    expect(spans[0]).toMatchObject({ start: 3.5, end: 4.5 });
  });

  it("gives a pose the length of its arrival by default", () => {
    const spans: Span[] = [];
    scene((stage) => {
      const a = stage.actor();
      spans.push(a.pose({ kneeR: 1.2 }));
      spans.push(a.pose({ kneeR: 0 }, { blend: 0.5 }));
      spans.push(a.pose({ kneeR: 1 }, { anticipation: 0.1, followThrough: 0.1 }));
      spans.push(a.reach("handR", { x: 0.2, y: 0.7 }));
    });
    expect(spans.map((span) => [span.start, span.end])).toEqual([
      [0, 0.2],
      [0.2, 0.7],
      [0.7, 1.1],
      [1.1, 1.3],
    ]);
  });

  it("waits zero seconds without moving", () => {
    const spans: Span[] = [];
    scene({ duration: 1 }, (stage) => {
      spans.push(stage.actor().wait(0));
    });
    expect(spans[0]).toEqual({ start: 0, end: 0, duration: 0, marks: {} });
  });

  it("extends the scene by a trailing wait", () => {
    const built = scene((stage) => {
      const a = stage.actor();
      a.pose({ kneeR: 1.2 }, { duration: 0.5 });
      a.wait(1);
    });
    expect(built.timeline.rows[0]?.tracks[0]?.segments.at(-1)).toEqual({
      start: 500_000,
      end: 1_500_000,
      data: { kind: "wait" },
    });
  });

  it("shares one clock across rows", () => {
    const spans: Span[] = [];
    const built = scene({ rows: 2 }, (stage) => {
      const a = stage.row(0).actor();
      const b = stage.row(1).actor();
      const thrown = a.pose({ shoulderR: 2 }, { at: 1, duration: 0.5 });
      spans.push(b.pose({ neck: 0.3 }, { at: thrown.end }));
    });
    expect(built.findings).toEqual([]);
    expect(spans[0]).toMatchObject({ start: 1.5, end: 1.7 });
  });
});

describe("stage.sync", () => {
  it("moves every actor's cursor to the latest end in any row", () => {
    const spans: Span[] = [];
    let synced = -1;
    scene({ rows: 3 }, (stage) => {
      const a = stage.row(0).actor();
      const b = stage.row(1).actor();
      a.wait(2);
      b.wait(0.5);
      stage.row(2).draw(() => undefined, { at: 3, duration: 1 });
      synced = stage.sync();
      spans.push(a.wait(1), b.wait(1));
    });
    expect(synced).toBe(4);
    expect(spans.map((span) => span.start)).toEqual([4, 4]);
  });

  it("returns 0 when nothing has an end", () => {
    let synced = -1;
    scene({ duration: 1 }, (stage) => {
      stage.actor().drive((t) => ({ spine: t }));
      stage.draw(() => undefined);
      synced = stage.sync();
    });
    expect(synced).toBe(0);
  });

  it("does not move a cursor back", () => {
    const spans: Span[] = [];
    scene((stage) => {
      const a = stage.actor();
      a.wait(2);
      stage.sync();
      stage.sync();
      spans.push(a.wait(1));
    });
    expect(spans[0]).toMatchObject({ start: 2, end: 3 });
  });

  it("does not give an actor with an open-ended call a cursor", () => {
    const spans: Span[] = [];
    const built = scene({ rows: 2 }, (stage) => {
      const a = stage.row(0).actor();
      const b = stage.row(1).actor();
      a.drive((t) => ({ spine: t }));
      b.wait(2);
      stage.sync();
      spans.push(a.pose({ kneeR: 1.2 }, { duration: 0.5 }));
    });
    expect(built.findings.map((finding) => finding.code)).toEqual([
      "ERR_SCENE_NO_CURSOR",
    ]);
    expect(spans[0]).toMatchObject({ start: 2, end: 2.5 });
  });
});

describe("the composed pose", () => {
  it("is the rest pose before anything starts", () => {
    const at = play((a) => {
      a.pose({ kneeR: 1.2 }, { at: 1, duration: 0.5 });
    });
    expect(at(0)).toEqual(REST);
    expect(at(99)).toEqual(REST);
  });

  it("overrides only the joints a later drive names over an earlier pose", () => {
    const at = play((a) => {
      a.pose({ spine: 0.4, kneeR: 1.2, hipR: 1 }, { duration: 2 });
      a.drive(() => ({ spine: 0.1 }), { at: 0.5, duration: 1 });
    });
    expect(at(40)).toEqual({ ...REST, spine: 0.4, kneeR: 1.2, hipR: 1 });
    expect(at(100)).toEqual({ ...REST, spine: 0.1, kneeR: 1.2, hipR: 1 });
    expect(at(200)).toEqual({ ...REST, spine: 0.4, kneeR: 1.2, hipR: 1 });
  });

  it("blends a pose in over 0.2 s by default", () => {
    const at = play((a) => {
      a.pose({ kneeR: 1.2 }, { duration: 0.5 });
      a.pose({ kneeR: 0 }, { duration: 0.5 });
    });
    expect(at(10).kneeR).toBeCloseTo(0.6, 12);
    expect(at(20).kneeR).toBe(1.2);
    expect(at(50).kneeR).toBe(1.2);
    expect(at(60).kneeR).toBeCloseTo(0.6, 12);
    expect(at(70).kneeR).toBe(0);
    expect(at(100).kneeR).toBe(0);
  });

  it("holds a pose after its call ends", () => {
    const at = play((a) => {
      a.pose({ kneeR: 1.2 }, { duration: 0.5 });
      a.wait(1);
    });
    expect(at(150)).toEqual({ ...REST, kneeR: 1.2 });
    expect(at(1000)).toEqual({ ...REST, kneeR: 1.2 });
  });

  it("keeps a channel a later pose does not name", () => {
    const at = play((a) => {
      a.pose({ kneeR: 1.2 }, { duration: 0.5 });
      a.pose({ hipR: 1 }, { duration: 0.5 });
    });
    expect(at(100)).toEqual({ ...REST, kneeR: 1.2, hipR: 1 });
  });

  it("blends in over the blend option, easing in and out", () => {
    const at = play((a) => {
      a.pose({ kneeR: 1 }, { blend: 1 });
    });
    expect(at(25).kneeR).toBeCloseTo(0.15625, 12);
    expect(at(50).kneeR).toBeCloseTo(0.5, 12);
    expect(at(75).kneeR).toBeCloseTo(0.84375, 12);
    expect(at(100).kneeR).toBe(1);
  });

  it("snaps with a blend of 0", () => {
    const at = play((a) => {
      a.pose({ kneeR: 1 }, { at: 0.5, blend: 0, duration: 0.5 });
    });
    expect(at(49).kneeR).toBe(0);
    expect(at(50).kneeR).toBe(1);
  });

  it("snaps and holds with a duration of 0", () => {
    const at = play((a) => {
      a.pose({ kneeR: 1 }, { at: 0.5, duration: 0 });
    });
    expect(at(49).kneeR).toBe(0);
    expect(at(50).kneeR).toBe(1);
    expect(at(300).kneeR).toBe(1);
  });

  it("shortens the blend to a shorter duration", () => {
    const at = play((a) => {
      a.pose({ kneeR: 1 }, { duration: 0.1 });
    });
    expect(at(5).kneeR).toBeCloseTo(0.5, 12);
    expect(at(10).kneeR).toBe(1);
  });

  it("compares a frame with a segment's start exactly", () => {
    // 0.1 s is frame 3 at 30 fps; as floats, 3 / 30 and 0.1 are not the same number.
    const built = scene({ fps: 30, duration: 1 }, (stage) => {
      stage.actor().pose({ kneeR: 1 }, { at: 0.1, blend: 0, duration: 0.2 });
    });
    expect(poseOf(built.timeline, 2).kneeR).toBe(0);
    expect(poseOf(built.timeline, 3).kneeR).toBe(1);
  });

  it("winds up before a pose and overshoots after it", () => {
    const at = play((a) => {
      a.pose({ kneeR: 1 }, { anticipation: 0.2, blend: 0.2, followThrough: 0.2 });
    });
    expect(at(10).kneeR).toBeCloseTo(-0.1, 12);
    expect(at(20).kneeR).toBeCloseTo(0, 12);
    expect(at(30).kneeR).toBeCloseTo(0.5, 12);
    expect(at(40).kneeR).toBe(1);
    expect(at(50).kneeR).toBeCloseTo(1.1, 12);
    expect(at(60).kneeR).toBe(1);
  });

  it("shortens all three phases in proportion to a shorter duration", () => {
    const at = play((a) => {
      a.pose(
        { kneeR: 1 },
        { anticipation: 0.2, blend: 0.4, followThrough: 0.2, duration: 0.4 },
      );
    });
    expect(at(5).kneeR).toBeCloseTo(-0.1, 12);
    expect(at(20).kneeR).toBeCloseTo(0.5, 12);
    expect(at(35).kneeR).toBeCloseTo(1.1, 12);
    expect(at(40).kneeR).toBe(1);
  });

  it("lets the later-recorded call win while two overlap", () => {
    const at = play((a) => {
      a.pose({ spine: 0.4 }, { at: 1, duration: 2 });
      a.pose({ spine: 0.2 }, { at: 0, duration: 2 });
    });
    expect(at(150).spine).toBe(0.2);
    expect(at(210).spine).toBeCloseTo(0.3, 12);
    expect(at(220).spine).toBe(0.4);
    expect(at(400).spine).toBe(0.4);
  });

  it("blends an override back out to the call still running beneath it", () => {
    const at = play((a) => {
      a.pose({ shoulderR: 1 }, { duration: 3 });
      a.pose({ shoulderR: 2 }, { at: 1, duration: 1 });
    });
    expect(at(110).shoulderR).toBeCloseTo(1.5, 12);
    expect(at(200).shoulderR).toBe(2);
    expect(at(210).shoulderR).toBeCloseTo(1.5, 12);
    expect(at(220).shoulderR).toBe(1);
    expect(at(500).shoulderR).toBe(1);
  });

  it("starts a call placed later from the pose held before it, whatever was recorded first", () => {
    const at = play((a) => {
      a.pose({ kneeR: 0.4 }, { at: 0.5, duration: 0.5 });
      a.pose({ kneeR: 1.2 }, { at: 0, duration: 0.5 });
    });
    expect(at(50).kneeR).toBe(1.2);
    expect(at(60).kneeR).toBeCloseTo(0.8, 12);
    expect(at(70).kneeR).toBeCloseTo(0.4, 12);
    expect(at(200).kneeR).toBe(0.4);
  });

  it("adds in add mode, and fades the addition out when it ends", () => {
    const at = play((a) => {
      a.pose({ spine: 0.4 }, { duration: 3 });
      a.pose({ spine: 0.2 }, { at: 1, duration: 1, mode: "add" });
    });
    expect(at(110).spine).toBeCloseTo(0.5, 12);
    expect(at(150).spine).toBeCloseTo(0.6, 12);
    expect(at(210).spine).toBeCloseTo(0.5, 12);
    expect(at(220).spine).toBe(0.4);
    expect(at(500).spine).toBe(0.4);
  });

  it("does not hold an addition that has nothing beneath it", () => {
    const at = play((a) => {
      a.drive(() => ({ spine: 0.2 }), { duration: 1, mode: "add" });
    });
    expect(at(50).spine).toBeCloseTo(0.2, 12);
    expect(at(110).spine).toBeCloseTo(0.1, 12);
    expect(at(120).spine).toBe(0);
  });

  it("runs a drive as a function of the seconds since it began", () => {
    const at = play((a) => {
      a.drive((t) => ({ spine: t * 0.1 }), { at: 1, duration: 2, blend: 0 });
    });
    expect(at(100).spine).toBe(0);
    expect(at(150).spine).toBeCloseTo(0.05, 12);
    expect(at(250).spine).toBeCloseTo(0.15, 12);
  });

  it("holds a drive at its last value", () => {
    const at = play((a) => {
      a.drive((t) => ({ spine: t * 0.1 }), { duration: 2 });
    });
    expect(at(200).spine).toBeCloseTo(0.2, 12);
    expect(at(900).spine).toBeCloseTo(0.2, 12);
  });

  it("runs an open-ended drive to the end of the scene", () => {
    const at = play((a) => {
      a.drive((t) => ({ spine: t * 0.01 }));
    });
    expect(at(1000).spine).toBeCloseTo(0.1, 12);
  });

  it("moves nothing when a drive's function gives no finite number", () => {
    const at = play((a) => {
      a.drive(() => ({ spine: Number.NaN, chest: Infinity }), { duration: 1 });
    });
    expect(at(50)).toEqual(REST);
  });

  it("does not call again a drive's function that threw at t = 0", () => {
    let calls = 0;
    const built = scene({ fps: 100 }, (stage) => {
      stage.actor().drive(
        () => {
          calls += 1;
          throw new Error("boom");
        },
        { duration: 1 },
      );
    });
    expect(poseOf(built.timeline, 50)).toEqual(REST);
    expect(calls).toBe(1);
  });

  it("puts a hand on the point it reaches for, moving only that arm", () => {
    const at = play((a) => {
      a.reach("handR", { x: 0.2, y: 0.7 }, { duration: 0.5 });
    });
    const arrived = at(50);
    const hand = forwardKinematics(arrived).handR;
    expect(hand.x).toBeCloseTo(0.2, 9);
    expect(hand.y).toBeCloseTo(0.7, 9);
    expect({ ...arrived, shoulderR: 0, elbowR: 0 }).toEqual(REST);
    expect(at(10).shoulderR).toBeCloseTo(arrived.shoulderR / 2, 9);
    expect(at(10).elbowR).toBeCloseTo(arrived.elbowR / 2, 9);
    expect(at(900)).toEqual(arrived);
  });

  it("solves a reach against the pose beneath it", () => {
    const at = play((a) => {
      a.pose({ pelvisY: -0.2 }, { duration: 1 });
      a.reach("footR", { x: 0.1, y: 0 }, { at: 0.5, duration: 0.5 });
    });
    const foot = forwardKinematics(at(100)).ankleR;
    expect(foot.x).toBeCloseTo(0.1, 9);
    expect(foot.y).toBeCloseTo(0, 9);
  });

  it("composes each row's actor on its own", () => {
    const built = scene({ rows: 2, fps: 100 }, (stage) => {
      stage.row(0).actor().pose({ kneeR: 1.2 }, { duration: 0.5 });
      stage.row(1).actor().pose({ spine: 0.3 }, { duration: 0.5 });
    });
    expect(poseOf(built.timeline, 50, 0)).toEqual({ ...REST, kneeR: 1.2 });
    expect(poseOf(built.timeline, 50, 1)).toEqual({ ...REST, spine: 0.3 });
  });
});

describe("continuity", () => {
  /** The largest change of any channel between adjacent frames over the first 4 s. */
  function largestStep(at: (frame: number) => Pose): number {
    let largest = 0;
    let before = at(0);
    for (let frame = 1; frame <= 400; frame += 1) {
      const after = at(frame);
      for (const name of Object.keys(REST) as (keyof typeof REST)[]) {
        largest = Math.max(largest, Math.abs(after[name] - before[name]));
      }
      before = after;
    }
    return largest;
  }

  // Every value below moves by at most 1 over a 0.2 s blend. Smoothstep's steepest
  // hundredth of a second covers 7.5% of that; a pop would be several times larger.
  it.each<[string, (a: Actor) => void]>([
    [
      "poses in sequence",
      (a) => {
        a.pose({ kneeR: 1 }, { duration: 0.5 });
        a.pose({ kneeR: 0.2, hipR: 1 }, { duration: 0.5 });
        a.wait(0.5);
        a.pose({ hipR: 0 }, { duration: 0.5 });
      },
    ],
    [
      "an override that ends inside the call beneath it",
      (a) => {
        a.pose({ shoulderR: 1 }, { duration: 3 });
        a.pose({ shoulderR: 2 }, { at: 1, duration: 1 });
      },
    ],
    [
      "an override that ends just before the call beneath it",
      (a) => {
        a.pose({ shoulderR: 1 }, { duration: 2.1 });
        a.pose({ shoulderR: 2 }, { at: 1, duration: 1 });
      },
    ],
    [
      "an override that outlasts the call beneath it",
      (a) => {
        a.pose({ shoulderR: 1 }, { duration: 1.5 });
        a.pose({ shoulderR: 2 }, { at: 1, duration: 1 });
      },
    ],
    [
      "an addition over a pose that ends first",
      (a) => {
        a.pose({ spine: 0.4 }, { duration: 1.1 });
        a.pose({ spine: 0.5 }, { at: 0.5, duration: 1, mode: "add" });
      },
    ],
    [
      "a pose over an open-ended addition",
      (a) => {
        a.drive((t) => ({ spine: Math.sin(t * 3) * 0.2 }), { mode: "add" });
        a.pose({ spine: 0.5 }, { at: 1, duration: 1 });
      },
    ],
    [
      "a drive over a pose, ending inside it",
      (a) => {
        a.pose({ spine: 0.4, kneeR: 1 }, { duration: 3 });
        a.drive((t) => ({ spine: 0.1 + t * 0.3 }), { at: 0.5, duration: 1 });
      },
    ],
    [
      "a reach that ends while a pose beneath it still moves the back",
      (a) => {
        a.pose({ spine: 0.5 }, { duration: 3 });
        // The arm turns by more than 1 here, so it is given a longer blend.
        a.reach("handR", { x: 0.3, y: 0.6 }, { at: 1, duration: 1, blend: 0.5 });
      },
    ],
    [
      "a reach over a pose of the same arm, ending inside it",
      (a) => {
        a.pose({ shoulderR: 1, elbowR: 0.5, spine: 0.3 }, { duration: 3 });
        a.reach("handR", { x: 0.3, y: 0.6 }, { at: 1, duration: 1 });
      },
    ],
    [
      "calls recorded in the reverse of their order in time",
      (a) => {
        a.pose({ kneeR: 0.4 }, { at: 1, duration: 0.5 });
        a.pose({ kneeR: 1 }, { at: 0.5, duration: 0.5 });
        a.pose({ kneeR: 0.7 }, { at: 0, duration: 0.5 });
      },
    ],
  ])("never jumps between frames with %s", (_label, act) => {
    expect(largestStep(play(act))).toBeLessThan(0.1);
  });

  it("goes on fading an override back when the call beneath it ends meanwhile", () => {
    const at = play((a) => {
      a.pose({ shoulderR: 1 }, { duration: 2.1 });
      a.pose({ shoulderR: 2 }, { at: 1, duration: 1 });
    });
    expect(at(210).shoulderR).toBeCloseTo(1.5, 12);
    expect(at(220).shoulderR).toBe(1);
  });

  it("keeps a held hand on its point while a pose beneath it still holds the back", () => {
    const at = play((a) => {
      a.pose({ spine: 0.5 }, { duration: 3 });
      a.reach("handR", { x: 0.3, y: 0.6 }, { at: 1, duration: 1 });
    });
    for (const frame of [199, 200, 250]) {
      const hand = forwardKinematics(at(frame)).handR;
      expect(hand.x).toBeCloseTo(0.3, 9);
      expect(hand.y).toBeCloseTo(0.6, 9);
    }
  });

  it("lets a later pose of the arm take over from a held reach", () => {
    const at = play((a) => {
      a.reach("handR", { x: 0.3, y: 0.6 }, { duration: 0.5 });
      a.pose({ shoulderR: 0.2, elbowR: 0.1 }, { duration: 0.5 });
    });
    expect(at(300)).toEqual({ ...REST, shoulderR: 0.2, elbowR: 0.1 });
  });
});

describe("a function at depth 3", () => {
  function momentsOf(
    build: (actor: Actor, see: (t: number, m: Moment) => number) => void,
  ): {
    readonly built: Scene;
    readonly seen: [t: number, moment: Moment][];
  } {
    const seen: [number, Moment][] = [];
    const built = scene({ fps: 100, seed: 7, rows: 2, duration: 10 }, (stage) => {
      build(stage.row(1).actor({ name: "hero" }), (t, moment) => {
        seen.push([t, moment]);
        return 0;
      });
    });
    return { built, seen };
  }

  it("receives the seconds since its segment began, and where that is", () => {
    const { built, seen } = momentsOf((a, see) => {
      a.drive((t, moment) => ({ spine: see(t, moment) }), { at: 1, duration: 2 });
    });
    poseOf(built.timeline, 150, 1);
    expect(seen).toHaveLength(2);
    expect(seen[1]?.[0]).toBe(0.5);
    expect(seen[1]?.[1]).toMatchObject({ time: 1.5, duration: 2, progress: 0.25 });
  });

  it("is called once, at t = 0, when the call is recorded", () => {
    const { seen } = momentsOf((a, see) => {
      a.drive((t, moment) => ({ spine: see(t, moment) }), { at: 1, duration: 2 });
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe(0);
    expect(seen[0]?.[1]).toMatchObject({ time: 1, duration: 2, progress: 0 });
  });

  it("is called at record time with an infinite duration when open-ended", () => {
    const { seen } = momentsOf((a, see) => {
      a.drive((t, moment) => ({ spine: see(t, moment) }));
    });
    expect(seen[0]?.[1]).toMatchObject({ time: 0, duration: Infinity, progress: 0 });
  });

  it("moves only the channels it returned at t = 0", () => {
    const at = play((a) => {
      a.pose({ chest: 0.3 }, { duration: 3 });
      a.drive(
        (t): { spine: number; chest?: number } =>
          t < 0.5 ? { spine: 0.1 } : { spine: 0.2, chest: 0.6 },
        { at: 0, duration: 2 },
      );
    });
    expect(at(100)).toEqual({ ...REST, spine: 0.2, chest: 0.3 });
  });

  it("leaves a recorded channel alone at a time its function does not return it", () => {
    const at = play((a) => {
      a.pose({ spine: 0.4 }, { duration: 3 });
      a.drive((t): { spine?: number } => (t < 0.5 ? { spine: 0.1 } : {}), {
        at: 0,
        duration: 2,
      });
    });
    expect(at(30).spine).toBe(0.1);
    expect(at(100).spine).toBe(0.4);
  });

  it("receives an infinite duration and no progress in an open-ended segment", () => {
    const { built, seen } = momentsOf((a, see) => {
      a.drive((t, moment) => ({ spine: see(t, moment) }), { at: 1 });
    });
    poseOf(built.timeline, 150, 1);
    expect(seen[1]?.[0]).toBe(0.5);
    expect(seen[1]?.[1]).toMatchObject({ time: 1.5, duration: Infinity, progress: 0 });
  });

  it("is frozen at its end once the segment has ended", () => {
    const { built, seen } = momentsOf((a, see) => {
      a.drive((t, moment) => ({ spine: see(t, moment) }), { at: 1, duration: 2 });
    });
    poseOf(built.timeline, 900, 1);
    expect(seen[1]?.[0]).toBe(2);
    expect(seen[1]?.[1]).toMatchObject({ time: 3, duration: 2, progress: 1 });
  });

  it("receives the random source keyed on the scene seed and its actor", () => {
    const { built, seen } = momentsOf((a, see) => {
      a.drive((t, moment) => ({ spine: see(t, moment) }), { duration: 2 });
    });
    poseOf(built.timeline, 50, 1);
    const expected = randomSource({
      seed: 7,
      row: 1,
      kind: "actor",
      name: "hero",
      occurrence: 0,
    });
    expect(seen[0]?.[1].random.float(3)).toBe(expected.float(3));
    expect(seen[0]?.[1].random.uint32()).toBe(expected.uint32());
  });
});

describe("a timeline that was not just built", () => {
  it("composes the same pose after a round trip through JSON", () => {
    const built = scene({ fps: 100 }, (stage) => {
      const a = stage.actor();
      a.pose({ kneeR: 1.2, spine: 0.4 }, { duration: 0.5, anticipation: 0.1 });
      a.reach("handR", { x: 0.2, y: 0.7 }, { duration: 0.5 });
      a.pose({ spine: 0.1 }, { at: 0.2, duration: 0.2, mode: "add" });
    });
    const parsed = parseTimeline(serializeTimeline(built.timeline));
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    for (const frame of [0, 5, 15, 30, 45, 60, 100]) {
      expect(poseOf(parsed.document.timeline, frame)).toEqual(
        poseOf(built.timeline, frame),
      );
    }
  });

  it("moves nothing where a function was omitted", () => {
    const built = scene({ fps: 100, duration: 2 }, (stage) => {
      const a = stage.actor();
      a.pose({ kneeR: 1.2 }, { duration: 0.5 });
      a.drive(() => ({ spine: 0.3 }), { at: 0, duration: 1 });
    });
    const parsed = parseTimeline(serializeTimeline(built.timeline));
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    expect(poseOf(built.timeline, 50)).toEqual({ ...REST, kneeR: 1.2, spine: 0.3 });
    expect(poseOf(parsed.document.timeline, 50)).toEqual({ ...REST, kneeR: 1.2 });
  });

  it("ignores data it does not know and values that are not finite numbers", () => {
    const data: unknown[] = [
      null,
      "pose",
      { kind: "spin", channels: { spine: 1 } },
      { kind: "wait" },
      { kind: "pose" },
      { kind: "drive", channels: null },
      { kind: "drive", channels: ["spine", 3, "wing"], motion: "sway" },
      { kind: "drive", channels: ["spine"], motion: () => 0.2 },
      { kind: "drive", channels: ["spine"], motion: () => ({ spine: "0.2" }) },
      { kind: "reach", effector: "tail", target: { x: 0, y: 0 } },
      { kind: "reach", effector: "handR", target: null },
      { kind: "reach", effector: "handR", target: { x: "0", y: 0 } },
      { kind: "reach", effector: "handR", target: { x: 0, y: "0" } },
      { kind: "pose", channels: { wing: 1, spine: "0.2", kneeR: null, chest: 0.3 } },
    ];
    const timeline: Timeline = {
      fps: 30,
      seed: 0,
      duration: null,
      rows: [
        {
          tracks: [
            {
              kind: "actor",
              name: "actor",
              occurrence: 0,
              segments: data.map((entry) => ({
                start: 0,
                end: 1_000_000,
                data: entry,
              })),
            },
          ],
        },
      ],
    };
    expect(poseOf(timeline, 15)).toEqual({ ...REST, chest: 0.3 });
  });
});
