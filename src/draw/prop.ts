import { poseAtInstant } from "../rig/compose.js";
import { forwardKinematics, mirrorSkeleton, type Point } from "../rig/kinematics.js";
import { isEffectorName } from "../rig/rig.js";
import { frameInSegment, MICROS_PER_SECOND } from "../timeline/time.js";
import type { Timeline, TimelineTrack } from "../timeline/timeline.js";
import { facingOf } from "./figure.js";

/** Where a shown prop is at one frame. */
export interface PropPlacement {
  /** The prop's ground point, in row units. */
  readonly point: Point;
  /** Whether the prop draws in front of the row's actor rather than behind it. */
  readonly front: boolean;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const ORIGIN: PropPlacement = { point: { x: 0, y: 0 }, front: false };

/** The skeleton point a prop held by `effector` rides on; a foot is its ankle point. */
const HELD_AT = {
  handL: "handL",
  handR: "handR",
  footL: "ankleL",
  footR: "ankleR",
} as const;

type Motion = "place" | "hold" | "move";

function motionOf(data: unknown): Motion | undefined {
  const kind = isRecord(data) ? data["kind"] : undefined;
  return kind === "place" || kind === "hold" || kind === "move" ? kind : undefined;
}

/**
 * Where the prop is at `now` (frame units, `µs × fps`) by its track's segments other
 * than `excluded`: the placement, hold or move that started last, a later-recorded one
 * winning a tie, and the row's origin before any. A move starts from where the other
 * segments put the prop at its start, whichever order they were recorded in.
 */
function placementAt(
  timeline: Timeline,
  row: number,
  track: TimelineTrack,
  excluded: ReadonlySet<number>,
  now: number,
): PropPlacement {
  const { fps } = timeline;
  let index = -1;
  track.segments.forEach((segment, candidate) => {
    if (
      !excluded.has(candidate) &&
      motionOf(segment.data) !== undefined &&
      segment.start * fps <= now &&
      segment.start >= (track.segments[index]?.start ?? 0)
    ) {
      index = candidate;
    }
  });
  const segment = track.segments[index];
  const data = segment?.data;
  if (segment === undefined || !isRecord(data)) {
    return ORIGIN;
  }
  // Each step leaves one more segment out, so a chain of moves always ends.
  const before = (at: number): PropPlacement =>
    placementAt(timeline, row, track, new Set([...excluded, index]), at);
  if (motionOf(data) === "hold") {
    return held(timeline, row, data, now) ?? before(now);
  }
  const { x, y } = data;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return before(now);
  }
  if (motionOf(data) === "place") {
    return { point: { x, y }, front: false };
  }
  const start = segment.start * fps;
  const span = segment.end === null ? 0 : segment.end * fps - start;
  const progress = span <= 0 ? 1 : Math.min(1, (now - start) / span);
  if (progress === 1) {
    return { point: { x, y }, front: true };
  }
  const from = before(start).point;
  const arc = isFiniteNumber(data["arc"]) ? data["arc"] : 0;
  return {
    point: {
      x: from.x + (x - from.x) * progress,
      y: from.y + (y - from.y) * progress + 4 * arc * progress * (1 - progress),
    },
    front: true,
  };
}

/** Where the actor a hold names has the effector at `now`, or `undefined` without one. */
function held(
  timeline: Timeline,
  row: number,
  data: Readonly<Record<string, unknown>>,
  now: number,
): PropPlacement | undefined {
  const { effector, actor } = data;
  if (!isEffectorName(effector) || !isRecord(actor)) {
    return undefined;
  }
  const holder = timeline.rows[row]?.tracks.find(
    (candidate) =>
      candidate.kind === "actor" &&
      candidate.name === actor["name"] &&
      candidate.occurrence === actor["occurrence"],
  );
  if (holder === undefined) {
    return undefined;
  }
  const skeleton = forwardKinematics(poseAtInstant(timeline, row, holder, now));
  const left = facingOf(holder) === "left";
  const at = (left ? mirrorSkeleton(skeleton) : skeleton)[HELD_AT[effector]];
  const offset = isRecord(data["offset"]) ? data["offset"] : {};
  const dx = isFiniteNumber(offset["x"]) ? offset["x"] : 0;
  const dy = isFiniteNumber(offset["y"]) ? offset["y"] : 0;
  return {
    point: { x: at.x + (left ? -dx : dx), y: at.y + dy },
    // The far (L) limbs draw behind the body, and so does what they carry.
    front: !effector.endsWith("L"),
  };
}

/**
 * Where a prop is at `frame`, or `undefined` while it is not shown. It stands on the
 * row's origin until it is placed, rides the effector that holds it, and follows a
 * move's closed-form path; frame `n` needs no earlier frame.
 */
export function propPlacement(
  timeline: Timeline,
  row: number,
  track: TimelineTrack,
  frame: number,
): PropPlacement | undefined {
  const shown = track.segments.some(
    ({ data, start, end }) =>
      isRecord(data) &&
      data["kind"] === "prop" &&
      frameInSegment(frame, start, end, timeline.fps),
  );
  return shown
    ? placementAt(timeline, row, track, new Set(), frame * MICROS_PER_SECOND)
    : undefined;
}
