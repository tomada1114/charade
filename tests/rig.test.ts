import { describe, expect, it } from "vitest";

import { CharadeError } from "../src/index.js";
import {
  forwardKinematics,
  mirrorSkeleton,
  POINT_NAMES,
  type Skeleton,
} from "../src/rig/kinematics.js";
import {
  ANGLE_LIMITS,
  ANGLE_NAMES,
  type AngleName,
  anglesOutsideLimits,
  EffectorAsChannelError,
  FACE_NAMES,
  FACE_RANGES,
  interpolatePose,
  isWithin,
  type Pose,
  rejectEffectors,
  REST_POSE,
} from "../src/rig/rig.js";

/** Forward kinematics is trigonometry; positions are compared to 1e-12 units. */
const DIGITS = 12;

/** A matcher for the point `(x, y)` to {@link DIGITS} digits. */
function near(x: number, y: number): unknown {
  return { x: closeTo(x), y: closeTo(y) };
}

function closeTo(value: number): unknown {
  return expect.closeTo(value, DIGITS);
}

function posed(channels: Partial<Pose>): Pose {
  return { ...REST_POSE, ...channels };
}

function effectorErrorOf(run: () => unknown): EffectorAsChannelError | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof EffectorAsChannelError ? error : undefined;
  }
  return undefined;
}

describe("the rig's names", () => {
  it("has the fourteen angles in tree order", () => {
    expect(ANGLE_NAMES).toEqual([
      "pelvis",
      "spine",
      "chest",
      "neck",
      "shoulderL",
      "shoulderR",
      "elbowL",
      "elbowR",
      "hipL",
      "hipR",
      "kneeL",
      "kneeR",
      "ankleL",
      "ankleR",
    ]);
  });

  it("has the eight face numbers", () => {
    expect(FACE_NAMES).toEqual([
      "eyeOpen",
      "gazeX",
      "gazeY",
      "browHeight",
      "browTilt",
      "mouthCurve",
      "mouthOpen",
      "mouthWidth",
    ]);
  });
});

describe("forwardKinematics at rest", () => {
  const rest = forwardKinematics(REST_POSE);

  it("puts the head top 1 unit above the ground", () => {
    expect(rest.headTop).toEqual(near(0, 1));
  });

  it("puts both ankles and both toes on the ground", () => {
    expect(rest.ankleL).toEqual(near(0, 0));
    expect(rest.ankleR).toEqual(near(0, 0));
    expect(rest.toeL).toEqual(near(0.08, 0));
    expect(rest.toeR).toEqual(near(0.08, 0));
  });

  it.each<[string, keyof Skeleton, number]>([
    ["pelvis on 0.24 + 0.24 of leg", "pelvis", 0.48],
    ["knees halfway down", "kneeR", 0.24],
    ["waist one spine segment up", "waist", 0.62],
    ["shoulders one chest segment up", "shoulders", 0.76],
    ["head base one neck up", "headBase", 0.82],
    ["head centre half a head up", "headCentre", 0.91],
    ["elbows one upper arm below the shoulders", "elbowL", 0.59],
    ["hands one forearm below the elbows", "handR", 0.43],
  ])("stacks the %s", (_label, name, y) => {
    expect(rest[name]).toEqual(near(0, y));
  });
});

describe("forwardKinematics signs", () => {
  const quarter = Math.PI / 2;

  it.each<[string, Partial<Pose>, keyof Skeleton, number, number]>([
    ["a positive hip swings the knee forward", { hipR: quarter }, "kneeR", 0.24, 0.48],
    ["a positive knee folds the shin back", { kneeR: quarter }, "ankleR", -0.24, 0.24],
    ["a positive ankle lifts the toe", { ankleR: quarter }, "toeR", 0, 0.08],
    [
      "a positive shoulder raises the arm forward",
      { shoulderR: quarter },
      "handR",
      0.33,
      0.76,
    ],
    [
      "a positive elbow lifts the forearm forward",
      { elbowR: quarter },
      "handR",
      0.16,
      0.59,
    ],
    [
      "a positive spine bends the back forward",
      { spine: quarter },
      "shoulders",
      0.28,
      0.48,
    ],
    [
      "a positive chest bends the upper back forward",
      { chest: quarter },
      "shoulders",
      0.14,
      0.62,
    ],
    ["a positive neck nods the head forward", { neck: quarter }, "headTop", 0.24, 0.76],
    [
      "a positive pelvis tilts the torso forward",
      { pelvis: quarter },
      "shoulders",
      0.28,
      0.48,
    ],
    [
      "a positive pelvis swings the legs back",
      { pelvis: quarter },
      "kneeL",
      -0.24,
      0.48,
    ],
    [
      "the left side mirrors the right in angle",
      { hipL: quarter },
      "kneeL",
      0.24,
      0.48,
    ],
  ])("%s", (_label, channels, name, x, y) => {
    expect(forwardKinematics(posed(channels))[name]).toEqual(near(x, y));
  });

  it("moves the whole figure by the root offset from rest", () => {
    const skeleton = forwardKinematics(posed({ pelvisX: 0.5, pelvisY: -0.2 }));
    expect(skeleton.pelvis).toEqual(near(0.5, 0.28));
    expect(skeleton.headTop).toEqual(near(0.5, 0.8));
    expect(skeleton.ankleR).toEqual(near(0.5, -0.2));
  });
});

describe("joint limits", () => {
  const bounded = ANGLE_NAMES.filter((name) => name !== "pelvis");

  it.each(bounded)("accepts %s exactly at its minimum and maximum", (name) => {
    const { min, max } = ANGLE_LIMITS[name];
    expect(isWithin(ANGLE_LIMITS[name], min)).toBe(true);
    expect(isWithin(ANGLE_LIMITS[name], max)).toBe(true);
  });

  it.each(bounded)("rejects %s just past either end", (name) => {
    const { min, max } = ANGLE_LIMITS[name];
    expect(isWithin(ANGLE_LIMITS[name], min - 1e-9)).toBe(false);
    expect(isWithin(ANGLE_LIMITS[name], max + 1e-9)).toBe(false);
  });

  it.each(ANGLE_NAMES)("never counts NaN as within the limit of %s", (name) => {
    expect(isWithin(ANGLE_LIMITS[name], Number.NaN)).toBe(false);
  });

  it.each<[string, AngleName, number, boolean]>([
    ["kneeR 1.2 is inside 0..2.6", "kneeR", 1.2, true],
    ["kneeR 0 is inside", "kneeR", 0, true],
    ["kneeR 2.6 is inside", "kneeR", 2.6, true],
    ["kneeR -0.4 is a knee bent backwards", "kneeR", -0.4, false],
    ["elbowL -0.1 is an elbow bent backwards", "elbowL", -0.1, false],
    ["spine -0.3 is the edge of an arch", "spine", -0.3, true],
    ["shoulderR 3.1 is an arm straight up", "shoulderR", 3.1, true],
    ["ankleL -0.6 is the end of pointing the toe", "ankleL", -0.6, true],
  ])("%s", (_label, name, value, within) => {
    expect(isWithin(ANGLE_LIMITS[name], value)).toBe(within);
  });

  it.each([2 * Math.PI, -2 * Math.PI, 1e9])(
    "leaves the pelvis tilt %s unbounded",
    (value) => {
      expect(isWithin(ANGLE_LIMITS.pelvis, value)).toBe(true);
    },
  );

  it("finds no angle outside its limit at rest", () => {
    expect(anglesOutsideLimits(REST_POSE)).toEqual([]);
  });

  it("names every angle outside its limit, in rig order", () => {
    const pose = posed({ kneeR: -0.4, elbowL: 2.7, hipR: 2.1 });
    expect(anglesOutsideLimits(pose)).toEqual(["elbowL", "kneeR"]);
  });

  it("holds the rest face inside every face range", () => {
    for (const name of FACE_NAMES) {
      expect(isWithin(FACE_RANGES[name], REST_POSE[name])).toBe(true);
    }
  });
});

describe("rejectEffectors", () => {
  it.each<[string, string, string]>([
    ["handL", "shoulderL", "elbowL"],
    ["handR", "shoulderR", "elbowR"],
    ["footL", "hipL", "kneeL"],
    ["footR", "hipR", "kneeR"],
  ])("rejects %s as a channel, naming %s and %s", (effector, first, second) => {
    const error = effectorErrorOf(() => {
      rejectEffectors({ kneeL: 0.3, [effector]: 1 });
    });
    expect(error).toBeInstanceOf(CharadeError);
    expect(error?.code).toBe("ERR_SCENE_EFFECTOR_AS_CHANNEL");
    expect(error?.effector).toBe(effector);
    expect(error?.chain).toEqual([first, second]);
  });

  it("carries names, never the rejected value", () => {
    const error = effectorErrorOf(() => {
      rejectEffectors({ handR: 0.123_456 });
    });
    expect(error).toBeInstanceOf(EffectorAsChannelError);
    expect(Object.values(error ?? {})).not.toContain(0.123_456);
  });

  it("accepts a map of angles, root and face", () => {
    expect(() => {
      rejectEffectors({ kneeR: 1.2, pelvisY: -0.1, mouthCurve: 0.5 });
    }).not.toThrow();
  });

  it("accepts an empty map", () => {
    expect(() => {
      rejectEffectors({});
    }).not.toThrow();
  });
});

describe("interpolatePose", () => {
  // 0.7 + (0.1 - 0.7) × 1 is 0.09999999999999998 and 0.3 + (0.9 - 0.3) × 1 is
  // 0.9000000000000001, so these catch an endpoint computed by the formula.
  const from = posed({ kneeR: 0.7, hipR: 0.3, pelvis: 0, mouthCurve: -1 });
  const to = posed({ kneeR: 0.1, hipR: 0.9, pelvis: 2 * Math.PI, mouthCurve: 1 });

  it("returns the first pose exactly at progress 0", () => {
    expect(interpolatePose(from, to, 0)).toEqual(from);
  });

  it("returns the second pose exactly at progress 1", () => {
    const result = interpolatePose(from, to, 1);
    expect(result).toEqual(to);
    expect(result.kneeR).toBe(0.1);
    expect(result.hipR).toBe(0.9);
  });

  it("returns a copy, not either input", () => {
    expect(interpolatePose(from, to, 0)).not.toBe(from);
    expect(interpolatePose(from, to, 1)).not.toBe(to);
  });

  it("is halfway at progress 0.5, the pelvis included without wrapping", () => {
    const result = interpolatePose(from, to, 0.5);
    expect(result.kneeR).toBeCloseTo(0.4, DIGITS);
    expect(result.hipR).toBeCloseTo(0.6, DIGITS);
    expect(result.pelvis).toBeCloseTo(Math.PI, DIGITS);
    expect(result.mouthCurve).toBeCloseTo(0, DIGITS);
    expect(result.eyeOpen).toBe(1);
  });

  it.each([0.063, 0.3, 0.5, 0.77])(
    "keeps a channel held at its limit exactly at progress %s",
    (progress) => {
      // (1 - p)·2.6 + p·2.6 is 2.6000000000000005 at p 0.063, past the knee's limit.
      const held = posed({ kneeR: 2.6 });
      const result = interpolatePose(held, posed({ kneeR: 2.6, hipR: 1 }), progress);
      expect(result.kneeR).toBe(2.6);
      expect(anglesOutsideLimits(result)).toEqual([]);
    },
  );

  it("extrapolates past progress 1, so an overshooting easing carries through", () => {
    expect(interpolatePose(from, to, 1.5).hipR).toBeCloseTo(1.2, DIGITS);
    expect(interpolatePose(from, to, -0.5).hipR).toBeCloseTo(0, DIGITS);
  });
});

describe("mirrorSkeleton", () => {
  const skeleton = forwardKinematics(
    posed({
      pelvis: 0.2,
      spine: 0.4,
      neck: -0.3,
      shoulderR: 1.1,
      elbowR: 0.8,
      shoulderL: -0.6,
      hipR: 0.9,
      kneeR: 1.4,
      hipL: -0.2,
      ankleL: 0.3,
      pelvisX: 0.25,
    }),
  );

  it("negates every x and keeps every y under the same names, so R stays the near limb", () => {
    const mirrored = mirrorSkeleton(skeleton);
    for (const name of POINT_NAMES) {
      expect(mirrored[name]).toEqual({ x: -skeleton[name].x, y: skeleton[name].y });
    }
  });

  it("gives back the original pose exactly when mirrored twice", () => {
    expect(mirrorSkeleton(mirrorSkeleton(skeleton))).toEqual(skeleton);
  });

  it("gives back the rest pose exactly when mirrored twice", () => {
    const rest = forwardKinematics(REST_POSE);
    expect(mirrorSkeleton(mirrorSkeleton(rest))).toEqual(rest);
  });
});
