import {
  forwardKinematics,
  mirrorSkeleton,
  type Point,
  POINT_NAMES,
  type PointName,
  segmentDirections,
} from "../rig/kinematics.js";
import { type Pose, SEGMENT_LENGTHS } from "../rig/rig.js";
import type { DrawingContext } from "./context.js";

/** Which way an actor faces. Vocabulary is written facing right. */
export type Facing = "right" | "left";

/** The colour every line of the picture is drawn in. */
export const INK = "#111111";

/** The opaque background, also the fill inside the head. */
export const PAPER = "#ffffff";

/** The width of the figure's lines, in units. */
export const FIGURE_LINE = 0.025;

/** The width of the face's lines, in units. */
const FACE_LINE = 0.01;

const HEAD_RADIUS = SEGMENT_LENGTHS.head / 2;

/**
 * The face is drawn a little forward of the head's centre, so it reads as facing.
 * Every feature stays inside the outline over the channels' whole ranges.
 */
const FACE_SHIFT = 0.1 * HEAD_RADIUS;
const EYE_SPACING = 0.3 * HEAD_RADIUS;
const EYE_HEIGHT = 0.15 * HEAD_RADIUS;
const EYE_HALF_WIDTH = 0.16 * HEAD_RADIUS;
const PUPIL_RADIUS = 0.08 * HEAD_RADIUS;
const BROW_HEIGHT = 0.4 * HEAD_RADIUS;
const BROW_TRAVEL = 0.08 * HEAD_RADIUS;
const BROW_HALF_LENGTH = 0.15 * HEAD_RADIUS;
const BROW_TILT = 0.06 * HEAD_RADIUS;
const MOUTH_HEIGHT = -0.4 * HEAD_RADIUS;
const MOUTH_HALF_WIDTH = 0.3 * HEAD_RADIUS;
const MOUTH_CURVE = 0.3 * HEAD_RADIUS;
const MOUTH_OPEN = 0.4 * HEAD_RADIUS;

/** Face points in the head's own frame: `u` forward, `v` along the neck. */
interface Local {
  readonly u: number;
  readonly v: number;
}

/**
 * Draws the actor posed as `pose`, facing `facing`, standing on the ground point at
 * `groundX` of its row. The figure is built facing right and, facing left, mirrored
 * about the ground point by negating every `x`, so `R` stays the near limb.
 */
export function drawFigure(
  ctx: DrawingContext,
  pose: Pose,
  facing: Facing,
  groundX: number,
): void {
  const skeleton = forwardKinematics(pose);
  const posed = facing === "left" ? mirrorSkeleton(skeleton) : skeleton;
  const sign = facing === "left" ? -1 : 1;
  const s: Record<PointName, Point> = { ...posed };
  for (const name of POINT_NAMES) {
    s[name] = { x: groundX + posed[name].x, y: posed[name].y };
  }

  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = FIGURE_LINE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // The far (L) limbs first, then the body and head, then the near (R) limbs.
  polyline(ctx, [s.shoulders, s.elbowL, s.handL]);
  polyline(ctx, [s.pelvis, s.kneeL, s.ankleL, s.toeL]);
  polyline(ctx, [s.pelvis, s.waist, s.shoulders, s.headBase]);
  drawHead(ctx, pose, s.headCentre, sign);
  polyline(ctx, [s.pelvis, s.kneeR, s.ankleR, s.toeR]);
  polyline(ctx, [s.shoulders, s.elbowR, s.handR]);
}

function polyline(ctx: DrawingContext, points: readonly Point[]): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.stroke();
}

/**
 * The head and face. Face points are offsets from the head's centre, built facing
 * right; their `x` is multiplied by `sign`, the same negation the skeleton's mirror
 * applies, so the face mirrors with the body.
 */
function drawHead(ctx: DrawingContext, pose: Pose, centre: Point, sign: number): void {
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, HEAD_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.stroke();

  const neck = segmentDirections(pose).neck;
  const up = { x: Math.cos(neck), y: Math.sin(neck) };
  const forward = { x: Math.sin(neck), y: -Math.cos(neck) };
  // `centre` is already mirrored; the offsets from it are built facing right.
  const at = (local: Local): Point => ({
    x: centre.x + sign * (local.u * forward.x + local.v * up.x),
    y: centre.y + local.u * forward.y + local.v * up.y,
  });

  ctx.fillStyle = INK;
  ctx.lineWidth = FACE_LINE;
  const open = pose.eyeOpen;
  const eyeHalfHeight = EYE_HALF_WIDTH * open;
  const pupil = PUPIL_RADIUS * Math.min(open, 1);
  for (const side of [-1, 1]) {
    const u = FACE_SHIFT + side * EYE_SPACING;
    // The eye: a lens between two corners, flat when closed.
    const left = at({ u: u - EYE_HALF_WIDTH, v: EYE_HEIGHT });
    const right = at({ u: u + EYE_HALF_WIDTH, v: EYE_HEIGHT });
    const upper = at({ u, v: EYE_HEIGHT + 2 * eyeHalfHeight });
    const lower = at({ u, v: EYE_HEIGHT - 2 * eyeHalfHeight });
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.quadraticCurveTo(upper.x, upper.y, right.x, right.y);
    ctx.quadraticCurveTo(lower.x, lower.y, left.x, left.y);
    ctx.closePath();
    ctx.stroke();

    const centreOfPupil = at({
      u: u + pose.gazeX * (EYE_HALF_WIDTH - PUPIL_RADIUS),
      v: EYE_HEIGHT + pose.gazeY * eyeHalfHeight * 0.5,
    });
    ctx.beginPath();
    ctx.arc(centreOfPupil.x, centreOfPupil.y, pupil, 0, Math.PI * 2);
    ctx.fill();

    // A positive tilt raises the inner end, the one toward the face's centre.
    const browV = BROW_HEIGHT + pose.browHeight * BROW_TRAVEL;
    const inner = at({
      u: u - side * BROW_HALF_LENGTH,
      v: browV + pose.browTilt * BROW_TILT,
    });
    const outer = at({
      u: u + side * BROW_HALF_LENGTH,
      v: browV - pose.browTilt * BROW_TILT,
    });
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.stroke();
  }

  // The mouth: the upper lip bends down at the middle for a smile, the lower lip
  // drops below it as the mouth opens.
  const halfWidth = MOUTH_HALF_WIDTH * pose.mouthWidth;
  const cornerL = at({ u: FACE_SHIFT - halfWidth, v: MOUTH_HEIGHT });
  const cornerR = at({ u: FACE_SHIFT + halfWidth, v: MOUTH_HEIGHT });
  const lipV = MOUTH_HEIGHT - pose.mouthCurve * MOUTH_CURVE;
  const upperLip = at({ u: FACE_SHIFT, v: lipV });
  const lowerLip = at({ u: FACE_SHIFT, v: lipV - pose.mouthOpen * MOUTH_OPEN });
  ctx.beginPath();
  ctx.moveTo(cornerL.x, cornerL.y);
  ctx.quadraticCurveTo(upperLip.x, upperLip.y, cornerR.x, cornerR.y);
  ctx.quadraticCurveTo(lowerLip.x, lowerLip.y, cornerL.x, cornerL.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
