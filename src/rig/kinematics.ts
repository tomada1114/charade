import { type Pose, SEGMENT_LENGTHS } from "./rig.js";

/**
 * A point in a row's own units: the origin on the ground line at the row's centre,
 * `y` up, a standing figure 1 unit tall.
 *
 * @public
 */
export interface Point {
  /** Distance right of the row's centre. */
  readonly x: number;
  /** Height above the ground line. */
  readonly y: number;
}

/** The points forward kinematics places, each the far end of a segment. */
export const POINT_NAMES = [
  "pelvis",
  "waist",
  "shoulders",
  "headBase",
  "headCentre",
  "headTop",
  "elbowL",
  "elbowR",
  "handL",
  "handR",
  "kneeL",
  "kneeR",
  "ankleL",
  "ankleR",
  "toeL",
  "toeR",
] as const;

export type PointName = (typeof POINT_NAMES)[number];

/** Joint positions in the actor's own frame, facing right: `x` forward, `y` up. */
export type Skeleton = Readonly<Record<PointName, Point>>;

/**
 * World directions of a figure's segments, counter-clockwise from `+x`. A joint whose
 * flex turns its segment clockwise in the right-facing picture (bending the back, the
 * neck or the knee forward) subtracts its angle; the others add it.
 */
export interface SegmentDirections {
  readonly base: number;
  readonly spine: number;
  readonly chest: number;
  readonly neck: number;
  readonly upperArmL: number;
  readonly upperArmR: number;
  readonly thighL: number;
  readonly thighR: number;
}

/** Where the pelvis sits when every channel is 0: on top of two straight legs. */
export const REST_PELVIS_HEIGHT: number = SEGMENT_LENGTHS.thigh + SEGMENT_LENGTHS.shin;

/** The parent directions inverse kinematics solves a limb against. */
export function segmentDirections(pose: Pose): SegmentDirections {
  // A positive pelvis tilt leans the figure forward, which is clockwise facing right.
  const base = -pose.pelvis;
  const spine = Math.PI / 2 + base - pose.spine;
  const chest = spine - pose.chest;
  return {
    base,
    spine,
    chest,
    neck: chest - pose.neck,
    upperArmL: chest - Math.PI + pose.shoulderL,
    upperArmR: chest - Math.PI + pose.shoulderR,
    thighL: base - Math.PI / 2 + pose.hipL,
    thighR: base - Math.PI / 2 + pose.hipR,
  };
}

/** The root point of `pose`: its rest position plus the root offset. */
export function pelvisPoint(pose: Pose): Point {
  return { x: pose.pelvisX, y: REST_PELVIS_HEIGHT + pose.pelvisY };
}

/** The shoulder point of `pose`, where both arms hang. */
export function shoulderPoint(
  pose: Pose,
  directions: SegmentDirections = segmentDirections(pose),
): Point {
  const waist = step(pelvisPoint(pose), directions.spine, SEGMENT_LENGTHS.spine);
  return step(waist, directions.chest, SEGMENT_LENGTHS.chest);
}

/** Forward kinematics: every joint position of `pose`, facing right. */
export function forwardKinematics(pose: Pose): Skeleton {
  const d = segmentDirections(pose);
  const L = SEGMENT_LENGTHS;
  const pelvis = pelvisPoint(pose);
  const waist = step(pelvis, d.spine, L.spine);
  const shoulders = step(waist, d.chest, L.chest);
  const headBase = step(shoulders, d.neck, L.neck);
  const forearmL = d.upperArmL + pose.elbowL;
  const forearmR = d.upperArmR + pose.elbowR;
  const elbowL = step(shoulders, d.upperArmL, L.upperArm);
  const elbowR = step(shoulders, d.upperArmR, L.upperArm);
  const shinL = d.thighL - pose.kneeL;
  const shinR = d.thighR - pose.kneeR;
  const kneeL = step(pelvis, d.thighL, L.thigh);
  const kneeR = step(pelvis, d.thighR, L.thigh);
  const ankleL = step(kneeL, shinL, L.shin);
  const ankleR = step(kneeR, shinR, L.shin);
  return {
    pelvis,
    waist,
    shoulders,
    headBase,
    headCentre: step(headBase, d.neck, L.head / 2),
    headTop: step(headBase, d.neck, L.head),
    elbowL,
    elbowR,
    handL: step(elbowL, forearmL, L.forearm),
    handR: step(elbowR, forearmR, L.forearm),
    kneeL,
    kneeR,
    ankleL,
    ankleR,
    toeL: step(ankleL, shinL + Math.PI / 2 + pose.ankleL, L.foot),
    toeR: step(ankleR, shinR + Math.PI / 2 + pose.ankleR, L.foot),
  };
}

/**
 * The skeleton as drawn facing left: every `x` negated, names kept, so `R` stays the
 * limb nearer the camera. Negation is exact, so mirroring twice gives back the input.
 */
export function mirrorSkeleton(skeleton: Skeleton): Skeleton {
  const result: Record<PointName, Point> = { ...skeleton };
  for (const name of POINT_NAMES) {
    const point = skeleton[name];
    result[name] = { x: -point.x, y: point.y };
  }
  return result;
}

function step(from: Point, direction: number, length: number): Point {
  return {
    x: from.x + Math.cos(direction) * length,
    y: from.y + Math.sin(direction) * length,
  };
}
