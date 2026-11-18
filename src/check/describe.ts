import { facingOf } from "../draw/figure.js";
import { idOf } from "../draw/frame.js";
import { propPlacement } from "../draw/prop.js";
import { poseAtFrame } from "../rig/compose.js";
import { forwardKinematics, mirrorSkeleton, type Point } from "../rig/kinematics.js";
import { CHANNEL_NAMES, REST_POSE } from "../rig/rig.js";
import type { Scene } from "../scene/scene.js";
import { frameInSegment } from "../timeline/time.js";

/** Where an actor's body is, in its row's units. The feet are the ankle points. */
export interface ActorPoints {
  readonly pelvis: Point;
  readonly head: Point;
  readonly handL: Point;
  readonly handR: Point;
  readonly footL: Point;
  readonly footR: Point;
}

/** One actor at one frame. */
export interface ActorState {
  readonly id: string;
  readonly facing: "left" | "right";
  /** `null` when the actor's function threw at this frame; `check` reports why. */
  readonly points: ActorPoints | null;
  /** The channels away from rest, by name; `null` as `points` is. */
  readonly pose: Readonly<Record<string, number>> | null;
}

/** One shown prop at one frame: its ground point. */
export interface PropState {
  readonly id: string;
  readonly at: Point;
}

/** What one row holds at one frame. */
export interface RowState {
  readonly row: number;
  readonly actors: readonly ActorState[];
  readonly props: readonly PropState[];
  /** The ids of the free drawings shown. */
  readonly drawings: readonly string[];
}

/** The state of a scene at one frame: who is where, in which pose, facing which way. */
export interface StateDescription {
  readonly frame: number;
  /** The frame's time in seconds. */
  readonly time: number;
  readonly rows: readonly RowState[];
}

/** Three decimals: what an author can act on, and the same text on every machine. */
export function round(value: number): number {
  return Math.round(value * 1000) / 1000 + 0;
}

function rounded(point: Point): Point {
  return { x: round(point.x), y: round(point.y) };
}

/**
 * Describes frame `frame` of `scene` from the timeline alone. Nothing is drawn: an
 * actor's pose is composed, which calls its `drive` functions, and a free drawing's
 * callback is not called.
 */
export function describeState(scene: Scene, frame: number): StateDescription {
  const { timeline } = scene;
  const rows = timeline.rows.map((timelineRow, row): RowState => {
    const actors: ActorState[] = [];
    const props: PropState[] = [];
    const drawings: string[] = [];
    for (const track of timelineRow.tracks) {
      const id = idOf(row, track);
      if (track.kind === "actor") {
        const facing = facingOf(track);
        try {
          const pose = poseAtFrame(timeline, row, track, frame);
          const skeleton = forwardKinematics(pose);
          const s = facing === "left" ? mirrorSkeleton(skeleton) : skeleton;
          const moved = CHANNEL_NAMES.filter(
            (name) => round(pose[name]) !== REST_POSE[name],
          ).map((name) => [name, round(pose[name])] as const);
          actors.push({
            id,
            facing,
            points: {
              pelvis: rounded(s.pelvis),
              head: rounded(s.headCentre),
              handL: rounded(s.handL),
              handR: rounded(s.handR),
              footL: rounded(s.ankleL),
              footR: rounded(s.ankleR),
            },
            pose: Object.fromEntries(moved),
          });
        } catch {
          actors.push({ id, facing, points: null, pose: null });
        }
      } else if (track.kind === "prop") {
        try {
          const placed = propPlacement(timeline, row, track, frame);
          if (placed !== undefined) {
            props.push({ id, at: rounded(placed.point) });
          }
        } catch {
          // Its holder's function threw at this frame; `check` reports why.
        }
      } else if (
        track.kind === "draw" &&
        track.segments.some(({ start, end }) =>
          frameInSegment(frame, start, end, timeline.fps),
        )
      ) {
        drawings.push(id);
      }
    }
    return { row, actors, props, drawings };
  });
  return { frame, time: round(frame / timeline.fps), rows };
}

function at(point: Point): string {
  return `(${String(point.x)}, ${String(point.y)})`;
}

/** A state description as text, one block per row. */
export function formatState(state: StateDescription): string {
  const lines = [
    `state at ${String(round(state.time))} s (frame ${String(state.frame)})`,
  ];
  for (const row of state.rows) {
    lines.push(`row ${String(row.row)}`);
    for (const actor of row.actors) {
      const { points, pose } = actor;
      if (points === null || pose === null) {
        lines.push(
          `  actor ${actor.id}: facing ${actor.facing}, could not be computed`,
        );
        continue;
      }
      const channels = Object.entries(pose).map(
        ([name, value]) => `${name} ${String(value)}`,
      );
      lines.push(
        `  actor ${actor.id}: facing ${actor.facing}, pelvis ${at(points.pelvis)}, head ${at(points.head)}`,
        `    hands: L ${at(points.handL)}, R ${at(points.handR)}; feet: L ${at(points.footL)}, R ${at(points.footR)}`,
        `    pose: ${channels.length === 0 ? "rest" : channels.join(", ")}`,
      );
    }
    for (const prop of row.props) {
      lines.push(`  prop ${prop.id}: at ${at(prop.at)}`);
    }
    for (const drawing of row.drawings) {
      lines.push(`  drawing ${drawing}`);
    }
    if (row.actors.length + row.props.length + row.drawings.length === 0) {
      lines.push("  empty");
    }
  }
  return `${lines.join("\n")}\n`;
}
