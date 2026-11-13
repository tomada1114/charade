import {
  pelvisPoint,
  type Point,
  segmentDirections,
  shoulderPoint,
} from "./kinematics.js";
import {
  ANGLE_LIMITS,
  type ChannelName,
  EFFECTOR_CHAINS,
  type EffectorName,
  type Pose,
  SEGMENT_LENGTHS,
} from "./rig.js";

const ON_ROOT = 1e-9;

/** Which way the second bone turns from the first, seen facing right. */
export type BendSide = "counterClockwise" | "clockwise";

export interface TwoBoneSolution {
  /** World direction of the first bone, counter-clockwise from `+x`. */
  readonly direction: number;
  /** How far the second bone turns from straight, 0..π, toward `side`. */
  readonly bend: number;
}

/**
 * Analytic two-bone inverse kinematics from a root at the origin to `(dx, dy)`. The
 * middle joint always goes to the same side, so a limb never bends the wrong way. A
 * target beyond reach is met by the fully extended limb pointing at it; one closer
 * than `|first − second|` by the fully folded limb pointing at it. A target within
 * 1e-9 units of the root has no direction of its own, so `restDirection` stands in.
 */
export function solveTwoBone(
  first: number,
  second: number,
  dx: number,
  dy: number,
  side: BendSide,
  restDirection: number,
): TwoBoneSolution {
  const distance = Math.hypot(dx, dy);
  // Within rounding of the root, the direction to the target is noise.
  const toTarget = distance < ON_ROOT ? restDirection : Math.atan2(dy, dx);
  const reach = Math.min(Math.max(distance, Math.abs(first - second)), first + second);
  const denominator = 2 * first * reach;
  // Equal bones and a target on the root give 0/0; the limit of the formula is 0.
  const cosRoot =
    denominator === 0
      ? 0
      : clampUnit((first * first + reach * reach - second * second) / denominator);
  const cosMiddle = clampUnit(
    (first * first + second * second - reach * reach) / (2 * first * second),
  );
  const rootAngle = Math.acos(cosRoot);
  // The first bone turns away from the target opposite to where the second bone bends.
  return {
    direction: side === "clockwise" ? toTarget + rootAngle : toTarget - rootAngle,
    bend: Math.PI - Math.acos(cosMiddle),
  };
}

/**
 * `pose` with the two angles of `effector`'s chain set so the effector lands on
 * `target`, in the actor's own frame facing right. A knee bends forward and an elbow
 * backward, whatever the target. The angles come back finite for any finite target.
 */
export function reach(pose: Pose, effector: EffectorName, target: Point): Pose {
  const directions = segmentDirections(pose);
  const [rootAngleName, middleAngleName] = EFFECTOR_CHAINS[effector];
  const isLeg = effector === "footL" || effector === "footR";
  const root = isLeg ? pelvisPoint(pose) : shoulderPoint(pose);
  // The direction the first bone points when its own angle is 0.
  const parent = isLeg ? directions.base - Math.PI / 2 : directions.chest - Math.PI;
  const solution = isLeg
    ? solveTwoBone(
        SEGMENT_LENGTHS.thigh,
        SEGMENT_LENGTHS.shin,
        target.x - root.x,
        target.y - root.y,
        "clockwise",
        parent,
      )
    : solveTwoBone(
        SEGMENT_LENGTHS.upperArm,
        SEGMENT_LENGTHS.forearm,
        target.x - root.x,
        target.y - root.y,
        "counterClockwise",
        parent,
      );
  const result: Record<ChannelName, number> = { ...pose };
  // Centring the turn on the limit's midpoint puts the cut behind and below the
  // joint, where no reach lands; at [-π, π) it would sit on an arm straight overhead.
  const { min, max } = ANGLE_LIMITS[rootAngleName];
  const centre = (min + max) / 2;
  result[rootAngleName] = centre + wrapAngle(solution.direction - parent - centre);
  result[middleAngleName] = solution.bend;
  return result;
}

/** `angle` turned by whole turns into `[-π, π)`. */
export function wrapAngle(angle: number): number {
  const turn = 2 * Math.PI;
  return angle - turn * Math.floor((angle + Math.PI) / turn);
}

function clampUnit(value: number): number {
  return Math.min(Math.max(value, -1), 1);
}
