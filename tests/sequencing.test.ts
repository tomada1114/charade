import { describe, expect, it } from "vitest";

import {
  type Actor,
  defineAction,
  defineExpression,
  type Moment,
  type Scene,
  scene,
  type Span,
  type Timeline,
} from "../src/index.js";
import { poseAtFrame, poseAtInstant } from "../src/rig/compose.js";
import { reach } from "../src/rig/ik.js";
import { forwardKinematics } from "../src/rig/kinematics.js";
import type { Pose } from "../src/rig/rig.js";
import { parseTimeline, serializeTimeline } from "../src/timeline/json.js";
import { randomSource } from "../src/timeline/random.js";
import type { TimelineSegment } from "../src/timeline/timeline.js";

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

  it("eases a cycle from each key of a channel to the next, and round again", () => {
    const at = play((a) => {
      a.cycle(
        [
          { at: 0, channels: { chest: 0, spine: 0.3 } },
          { at: 1, channels: { chest: -0.2 } },
        ],
        { at: 1, period: 2, blend: 0 },
      );
    });
    expect(at(99)).toEqual(REST);
    expect(at(100).chest).toBe(0);
    // A quarter of the way from a key to the next, eased: 3p² − 2p³ at p = 0.25.
    expect(at(125).chest).toBeCloseTo(-0.2 * 0.15625, 12);
    expect(at(150).chest).toBeCloseTo(-0.1, 12);
    expect(at(200).chest).toBeCloseTo(-0.2, 12);
    // The last key leads back to the first, one period on.
    expect(at(250).chest).toBeCloseTo(-0.1, 12);
    expect(at(300).chest).toBeCloseTo(0, 12);
    expect(at(950).chest).toBeCloseTo(at(150).chest, 12);
    // A channel with one key keeps its value.
    expect(at(125).spine).toBe(0.3);
    expect(at(950).spine).toBe(0.3);
  });

  it("does not pop where a cycle comes round", () => {
    const at = play((a) => {
      a.cycle(
        [
          { at: 0.3, channels: { neck: 0.4 } },
          { at: 0.5, channels: { neck: -0.1 } },
          { at: 1.6, channels: { neck: 0.2 } },
        ],
        { period: 2, blend: 0 },
      );
    });
    // Before the first key of a pass the value is on its way there from the last key.
    expect(at(0).neck).toBeCloseTo(at(200).neck, 12);
    for (const frame of [199, 200, 399, 400, 599]) {
      expect(Math.abs(at(frame + 1).neck - at(frame).neck)).toBeLessThan(0.01);
    }
    expect(at(30).neck).toBeCloseTo(0.4, 12);
    expect(at(230).neck).toBeCloseTo(0.4, 12);
  });

  it("blends a cycle in, adds it in add mode, and holds a bounded one where it ended", () => {
    const at = play((a) => {
      a.pose({ spine: 0.2 }, { blend: 0 });
      a.cycle([{ at: 0, channels: { spine: 0.1 } }], {
        at: 1,
        period: 1,
        blend: 0.2,
        mode: "add",
        duration: 1,
      });
      a.cycle(
        [
          { at: 0, channels: { neck: 0 } },
          { at: 1, channels: { neck: 0.4 } },
        ],
        { at: 3, period: 2, blend: 0, duration: 0.5 },
      );
    });
    expect(at(110).spine).toBeCloseTo(0.25, 12);
    expect(at(150).spine).toBeCloseTo(0.3, 12);
    // An add segment is never held: it fades out over its blend.
    expect(at(210).spine).toBeCloseTo(0.25, 12);
    expect(at(230).spine).toBeCloseTo(0.2, 12);
    expect(at(350).neck).toBeCloseTo(0.2, 12);
    expect(at(900).neck).toBeCloseTo(0.2, 12);
  });

  /** A sway of the back that never ends: both channels 0 on the second, 0.2 half way. */
  function sway(a: Actor, options: { at?: number; duration?: number } = {}): void {
    a.cycle(
      [
        { at: 0, channels: { spine: 0, chest: 0 } },
        { at: 0.5, channels: { spine: 0.2, chest: 0.2 } },
      ],
      { period: 1, ...options },
    );
  }

  it("keeps the pose a later call ended on over an open-ended cycle, which runs on in its other channels", () => {
    const at = play((a) => {
      sway(a);
      a.pose({ spine: 0.5 }, { at: 2, blend: 0.1, duration: 1 });
    });
    expect(at(150).spine).toBeCloseTo(0.2, 12);
    expect(at(250).spine).toBe(0.5);
    for (const frame of [299, 300, 301, 305, 320, 350, 975, 1000]) {
      expect(at(frame).spine).toBe(0.5);
    }
    expect(at(350).chest).toBeCloseTo(0.2, 12);
    expect(at(975).chest).toBeCloseTo(0.1, 12);
    expect(at(1000).chest).toBeCloseTo(0, 12);
  });

  it("blends a second pose in from the first over an open-ended cycle, without a dip towards it", () => {
    const at = play((a) => {
      sway(a);
      a.pose({ spine: 0.5 }, { at: 2, blend: 0.1, duration: 1 });
      a.pose({ spine: 0.9 }, { at: 4, duration: 1 });
    });
    expect(at(400).spine).toBe(0.5);
    expect(at(410).spine).toBeCloseTo(0.7, 12);
    expect(at(420).spine).toBe(0.9);
    expect(at(1000).spine).toBe(0.9);
  });

  it("gives a channel back to a bounded cycle still running beneath an ended pose", () => {
    const at = play((a) => {
      sway(a, { duration: 5 });
      a.pose({ spine: 0.5 }, { at: 2, blend: 0.1, duration: 1 });
    });
    expect(at(300).spine).toBe(0.5);
    expect(at(305).spine).toBeCloseTo(0.25, 2);
    expect(at(350).spine).toBeCloseTo(0.2, 12);
    expect(at(450).spine).toBeCloseTo(0.2, 12);
  });

  it("lets an earlier-recorded open-ended cycle that starts after a pose ended take over from it", () => {
    const at = play((a) => {
      a.cycle([{ at: 0, channels: { spine: 0.1 } }], { period: 1, at: 4 });
      a.pose({ spine: 0.5 }, { at: 1, duration: 1 });
    });
    expect(at(300).spine).toBe(0.5);
    expect(at(410).spine).toBeCloseTo(0.3, 12);
    expect(at(1000).spine).toBeCloseTo(0.1, 12);
  });

  it("leaves an open-ended cycle its channel when the pose that ended over it yielded to a bounded one", () => {
    const at = play((a) => {
      a.pose({ spine: 1 }, { duration: 3 });
      a.cycle([{ at: 0, channels: { spine: 0.1 } }], { period: 1, at: 0 });
      a.pose({ spine: 2 }, { at: 1, duration: 1 });
    });
    expect(at(200).spine).toBe(2);
    expect(at(210).spine).toBeCloseTo(1.05, 12);
    expect(at(220).spine).toBeCloseTo(0.1, 12);
    expect(at(1000).spine).toBeCloseTo(0.1, 12);
  });

  it("still fades an ended pose back to an open-ended cycle in add mode", () => {
    const at = play((a) => {
      a.cycle([{ at: 0, channels: { spine: 0.1 } }], { period: 1, mode: "add" });
      a.pose({ spine: 0.5 }, { at: 1, duration: 1 });
    });
    expect(at(200).spine).toBe(0.5);
    expect(at(220).spine).toBeCloseTo(0.6, 12);
    expect(at(1000).spine).toBeCloseTo(0.6, 12);
  });

  it("holds an ended pose over an open-ended cycle, under an open-ended sway in add mode", () => {
    const at = play((a) => {
      a.cycle([{ at: 0, channels: { spine: 0.1 } }], { period: 1 });
      a.cycle([{ at: 0, channels: { spine: 0.05 } }], {
        period: 1,
        at: 0,
        mode: "add",
      });
      a.pose({ spine: 0.5 }, { at: 1, duration: 1 });
    });
    expect(at(150).spine).toBeCloseTo(0.5, 12);
    expect(at(200).spine).toBeCloseTo(0.5, 12);
    expect(at(210).spine).toBeCloseTo(0.525, 12);
    expect(at(250).spine).toBeCloseTo(0.55, 12);
    expect(at(1000).spine).toBeCloseTo(0.55, 12);
  });

  it("keeps a held hand on its point while the open-ended cycle it ended over still moves the back", () => {
    const at = play((a) => {
      a.cycle(
        [
          { at: 0, channels: { spine: 0, shoulderR: 0, elbowR: 0 } },
          { at: 0.5, channels: { spine: 0.3, shoulderR: 0.4, elbowR: 0.2 } },
        ],
        { period: 1 },
      );
      a.reach("handR", { x: 0.2, y: 0.6 }, { at: 1, duration: 1 });
    });
    expect(at(250).spine).toBeCloseTo(0.3, 12);
    expect(at(300).spine).toBeCloseTo(0, 12);
    for (const frame of [199, 200, 225, 250, 300, 975]) {
      const hand = forwardKinematics(at(frame)).handR;
      expect(hand.x).toBeCloseTo(0.2, 9);
      expect(hand.y).toBeCloseTo(0.6, 9);
    }
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
      "poses that end over an open-ended cycle",
      (a) => {
        a.cycle(
          [
            { at: 0, channels: { spine: 0, chest: 0 } },
            { at: 0.7, channels: { spine: 0.3, chest: 0.3 } },
          ],
          { period: 1.3 },
        );
        a.pose({ spine: 0.9 }, { at: 1, followThrough: 0.2, duration: 0.6 });
        a.pose({ spine: 0.1, chest: 0.6 }, { at: 2.5, duration: 0.3 });
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

describe("an express inside an action that has a mood", () => {
  /** What the built-in `focused` and `happy` return at full intensity. */
  const FOCUSED = {
    eyeOpen: 0.55,
    gazeX: 0.8,
    gazeY: 0,
    browHeight: -0.9,
    browTilt: -0.1,
    mouthCurve: 0,
    mouthOpen: 0,
    mouthWidth: 0.6,
  };
  const HAPPY = {
    eyeOpen: 0.85,
    gazeX: 0,
    gazeY: 0,
    browHeight: 0.6,
    browTilt: 0,
    mouthCurve: 1,
    mouthOpen: 0.5,
    mouthWidth: 1.3,
  };

  /** Three seconds with an arm up, and the mark `turn` one second in. */
  const hold = defineAction({
    name: "hold",
    description: "",
    marks: ["turn"],
    build(clip) {
      clip.pose({ shoulderR: 1 }, { duration: 3 });
      clip.mark("turn", 1);
    },
  });

  /** A one-actor scene at 100 fps; the face of its pose at a frame. */
  function face(act: (actor: Actor) => void): (frame: number) => typeof HAPPY {
    const at = play(act);
    return (frame) => {
      const pose = at(frame);
      return {
        eyeOpen: pose.eyeOpen,
        gazeX: pose.gazeX,
        gazeY: pose.gazeY,
        browHeight: pose.browHeight,
        browTilt: pose.browTilt,
        mouthCurve: pose.mouthCurve,
        mouthOpen: pose.mouthOpen,
        mouthWidth: pose.mouthWidth,
      };
    };
  }

  it("keeps the face shown at a mark of a push after the push has ended", () => {
    let end = 0;
    const built = scene({ fps: 100, duration: 10 }, (stage) => {
      const rock = stage.prop("rock");
      rock.place({ x: 0.6, y: 0 });
      const presser = stage.actor();
      const pressed = presser.do("push", {
        by: "lever",
        prop: rock,
        distance: 0.15,
        mood: "focused",
      });
      presser.express("happy", { at: pressed.marks.stop });
      presser.wait(2);
      end = pressed.end;
    });
    const row = built.timeline.rows[0];
    const index = row?.tracks.findIndex((track) => track.kind === "actor") ?? -1;
    for (const seconds of [end, end + 0.1, end + 0.2, end + 1.3]) {
      expect(poseOf(built.timeline, Math.round(seconds * 100), 0, index)).toMatchObject(
        HAPPY,
      );
    }
  });

  it("shows the mood up to the mark and the express from its blend on", () => {
    const at = face((a) => {
      const held = a.do(hold, { mood: "focused" });
      a.express("happy", { at: held.marks.turn });
    });
    expect(at(100)).toEqual(FOCUSED);
    expect(at(110).mouthCurve).toBeCloseTo(0.5, 12);
    for (const frame of [120, 130, 140, 200, 299, 300, 320, 900]) {
      expect(at(frame)).toEqual(HAPPY);
    }
  });

  it("leaves the mood on the channels the express does not name", () => {
    const grin = defineExpression({
      name: "grin",
      description: "",
      build: () => ({ mouthCurve: 0.8 }),
    });
    const at = face((a) => {
      const held = a.do(hold, { mood: "focused" });
      a.express(grin, { at: held.marks.turn });
    });
    for (const frame of [120, 250, 300, 900]) {
      expect(at(frame)).toEqual({ ...FOCUSED, mouthCurve: 0.8 });
    }
  });

  it("takes over a mood it starts with, and one that has not arrived yet", () => {
    const from = face((a) => {
      a.do(hold, { mood: "focused" });
      a.express("happy", { at: 0 });
    });
    const early = face((a) => {
      a.do(hold, { mood: "focused" });
      a.express("happy", { at: 0.1 });
    });
    // The express blends in from the face before the action, not from the mood.
    expect(from(0)).toMatchObject({ mouthWidth: 1, browHeight: 0, eyeOpen: 1 });
    expect(from(5).mouthWidth).toBeGreaterThan(1);
    for (const frame of [30, 300, 900]) {
      expect(from(frame)).toEqual(HAPPY);
      expect(early(frame)).toEqual(HAPPY);
    }
  });

  it("is the face after an open-ended action as well", () => {
    const sway = defineAction({
      name: "sway",
      description: "",
      build(clip) {
        clip.cycle([{ at: 0, channels: { spine: 0.1 } }], { period: 1 });
      },
    });
    const at = face((a) => {
      a.do(sway, { mood: "focused" });
      a.express("happy", { at: 1 });
    });
    expect(at(100)).toEqual(FOCUSED);
    expect(at(900)).toEqual(HAPPY);
  });

  it("still adds to the mood and fades in add mode", () => {
    const at = face((a) => {
      const held = a.do(hold, { mood: "focused" });
      a.express("happy", { at: held.marks.turn, mode: "add", duration: 1 });
    });
    expect(at(150).mouthCurve).toBe(1);
    expect(at(150).browHeight).toBeCloseTo(-0.3, 12);
    expect(at(250)).toEqual(FOCUSED);
    expect(at(900)).toEqual(FOCUSED);
  });

  it("leaves a mood alone when the express starts before it or after it", () => {
    const before = face((a) => {
      a.do(hold, { mood: "focused", at: 1 });
      a.express("happy", { at: 0.5 });
    });
    expect(before(60).mouthCurve).toBeCloseTo(0.5, 12);
    expect(before(300)).toEqual(FOCUSED);
    const after = face((a) => {
      const held = a.do(hold, { mood: "focused" });
      a.express("happy", { at: held.end });
    });
    expect(after(300)).toEqual(FOCUSED);
    expect(after(320)).toEqual(HAPPY);
  });

  it("puts a later action's mood beneath that action's calls when its build ends an earlier mood", () => {
    const grin = defineExpression({
      name: "grin",
      description: "",
      build: () => ({ mouthCurve: 0.8 }),
    });
    let actor: Actor | undefined;
    const frown = defineAction({
      name: "frown",
      description: "",
      build(clip) {
        actor?.express(grin, { at: 1 });
        clip.pose({ mouthCurve: -0.5 }, { duration: 1 });
      },
    });
    const brows = defineExpression({
      name: "brows",
      description: "",
      build: () => ({ browHeight: 0.2 }),
    });
    const at = face((a) => {
      actor = a;
      a.do(hold, { mood: "focused" });
      a.express(brows, { at: 2.5, duration: 2 });
      a.do(frown, { mood: "happy", at: 3 });
    });
    expect(at(120)).toEqual({ ...FOCUSED, mouthCurve: 0.8 });
    // The mood is recorded after the brows, so it wins over them while both run.
    expect(at(350)).toEqual({ ...HAPPY, mouthCurve: -0.5 });
    expect(at(900)).toEqual({ ...HAPPY, mouthCurve: -0.5, browHeight: 0.2 });
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

  it("composes a cycle the same after a round trip through JSON", () => {
    const built = scene({ fps: 100, duration: 4 }, (stage) => {
      stage.actor().cycle(
        [
          { at: 0.5, channels: { chest: -0.1, eyeOpen: 0 } },
          { at: 0, channels: { chest: 0 } },
        ],
        { period: 1.5, mode: "add" },
      );
    });
    expect(built.findings).toEqual([]);
    const text = serializeTimeline(built.timeline);
    expect(text).toContain('"lossy":false');
    const parsed = parseTimeline(text);
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    expect(parsed.document.timeline).toEqual(built.timeline);
    for (const frame of [0, 20, 50, 149, 150, 399]) {
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
      { kind: "cycle", period: 1_000_000 },
      { kind: "cycle", period: 0, keys: [{ at: 0, channels: { spine: 1 } }] },
      { kind: "cycle", period: "1", keys: [{ at: 0, channels: { spine: 1 } }] },
      {
        kind: "cycle",
        period: 1_000_000,
        keys: [
          null,
          { at: "0", channels: { spine: 1 } },
          { at: 0 },
          { at: 0, channels: { wing: 1, spine: "1" } },
        ],
      },
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

/** A pose or a reach as a hand-built segment holds it, its phases in microseconds. */
interface Recorded {
  readonly kind: "pose" | "reach";
  readonly mode: "replace" | "add";
  readonly anticipation: number;
  readonly blend: number;
  readonly followThrough: number;
  readonly channels?: Readonly<Partial<Record<keyof Pose, number>>>;
  readonly effector?: "handL" | "handR" | "footL" | "footR";
  readonly target?: { readonly x: number; readonly y: number };
}

interface RecordedSegment extends TimelineSegment {
  readonly data: Recorded;
}

const CHAINS = {
  handL: ["shoulderL", "elbowL"],
  handR: ["shoulderR", "elbowR"],
  footL: ["hipL", "kneeL"],
  footR: ["hipR", "kneeR"],
} as const;

function ease(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

function sway(progress: number): number {
  return 0.1 * Math.sin(Math.PI * progress) ** 2;
}

function blendOver(beneath: number, value: number, weight: number): number {
  return weight === 1 ? value : beneath + weight * (value - beneath);
}

/**
 * The composition written without the one-pass bookkeeping: each ended segment asks
 * every earlier-recorded one whether it yields, and each open-ended one asks every
 * later-recorded one whether it has taken a channel, which is plain to read and grows
 * with the square of the segment count. Poses and reaches only; `now` in frame units.
 */
function referencePose(
  segments: readonly RecordedSegment[],
  fps: number,
  now: number,
): Pose {
  const layers = segments.map(({ start, end, data }) => {
    const { effector, target, channels = {} } = data;
    const names: readonly (keyof Pose)[] =
      effector === undefined
        ? (Object.keys(channels) as (keyof Pose)[])
        : CHAINS[effector];
    return {
      names,
      evaluate: (beneath: Pose): (readonly [keyof Pose, number])[] => {
        if (effector === undefined || target === undefined) {
          return names.map((name) => [name, channels[name] ?? 0] as const);
        }
        const solved = reach(beneath, effector, target);
        return names.map((name) => [name, solved[name]] as const);
      },
      solved: data.kind === "reach",
      mode: data.mode,
      start: start * fps,
      end: end === null ? null : end * fps,
      anticipation: data.anticipation * fps,
      blend: data.blend * fps,
      followThrough: data.followThrough * fps,
    };
  });
  type Layer = (typeof layers)[number];
  const arrival = (layer: Layer, elapsed: number): number => {
    const { anticipation, blend, followThrough } = layer;
    if (elapsed < anticipation) {
      return -sway(elapsed / anticipation);
    }
    const blending = elapsed - anticipation;
    if (blending < blend) {
      return ease(blending / blend);
    }
    const settling = blending - blend;
    return settling < followThrough ? 1 + sway(settling / followThrough) : 1;
  };
  const pose: Record<keyof Pose, number> = { ...REST };
  const holder = new Map<keyof Pose, Layer>();
  const held = layers
    .filter(
      (layer) => layer.mode === "replace" && layer.end !== null && layer.end <= now,
    )
    .sort((a, b) => (a.end ?? 0) - (b.end ?? 0));
  for (const layer of held) {
    for (const [name, value] of layer.evaluate(pose)) {
      pose[name] = value;
      holder.set(name, layer);
    }
  }
  /**
   * Whether layer `index`, ending at `end`, fades back out on `name`; with `bounded`,
   * to an earlier segment that has an end.
   */
  const yields = (
    index: number,
    end: number,
    name: keyof Pose,
    bounded = false,
  ): boolean =>
    layers
      .slice(0, index)
      .some(
        (lower) =>
          !(lower.end === null && (bounded || lower.mode === "replace")) &&
          lower.names.includes(name) &&
          lower.start < end &&
          (lower.end === null || lower.end > end),
      );
  /** Whether a later-recorded segment has ended on `name` over open-ended layer `index`. */
  const lost = (index: number, name: keyof Pose): boolean =>
    layers.some(
      (upper, above) =>
        above > index &&
        upper.mode === "replace" &&
        upper.end !== null &&
        upper.names.includes(name) &&
        upper.end > (layers[index]?.start ?? Number.NaN) &&
        upper.end <= now &&
        !yields(above, upper.end, name, true),
    );
  const moved = new Set<keyof Pose>();
  layers.forEach((layer, index) => {
    if (now < layer.start) {
      return;
    }
    const { end } = layer;
    if (end === null || now < end) {
      const weight = arrival(layer, now - layer.start);
      for (const [name, value] of layer.evaluate(pose)) {
        if (end === null && layer.mode === "replace" && lost(index, name)) {
          continue;
        }
        pose[name] =
          layer.mode === "add"
            ? pose[name] + weight * value
            : blendOver(pose[name], value, weight);
        moved.add(name);
      }
      return;
    }
    const fade = now - end < layer.blend ? 1 - ease((now - end) / layer.blend) : 0;
    if (fade === 0 && !layer.solved) {
      return;
    }
    for (const [name, value] of layer.evaluate(pose)) {
      if (layer.mode === "add") {
        pose[name] += fade * value;
      } else if (yields(index, end, name)) {
        pose[name] = blendOver(pose[name], value, fade);
      } else if (holder.get(name) === layer && !moved.has(name)) {
        pose[name] = value;
      }
    }
  });
  return pose;
}

function trackOf(segments: readonly RecordedSegment[], fps: number): Timeline {
  return {
    fps,
    seed: 0,
    duration: null,
    rows: [{ tracks: [{ kind: "actor", name: "actor", occurrence: 0, segments }] }],
  };
}

/** The engine's pose of a hand-built track at `now`, in frame units. */
function composed(
  segments: readonly RecordedSegment[],
  fps: number,
  now: number,
): Pose {
  const timeline = trackOf(segments, fps);
  const track = timeline.rows[0]?.tracks[0];
  if (track === undefined) {
    throw new Error("no track");
  }
  return poseAtInstant(timeline, 0, track, now);
}

const TENTH = 100_000;

/**
 * A track drawn from `seed`: poses and reaches on a tenth-of-a-second grid over three
 * seconds, so starts and ends coincide, some of no length and some open-ended.
 */
function drawnTrack(seed: number, count: number): RecordedSegment[] {
  const random = randomSource({
    seed,
    row: 0,
    kind: "test",
    name: "track",
    occurrence: 0,
  });
  let draw = 0;
  const below = (limit: number): number => Math.floor(random.float(draw++) * limit);
  const pick = <T>(from: readonly [T, ...T[]]): T =>
    from[below(from.length)] ?? from[0];
  return Array.from({ length: count }, (): RecordedSegment => {
    const start = below(30) * TENTH;
    const end = below(7) === 0 ? null : start + below(12) * TENTH;
    const phases = {
      mode: pick(["replace", "replace", "replace", "add"] as const),
      anticipation: pick([0, 0, TENTH]),
      blend: pick([0, TENTH, 3 * TENTH]),
      followThrough: pick([0, 0, TENTH]),
    };
    if (below(3) === 0) {
      return {
        start,
        end,
        data: {
          kind: "reach",
          ...phases,
          effector: pick(["handL", "handR", "footL", "footR"] as const),
          target: { x: below(9) / 10 - 0.4, y: below(9) / 10 },
        },
      };
    }
    const channels: Partial<Record<keyof Pose, number>> = {};
    for (const name of ["spine", "shoulderR", "elbowR", "hipL", "kneeL"] as const) {
      if (below(3) === 0) {
        channels[name] = below(21) / 10 - 1;
      }
    }
    return { start, end, data: { kind: "pose", ...phases, channels } };
  });
}

describe("a track of many segments", () => {
  it("composes 2000 segments to the pose asking every earlier segment gives", () => {
    // A walk's shape: each step a pose of the legs that outlasts the next step's start,
    // a reach of a hand and of a foot, over a lean that never ends.
    const segments: RecordedSegment[] = [
      {
        start: 0,
        end: null,
        data: {
          kind: "pose",
          mode: "replace",
          anticipation: 0,
          blend: 2 * TENTH,
          followThrough: 0,
          channels: { spine: 0.2, shoulderL: -0.3 },
        },
      },
      {
        start: 5 * TENTH,
        end: null,
        data: {
          kind: "pose",
          mode: "add",
          anticipation: 0,
          blend: 2 * TENTH,
          followThrough: 0,
          channels: { chest: 0.1, kneeR: -0.1 },
        },
      },
    ];
    for (let step = 0; segments.length < 2000; step += 1) {
      const start = step * TENTH;
      const side = step % 2 === 0 ? "L" : "R";
      const phases = {
        mode: "replace",
        anticipation: 0,
        blend: TENTH,
        followThrough: 0,
      } as const;
      segments.push(
        {
          start,
          end: start + 3 * TENTH,
          data: {
            kind: "pose",
            ...phases,
            channels: { [`hip${side}`]: 0.4, [`knee${side}`]: -0.5, pelvisY: -0.02 },
          },
        },
        {
          start,
          end: start + 2 * TENTH,
          data: {
            kind: "reach",
            ...phases,
            effector: `hand${side}`,
            target: { x: 0.2, y: 0.5 + (step % 5) / 20 },
          },
        },
        {
          start: start + TENTH,
          end: start + 2 * TENTH,
          data: {
            kind: "reach",
            ...phases,
            effector: `foot${side}`,
            target: { x: 0.1, y: 0.05 },
          },
        },
      );
    }
    expect(segments).toHaveLength(2000);
    const fps = 30;
    const last = segments.at(-1)?.start ?? 0;
    for (const now of [
      last * fps + 1_000_000,
      (last / 2) * fps,
      (last + TENTH) * fps,
    ]) {
      expect(composed(segments, fps, now)).toEqual(referencePose(segments, fps, now));
    }
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])(
    "composes drawn track %d to the pose asking every earlier segment gives",
    (seed) => {
      const fps = 20;
      for (const count of [1, 6, 40]) {
        const segments = drawnTrack(seed * 100 + count, count);
        // Every frame of the four seconds, and an instant between two frames.
        for (let frame = 0; frame <= 80; frame += 1) {
          for (const now of [frame * 1_000_000, frame * 1_000_000 + 370_000]) {
            expect(composed(segments, fps, now)).toEqual(
              referencePose(segments, fps, now),
            );
          }
        }
      }
    },
  );

  it("composes a track anew once a segment is recorded on it", () => {
    const segments = drawnTrack(7, 12);
    const fps = 20;
    const now = 40 * 1_000_000;
    expect(composed(segments, fps, now)).toEqual(referencePose(segments, fps, now));
    segments.push({
      start: 0,
      end: 15 * TENTH,
      data: {
        kind: "pose",
        mode: "replace",
        anticipation: 0,
        blend: TENTH,
        followThrough: 0,
        channels: { neck: 0.25, spine: -0.5 },
      },
    });
    const pose = composed(segments, fps, now);
    expect(pose.neck).toBe(0.25);
    expect(pose).toEqual(referencePose(segments, fps, now));
  });

  it("fades an ended pose back to the bounded one beneath it past a hand-built time that is not a number", () => {
    const phases = {
      kind: "pose",
      mode: "replace",
      anticipation: 0,
      blend: TENTH,
      followThrough: 0,
    } as const;
    const segments: RecordedSegment[] = [
      { start: 0, end: 30 * TENTH, data: { ...phases, channels: { spine: 0.5 } } },
      { start: 0, end: Number.NaN, data: { ...phases, channels: { spine: -0.4 } } },
      { start: Number.NaN, end: null, data: { ...phases, channels: { neck: 0.3 } } },
      { start: 0, end: 10 * TENTH, data: { ...phases, channels: { spine: 0.2 } } },
    ];
    const fps = 30;
    // Half the last pose's blend past its end: halfway back from 0.2 to 0.5.
    const now = (10 * TENTH + TENTH / 2) * fps;
    const pose = composed(segments, fps, now);
    expect(pose.spine).toBeCloseTo(0.35, 12);
    expect(pose).toEqual(referencePose(segments, fps, now));
  });

  it("holds an ended pose over an open-ended one past a hand-built time that is not a number", () => {
    const phases = {
      kind: "pose",
      mode: "replace",
      anticipation: 0,
      blend: TENTH,
      followThrough: 0,
    } as const;
    const segments: RecordedSegment[] = [
      { start: 0, end: null, data: { ...phases, channels: { spine: 0.5, neck: 0.1 } } },
      { start: Number.NaN, end: null, data: { ...phases, channels: { chest: 0.3 } } },
      { start: 0, end: Number.NaN, data: { ...phases, channels: { neck: -0.4 } } },
      { start: 0, end: 10 * TENTH, data: { ...phases, channels: { spine: 0.2 } } },
      { start: 0, end: 5 * TENTH, data: { ...phases, channels: { chest: 0.6 } } },
    ];
    const fps = 30;
    for (const now of [
      10 * TENTH * fps,
      (10 * TENTH + TENTH / 2) * fps,
      40 * TENTH * fps,
    ]) {
      const pose = composed(segments, fps, now);
      // A pose with no end that is a number never takes the neck from the first.
      expect(pose).toMatchObject({ spine: 0.2, neck: 0.1 });
      expect(pose).toEqual(referencePose(segments, fps, now));
    }
  });

  it("composes the same segments at another frame rate", () => {
    const segments = drawnTrack(8, 12);
    for (const fps of [20, 50, 20]) {
      for (const frame of [0, 1, 2, 3].map((second) => second * fps)) {
        const now = frame * 1_000_000;
        expect(composed(segments, fps, now)).toEqual(referencePose(segments, fps, now));
      }
    }
  });
});
