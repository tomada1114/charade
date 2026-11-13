import { describe, expect, it } from "vitest";

import { reach, wrapAngle } from "../src/rig/ik.js";
import { forwardKinematics, type Point } from "../src/rig/kinematics.js";
import {
  CHANNEL_NAMES,
  type EffectorName,
  type Pose,
  REST_POSE,
} from "../src/rig/rig.js";

/** IK lands an effector on its target to 1e-9 units; angles are compared to 1e-12. */
const LANDING_DIGITS = 9;
const ANGLE_DIGITS = 12;

// Rest geometry: hips at (0, 0.48), thigh and shin 0.24 each; shoulders at (0, 0.76),
// upper arm 0.17 and forearm 0.16.
const HIP: Point = { x: 0, y: 0.48 };
const SHOULDER: Point = { x: 0, y: 0.76 };

const END_POINT: Record<EffectorName, "handL" | "handR" | "ankleL" | "ankleR"> = {
  handL: "handL",
  handR: "handR",
  footL: "ankleL",
  footR: "ankleR",
};

/** Where `effector` ends up in `pose`. */
function landing(pose: Pose, effector: EffectorName): Point {
  return forwardKinematics(pose)[END_POINT[effector]];
}

/** A matcher for `target` to {@link LANDING_DIGITS} digits. */
function near(target: Point): unknown {
  return { x: closeTo(target.x), y: closeTo(target.y) };
}

function closeTo(value: number): unknown {
  return expect.closeTo(value, LANDING_DIGITS);
}

/** z of `(b - a) × (c - b)`: positive when the limb turns counter-clockwise at `b`. */
function turn(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

/** The channels of `pose` that are not finite numbers. */
function nonFinite(pose: Pose): string[] {
  return CHANNEL_NAMES.filter((name) => !Number.isFinite(pose[name]));
}

function posed(channels: Partial<Pose>): Pose {
  return { ...REST_POSE, ...channels };
}

describe("reach with a reachable leg target", () => {
  const target = { x: HIP.x + 0.1, y: HIP.y - 0.35 };
  const pose = reach(REST_POSE, "footR", target);

  it("lands footR 0.1 in front of the hip and 0.35 below it", () => {
    expect(landing(pose, "footR")).toEqual(near(target));
  });

  it("bends that knee forward, a positive kneeR inside its limit", () => {
    const skeleton = forwardKinematics(pose);
    expect(pose.kneeR).toBeGreaterThan(0);
    expect(pose.kneeR).toBeLessThanOrEqual(2.6);
    // The thigh turns clockwise into the shin when the knee points forward.
    expect(turn(skeleton.pelvis, skeleton.kneeR, skeleton.ankleR)).toBeLessThan(0);
  });

  it("leaves every other channel as it was", () => {
    for (const name of CHANNEL_NAMES) {
      if (name !== "hipR" && name !== "kneeR") {
        expect(pose[name]).toBe(REST_POSE[name]);
      }
    }
  });

  it("solves the equilateral case: one bone length straight below the hip", () => {
    // Thigh, shin and hip-to-ankle are all 0.24: every interior angle is π/3, so the
    // thigh swings π/3 forward of straight down and the knee bends 2π/3.
    const result = reach(REST_POSE, "footR", { x: 0, y: 0.24 });
    expect(result.hipR).toBeCloseTo(Math.PI / 3, ANGLE_DIGITS);
    expect(result.kneeR).toBeCloseTo((2 * Math.PI) / 3, ANGLE_DIGITS);
  });

  it("solves the left leg the same way", () => {
    const result = reach(REST_POSE, "footL", { x: 0, y: 0.24 });
    expect(result.hipL).toBeCloseTo(Math.PI / 3, ANGLE_DIGITS);
    expect(result.kneeL).toBeCloseTo((2 * Math.PI) / 3, ANGLE_DIGITS);
    expect(result.hipR).toBe(0);
  });
});

describe("reach with a reachable arm target", () => {
  it("solves the right-angle case: the upper arm down and the forearm forward", () => {
    // Upper arm 0.17 straight down puts the elbow at (0, 0.59); the forearm 0.16
    // forward from there ends at (0.16, 0.59).
    const result = reach(REST_POSE, "handR", { x: 0.16, y: 0.59 });
    expect(result.shoulderR).toBeCloseTo(0, ANGLE_DIGITS);
    expect(result.elbowR).toBeCloseTo(Math.PI / 2, ANGLE_DIGITS);
  });

  it("bends the elbow backward: the upper arm turns counter-clockwise into the forearm", () => {
    const target = { x: 0.2, y: 0.9 };
    const pose = reach(REST_POSE, "handL", target);
    const skeleton = forwardKinematics(pose);
    expect(landing(pose, "handL")).toEqual(near(target));
    expect(pose.elbowL).toBeGreaterThan(0);
    expect(turn(skeleton.shoulders, skeleton.elbowL, skeleton.handL)).toBeGreaterThan(
      0,
    );
  });
});

describe("reach overhead", () => {
  // The shoulder's limit −1.0..3.1 is centred on 1.05, so its turn is read in
  // [1.05 − π, 1.05 + π): an arm straight up is +π, never −π.
  it.each<[string, number, number]>([
    ["straight up", 0, Math.PI],
    ["just in front of straight up", 0.01, Math.PI - Math.atan2(0.01, 0.44)],
    ["just behind straight up", -0.01, Math.PI + Math.atan2(0.01, 0.44)],
  ])("raises the arm %s with a positive shoulder", (_label, x, shoulder) => {
    // The shoulders are at y 0.76, so a target at y 1.2 is 0.44 above them, beyond
    // the arm's 0.33 reach: the arm extends straight toward it.
    const pose = reach(REST_POSE, "handR", { x, y: 1.2 });
    expect(pose.shoulderR).toBeCloseTo(shoulder, ANGLE_DIGITS);
    expect(pose.elbowR).toBe(0);
  });
});

describe("reach from a posed parent", () => {
  const parent = posed({
    pelvis: 0.3,
    spine: 0.4,
    chest: 0.2,
    pelvisX: 0.1,
    pelvisY: -0.05,
  });

  it("lands a hand target up and behind the tilted shoulders", () => {
    const shoulders = forwardKinematics(parent).shoulders;
    const target = { x: shoulders.x - 0.1, y: shoulders.y + 0.2 };
    const pose = reach(parent, "handR", target);
    const skeleton = forwardKinematics(pose);
    expect(landing(pose, "handR")).toEqual(near(target));
    expect(pose.elbowR).toBeGreaterThan(0);
    expect(turn(skeleton.shoulders, skeleton.elbowR, skeleton.handR)).toBeGreaterThan(
      0,
    );
    // Up and behind is past straight up, so it reads as more than π/2, not negative.
    expect(pose.shoulderR).toBeGreaterThan(Math.PI / 2);
  });

  it("lands a foot target from a tilted, offset pelvis with the knee forward", () => {
    const target = { x: 0.3, y: 0.05 };
    const pose = reach(parent, "footL", target);
    const skeleton = forwardKinematics(pose);
    expect(landing(pose, "footL")).toEqual(near(target));
    expect(turn(skeleton.pelvis, skeleton.kneeL, skeleton.ankleL)).toBeLessThan(0);
  });
});

describe("reach with a target it cannot meet", () => {
  it("extends the leg straight toward a target out of reach", () => {
    const pose = reach(REST_POSE, "footR", { x: 5, y: 0.48 });
    expect(nonFinite(pose)).toEqual([]);
    expect(pose.hipR).toBeCloseTo(Math.PI / 2, ANGLE_DIGITS);
    expect(pose.kneeR).toBe(0);
    expect(landing(pose, "footR")).toEqual(near({ x: 0.48, y: 0.48 }));
  });

  it("extends the arm straight toward a target out of reach", () => {
    const pose = reach(REST_POSE, "handR", { x: 0, y: -100 });
    expect(nonFinite(pose)).toEqual([]);
    expect(pose.shoulderR).toBeCloseTo(0, ANGLE_DIGITS);
    expect(pose.elbowR).toBe(0);
    expect(landing(pose, "handR")).toEqual(near({ x: 0, y: 0.43 }));
  });

  it("folds the arm fully toward a target closer than the bones' difference", () => {
    // 0.17 down then 0.16 back up leaves the hand 0.01 below the shoulder.
    const pose = reach(REST_POSE, "handR", { x: 0, y: SHOULDER.y - 0.005 });
    expect(nonFinite(pose)).toEqual([]);
    expect(pose.elbowR).toBeCloseTo(Math.PI, ANGLE_DIGITS);
    expect(landing(pose, "handR")).toEqual(near({ x: 0, y: 0.75 }));
  });

  it("folds the arm along its rest direction for a target on the shoulder", () => {
    const pose = reach(REST_POSE, "handL", SHOULDER);
    expect(nonFinite(pose)).toEqual([]);
    expect(pose.shoulderL).toBeCloseTo(0, ANGLE_DIGITS);
    expect(landing(pose, "handL")).toEqual(near({ x: 0, y: 0.75 }));
  });

  it("folds the leg flat with the thigh forward for a target on the hip", () => {
    // Equal bones meet a target on the hip only fully folded; the thigh lies
    // horizontal, a quarter turn forward of its rest direction.
    const pose = reach(REST_POSE, "footR", HIP);
    expect(nonFinite(pose)).toEqual([]);
    expect(pose.hipR).toBeCloseTo(Math.PI / 2, ANGLE_DIGITS);
    expect(pose.kneeR).toBeCloseTo(Math.PI, ANGLE_DIGITS);
    expect(landing(pose, "footR")).toEqual(near(HIP));
  });

  it.each<[string, EffectorName, Point]>([
    ["footR far below", "footR", { x: 0, y: -1e6 }],
    ["footL far behind", "footL", { x: -1e6, y: 0.48 }],
    ["handR far above", "handR", { x: 0, y: Number.MAX_SAFE_INTEGER }],
    ["handL far in front", "handL", { x: 1e6, y: 0 }],
    ["footR a hair off the hip", "footR", { x: 1e-15, y: 0.48 }],
    ["handR just behind the shoulder", "handR", { x: -0.001, y: 0.76 }],
    ["footL at the origin", "footL", { x: 0, y: 0 }],
  ])("returns finite angles for %s", (_label, effector, target) => {
    expect(nonFinite(reach(REST_POSE, effector, target))).toEqual([]);
  });
});

describe("wrapAngle", () => {
  it.each([
    ["zero stays", 0, 0],
    ["a small angle stays", 1, 1],
    ["-π stays", -Math.PI, -Math.PI],
    ["π becomes -π", Math.PI, -Math.PI],
    ["a full turn becomes zero", 2 * Math.PI, 0],
    ["7 loses one turn", 7, 7 - 2 * Math.PI],
    ["-4 gains one turn", -4, -4 + 2 * Math.PI],
  ])("%s", (_label, angle, wrapped) => {
    expect(wrapAngle(angle)).toBeCloseTo(wrapped, ANGLE_DIGITS);
  });
});
