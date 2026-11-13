import { CharadeError } from "../errors.js";

/** The fourteen angles: the thirteen joints of the tree and `pelvis`, the root's tilt. */
export const ANGLE_NAMES = [
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
] as const;

export type AngleName = (typeof ANGLE_NAMES)[number];

/** The root's position, as an offset from where it stands at rest. */
export const ROOT_NAMES = ["pelvisX", "pelvisY"] as const;

export type RootName = (typeof ROOT_NAMES)[number];

export const FACE_NAMES = [
  "eyeOpen",
  "gazeX",
  "gazeY",
  "browHeight",
  "browTilt",
  "mouthCurve",
  "mouthOpen",
  "mouthWidth",
] as const;

export type FaceName = (typeof FACE_NAMES)[number];

export type ChannelName = AngleName | RootName | FaceName;

export const CHANNEL_NAMES: readonly ChannelName[] = [
  ...ANGLE_NAMES,
  ...ROOT_NAMES,
  ...FACE_NAMES,
];

/** Every channel of the figure at one instant: angles, root and face. */
export type Pose = Readonly<Record<ChannelName, number>>;

/** Targets for `reach`; not angles. */
export const EFFECTOR_NAMES = ["handL", "handR", "footL", "footR"] as const;

export type EffectorName = (typeof EFFECTOR_NAMES)[number];

/** The two angles inverse kinematics sets to put an effector on its target. */
export const EFFECTOR_CHAINS: Readonly<
  Record<EffectorName, readonly [AngleName, AngleName]>
> = {
  handL: ["shoulderL", "elbowL"],
  handR: ["shoulderR", "elbowR"],
  footL: ["hipL", "kneeL"],
  footR: ["hipR", "kneeR"],
};

/** Segment lengths in units of figure height; a rest figure is 1 unit tall. */
export const SEGMENT_LENGTHS = {
  thigh: 0.24,
  shin: 0.24,
  spine: 0.14,
  chest: 0.14,
  neck: 0.06,
  head: 0.18,
  upperArm: 0.17,
  forearm: 0.16,
  foot: 0.08,
} as const;

export interface Range {
  readonly min: number;
  readonly max: number;
}

/**
 * Joint limits in radians. `pelvis` is unbounded: it is the whole body's tilt, which a
 * lie-down or a flip uses in full.
 */
export const ANGLE_LIMITS: Readonly<Record<AngleName, Range>> = {
  pelvis: { min: -Infinity, max: Infinity },
  spine: { min: -0.3, max: 0.9 },
  chest: { min: -0.3, max: 0.7 },
  neck: { min: -0.7, max: 0.9 },
  shoulderL: { min: -1.0, max: 3.1 },
  shoulderR: { min: -1.0, max: 3.1 },
  elbowL: { min: 0, max: 2.6 },
  elbowR: { min: 0, max: 2.6 },
  hipL: { min: -0.5, max: 2.1 },
  hipR: { min: -0.5, max: 2.1 },
  kneeL: { min: 0, max: 2.6 },
  kneeR: { min: 0, max: 2.6 },
  ankleL: { min: -0.6, max: 0.5 },
  ankleR: { min: -0.6, max: 0.5 },
};

export const FACE_RANGES: Readonly<Record<FaceName, Range>> = {
  eyeOpen: { min: 0, max: 1.5 },
  gazeX: { min: -1, max: 1 },
  gazeY: { min: -1, max: 1 },
  browHeight: { min: -1, max: 1 },
  browTilt: { min: -1, max: 1 },
  mouthCurve: { min: -1, max: 1 },
  mouthOpen: { min: 0, max: 1 },
  mouthWidth: { min: 0.5, max: 1.5 },
};

/** Every angle and root offset 0; the face open-eyed, level and neutral. */
export const REST_POSE: Pose = {
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

/**
 * Whether `value` lies in `range`, ends included. Every limit has the same sign
 * convention, so this one range test is the whole check; `NaN` is never within.
 */
export function isWithin(range: Range, value: number): boolean {
  return value >= range.min && value <= range.max;
}

/** The angles of `pose` outside their limits, in {@link ANGLE_NAMES} order. */
export function anglesOutsideLimits(pose: Pose): AngleName[] {
  return ANGLE_NAMES.filter((name) => !isWithin(ANGLE_LIMITS[name], pose[name]));
}

/**
 * An effector was used as a channel. It is a target for `reach`, not an angle; `chain`
 * names the angles that move it. Carries names, never the rejected value.
 */
export class EffectorAsChannelError extends CharadeError {
  readonly code = "ERR_SCENE_EFFECTOR_AS_CHANNEL" as const;

  readonly effector: EffectorName;

  readonly chain: readonly [AngleName, AngleName];

  constructor(effector: EffectorName) {
    const chain = EFFECTOR_CHAINS[effector];
    super(
      `${effector} is a target for reach, not an angle; set ${chain[0]} and ${chain[1]} instead.`,
    );
    this.effector = effector;
    this.chain = chain;
  }
}

/** Throws {@link EffectorAsChannelError} for the first effector named in `channels`. */
export function rejectEffectors(channels: Readonly<Record<string, unknown>>): void {
  for (const effector of EFFECTOR_NAMES) {
    if (Object.hasOwn(channels, effector)) {
      throw new EffectorAsChannelError(effector);
    }
  }
}

/**
 * Linear interpolation of every channel from `from` (progress 0) to `to` (progress 1).
 * The endpoints are returned exactly. Progress outside 0..1 extrapolates, so an easing
 * that overshoots carries through. Angles are not wrapped: a `pelvis` going from 0 to
 * 2π turns the figure all the way over.
 */
export function interpolatePose(from: Pose, to: Pose, progress: number): Pose {
  if (progress === 0) {
    return { ...from };
  }
  if (progress === 1) {
    return { ...to };
  }
  const result: Record<ChannelName, number> = { ...from };
  for (const name of CHANNEL_NAMES) {
    // This form, unlike (1 - p)·a + p·b, keeps a held channel exact, so an angle held
    // at its limit is never pushed past it by a rounding step.
    result[name] = from[name] + progress * (to[name] - from[name]);
  }
  return result;
}
