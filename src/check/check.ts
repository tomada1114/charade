import { facingOf } from "../draw/figure.js";
import { drawItem, drawTrack, idOf } from "../draw/frame.js";
import { propPlacement } from "../draw/prop.js";
import { type RowLayout, rowLayout, rowView } from "../draw/layout.js";
import {
  isTextTrack,
  type PlacedText,
  placedText,
  type TextMeasurer,
} from "../draw/text.js";
import { CharadeError } from "../errors.js";
import { poseAtFrame } from "../rig/compose.js";
import {
  forwardKinematics,
  mirrorSkeleton,
  type Point,
  POINT_NAMES,
  type PointName,
} from "../rig/kinematics.js";
import {
  ANGLE_LIMITS,
  type AngleName,
  ANGLE_NAMES,
  isWithin,
  type Pose,
  SEGMENT_LENGTHS,
} from "../rig/rig.js";
import type { Scene } from "../scene/scene.js";
import {
  computeDuration,
  type Timeline,
  type TimelineTrack,
} from "../timeline/timeline.js";
import { type CheckReport, type Finding, FINDING_CAP } from "./findings.js";
import { readFinding, watchReads } from "./reads.js";
import { RecordingContext } from "./recorder.js";

/**
 * The box a label or a bubble's text occupies at one frame, in its row's units: `x`
 * and `y` are its lower left corner, `y` up.
 */
export interface TextBox {
  /** The text item's id, as findings name it. */
  readonly id: string;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What {@link checkScene} takes beyond the scene. */
export interface CheckOptions {
  /**
   * What the scene's labels and bubbles are measured with: a context whose font is the
   * one they will be drawn in. The default is the recording context's fake measurer.
   */
  readonly measurer?: TextMeasurer;
  /**
   * The text boxes actors are tested against at a frame, in place of the scene's own
   * labels and bubbles.
   */
  readonly textBoxes?: (frame: number) => readonly TextBox[];
  /**
   * Findings about the machine rather than the scene, such as a missing font; they
   * are reported after the scene's own and before the computed ones.
   */
  readonly environment?: readonly Finding[];
}

/**
 * The smallest font size that reads, in pixels of the output: below it the strokes of
 * a kanji run together.
 */
export const MIN_TEXT_PX = 12;

/** The findings of a scene: those recorded while it was authored, then the computed ones. */
export interface CheckResult {
  readonly findings: readonly Finding[];
  /** Whether findings past the cap were dropped, while authoring or here. */
  readonly truncated: boolean;
}

/** The index of a scene's last frame, or `undefined` when it has no countable length. */
export function lastFrameOf(timeline: Timeline): number | undefined {
  try {
    const duration = computeDuration(timeline);
    return duration.ok ? duration.lastFrame : undefined;
  } catch {
    // Too long to count; the scene already carries the finding.
    return undefined;
  }
}

/** One violation at one frame. Contiguous frames with the same `key` are one finding. */
interface Violation {
  readonly key: string;
  /** How far past the rule this frame is; the finding describes the worst frame. */
  readonly excess: number;
  readonly finding: Finding;
}

interface Run {
  readonly first: number;
  last: number;
  worst: Violation;
}

/** The lines of the figure, as pairs of the points they join. */
const BONES: readonly (readonly [PointName, PointName])[] = [
  ["shoulders", "elbowL"],
  ["elbowL", "handL"],
  ["shoulders", "elbowR"],
  ["elbowR", "handR"],
  ["pelvis", "kneeL"],
  ["kneeL", "ankleL"],
  ["ankleL", "toeL"],
  ["pelvis", "kneeR"],
  ["kneeR", "ankleR"],
  ["ankleR", "toeR"],
  ["pelvis", "waist"],
  ["waist", "shoulders"],
  ["shoulders", "headBase"],
];

const HEAD_RADIUS = SEGMENT_LENGTHS.head / 2;

/** Three decimals, enough to act on, without the last digits of a computed value. */
function show(value: number): string {
  return String(Math.round(value * 1000) / 1000 + 0);
}

function limitViolations(pose: Pose, row: number, id: string): Violation[] {
  return ANGLE_NAMES.flatMap((joint: AngleName): Violation[] => {
    const limit = ANGLE_LIMITS[joint];
    const value = pose[joint];
    if (isWithin(limit, value)) {
      return [];
    }
    const below = value < limit.min;
    const range = `${String(limit.min)}..${String(limit.max)}`;
    const excess = below ? limit.min - value : value - limit.max;
    return [
      {
        key: `limit|${id}|${joint}`,
        // A value that is not a number is outside by more than any number.
        excess: Number.isNaN(excess) ? Infinity : excess,
        finding: {
          code: "ERR_CHECK_JOINT_LIMIT",
          severity: "error",
          message: `${joint} of ${id} goes ${below ? "below" : "above"} its limit ${range}: it reaches ${show(value)}.`,
          fix: `Keep ${joint} within ${range} radians: change the pose, drive or reach that moves it.`,
          row,
          target: id,
          joint,
          measured: { value, min: limit.min, max: limit.max },
        },
      },
    ];
  });
}

/** The visible area of a row, in its own units. */
interface Area {
  readonly halfWidth: number;
  readonly bottom: number;
  readonly top: number;
}

/** How far a shape reaching from `min` to `max` goes past `area`; 0 or less is inside. */
function overshoot(area: Area, min: Point, max: Point): number {
  return Math.max(
    -area.halfWidth - min.x,
    max.x - area.halfWidth,
    area.bottom - min.y,
    max.y - area.top,
  );
}

function offFrame(
  area: Area,
  min: Point,
  max: Point,
  row: number,
  id: string,
): Violation[] {
  const excess = overshoot(area, min, max);
  if (!(excess > 0)) {
    return [];
  }
  return [
    {
      key: `frame|${id}`,
      excess,
      finding: {
        code: "ERR_CHECK_OFF_FRAME",
        severity: "warning",
        message: `${id} leaves the visible area of row ${String(row)}, by up to ${show(excess)} units.`,
        fix: `Ignore it if the exit is meant; otherwise keep it within x ${show(-area.halfWidth)}..${show(area.halfWidth)} and y ${show(area.bottom)}..${show(area.top)}.`,
        row,
        target: id,
        measured: { overshoot: excess },
      },
    },
  ];
}

/** Whether the segment from `a` to `b` touches `box`: a Liang–Barsky clip. */
function segmentMeetsBox(a: Point, b: Point, box: TextBox): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let enter = 0;
  let leave = 1;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, a.x - box.x],
    [dx, box.x + box.width - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.height - a.y],
  ];
  for (const [direction, distance] of edges) {
    if (direction === 0) {
      if (distance < 0) {
        return false;
      }
      continue;
    }
    const t = distance / direction;
    if (direction < 0) {
      enter = Math.max(enter, t);
    } else {
      leave = Math.min(leave, t);
    }
    if (enter > leave) {
      return false;
    }
  }
  return true;
}

function circleMeetsBox(centre: Point, radius: number, box: TextBox): boolean {
  const dx = centre.x - Math.min(Math.max(centre.x, box.x), box.x + box.width);
  const dy = centre.y - Math.min(Math.max(centre.y, box.y), box.y + box.height);
  return dx * dx + dy * dy <= radius * radius;
}

type Figure = Readonly<Record<PointName, Point>>;

function figureMeetsBox(figure: Figure, box: TextBox): boolean {
  return (
    circleMeetsBox(figure.headCentre, HEAD_RADIUS, box) ||
    BONES.some(([from, to]) => segmentMeetsBox(figure[from], figure[to], box))
  );
}

function actorViolations(
  pose: Pose,
  track: TimelineTrack,
  area: Area,
  boxes: readonly TextBox[],
  row: number,
  id: string,
): Violation[] {
  const skeleton = forwardKinematics(pose);
  const figure = facingOf(track) === "left" ? mirrorSkeleton(skeleton) : skeleton;
  const xs = POINT_NAMES.map((name) => figure[name].x);
  const ys = POINT_NAMES.map((name) => figure[name].y);
  const head = figure.headCentre;
  const min = {
    x: Math.min(...xs, head.x - HEAD_RADIUS),
    y: Math.min(...ys, head.y - HEAD_RADIUS),
  };
  const max = {
    x: Math.max(...xs, head.x + HEAD_RADIUS),
    y: Math.max(...ys, head.y + HEAD_RADIUS),
  };
  const overlaps = boxes
    .filter((box) => box.row === row && figureMeetsBox(figure, box))
    .map((box): Violation => ({
      key: `overlap|${id}|${box.id}`,
      excess: 0,
      finding: {
        code: "ERR_CHECK_TEXT_OVERLAP",
        severity: "warning",
        message: `${id} overlaps the text ${box.id}.`,
        fix: "Move the text or the actor apart, or ignore it if the overlap is meant.",
        row,
        target: id,
      },
    }));
  return [
    ...limitViolations(pose, row, id),
    ...offFrame(area, min, max, row, id),
    ...overlaps,
  ];
}

/** A label or bubble at one frame, or what composing its speaker's pose threw. */
type TextResult =
  | { readonly row: number; readonly placed: PlacedText }
  | { readonly row: number; readonly error: unknown };

/** Every label and bubble shown at `frame`, by id. */
function textsAt(
  scene: Scene,
  layouts: readonly RowLayout[],
  frame: number,
  measurer: TextMeasurer,
): Map<string, TextResult> {
  const texts = new Map<string, TextResult>();
  scene.timeline.rows.forEach((timelineRow, row) => {
    const layout = layouts[row];
    for (const track of layout === undefined ? [] : timelineRow.tracks) {
      if (!isTextTrack(track) || layout === undefined) {
        continue;
      }
      try {
        const placed = placedText(measurer, scene.timeline, layout, track, frame);
        if (placed !== undefined) {
          texts.set(idOf(row, track), { row, placed });
        }
      } catch (error) {
        texts.set(idOf(row, track), { row, error });
      }
    }
  });
  return texts;
}

/** A font size as the fix line names it: rounded up, so following it clears the check. */
function atLeast(value: number): string {
  return String(Math.ceil(value * 1000) / 1000);
}

function textViolations(
  placed: PlacedText,
  area: Area,
  scale: number,
  row: number,
  id: string,
): Violation[] {
  const { box } = placed;
  // Rounded, so a size that is the threshold but for a rounding step is not reported.
  const px = Math.round(placed.size * scale * 1e6) / 1e6;
  const small: Violation[] =
    px < MIN_TEXT_PX
      ? [
          {
            key: `small|${id}`,
            excess: MIN_TEXT_PX - px,
            finding: {
              code: "ERR_CHECK_TEXT_TOO_SMALL",
              severity: "warning",
              message: `The text of ${id} is ${show(px)} px tall at the output size; below ${String(MIN_TEXT_PX)} px it is hard to read.`,
              fix: `Give it a size of at least ${atLeast(MIN_TEXT_PX / scale)} units, or use fewer rows or a larger canvas.`,
              row,
              target: id,
              measured: { size: px, min: MIN_TEXT_PX },
            },
          },
        ]
      : [];
  return [
    ...small,
    ...offFrame(
      area,
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      row,
      id,
    ),
  ];
}

/** The error finding of an item whose function threw at a frame. */
function failure(error: unknown, row: number, id: string): Violation {
  const reason =
    error instanceof CharadeError
      ? `${error.code} (${error.message})`
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    key: `failed|${id}`,
    excess: 0,
    finding: {
      code: "ERR_SCENE_DRAWING_FAILED",
      severity: "error",
      message: `${id} could not be drawn: ${reason}.`,
      fix: "Make the function given to drive or draw return for every t without throwing, and give drawing calls finite numbers only.",
      row,
      target: id,
    },
  };
}

/** Every violation of one frame, row by row and track by track. */
function violationsAt(
  scene: Scene,
  layouts: readonly RowLayout[],
  frame: number,
  options: CheckOptions,
): Violation[] {
  const { timeline } = scene;
  const found: Violation[] = [];
  const texts = textsAt(
    scene,
    layouts,
    frame,
    options.measurer ?? new RecordingContext(),
  );
  const boxes =
    options.textBoxes?.(frame) ??
    [...texts].flatMap(([id, text]): TextBox[] =>
      "placed" in text ? [{ id, row: text.row, ...text.placed.box }] : [],
    );
  timeline.rows.forEach((timelineRow, row) => {
    const layout = layouts[row];
    if (layout === undefined) {
      return;
    }
    const view = rowView(layout);
    const area: Area = { halfWidth: view.right, bottom: view.bottom, top: view.top };
    for (const track of timelineRow.tracks) {
      const id = idOf(row, track);
      // The author's functions run only inside `watched`, where a clock or random
      // read is noted.
      const watched = <T>(run: () => T, noteReads = true): T | undefined => {
        try {
          const { value, reads } = watchReads(run);
          for (const read of noteReads ? reads : []) {
            found.push({
              key: `read|${id}|${read}`,
              excess: 0,
              finding: readFinding(read, { subject: id, row, target: id }),
            });
          }
          return value;
        } catch (error) {
          found.push(failure(error, row, id));
          return undefined;
        }
      };
      if (track.kind === "actor") {
        const pose = watched(() => poseAtFrame(timeline, row, track, frame));
        if (pose !== undefined) {
          found.push(...actorViolations(pose, track, area, boxes, row, id));
        }
      } else if (track.kind === "draw") {
        watched(() => {
          drawTrack(new RecordingContext(), timeline, layout, track, frame);
        });
      } else if (track.kind === "backdrop" || track.kind === "effect") {
        watched(() => {
          drawItem(new RecordingContext(), timeline, layout, track, frame);
        });
      } else if (track.kind === "prop") {
        // A held prop composes its holder's pose, which calls the holder's functions.
        // Their reads are the holder's, which its own track already reports.
        const placed = watched(() => propPlacement(timeline, row, track, frame), false);
        if (placed !== undefined) {
          found.push(...offFrame(area, placed.point, placed.point, row, id));
          watched(() => {
            drawItem(
              new RecordingContext(),
              timeline,
              layout,
              track,
              frame,
              placed.point,
            );
          });
        }
      } else {
        const text = texts.get(id);
        if (text !== undefined && "placed" in text) {
          found.push(...textViolations(text.placed, area, layout.scale, row, id));
        } else if (text !== undefined) {
          // Its speaker's function threw at this frame, so the bubble has no place.
          found.push(failure(text.error, row, id));
        }
      }
    }
  });
  return found;
}

/**
 * Checks a built scene: the findings recorded while it was authored, then joint
 * limits on the composed pose, items leaving their row, text too small to read,
 * actors over text, and clock or random reads, computed at every frame. Contiguous
 * frames of one violation are one finding, whose `frames` are its first and last frame
 * and whose `time` runs from the first frame's time to where the last frame's ends, as
 * a segment's does.
 */
export function checkScene(scene: Scene, options: CheckOptions = {}): CheckResult {
  const { timeline } = scene;
  const lastFrame = lastFrameOf(timeline);
  const runs: Run[] = [];
  if (lastFrame !== undefined) {
    const layouts = timeline.rows.map((_, row) =>
      rowLayout(scene.width, scene.height, timeline.rows.length, row),
    );
    const open = new Map<string, Run>();
    // One outer watch replaces the globals once for the whole scan; each item's own
    // watch is nested inside it and keeps its reads to itself.
    watchReads(() => {
      for (let frame = 0; frame <= lastFrame; frame += 1) {
        for (const violation of violationsAt(scene, layouts, frame, options)) {
          const run = open.get(violation.key);
          if (run !== undefined && run.last >= frame - 1) {
            run.last = frame;
            if (violation.excess > run.worst.excess) {
              run.worst = violation;
            }
          } else {
            const started: Run = { first: frame, last: frame, worst: violation };
            open.set(violation.key, started);
            runs.push(started);
          }
        }
      }
    });
  }
  const computed = runs.map((run): Finding => {
    return {
      ...run.worst.finding,
      time: [run.first / timeline.fps, (run.last + 1) / timeline.fps],
      frames: [run.first, run.last],
    };
  });
  const all = [...scene.findings, ...(options.environment ?? []), ...computed];
  const kept = capped(all);
  return {
    findings: kept,
    truncated: scene.truncated || kept.length < all.length,
  };
}

/**
 * The first {@link FINDING_CAP} findings, in order, except that a warning gives way
 * to an error: a dropped error would turn a failing run into a passing one.
 */
function capped(findings: readonly Finding[]): readonly Finding[] {
  if (findings.length <= FINDING_CAP) {
    return findings;
  }
  const errors = findings.filter((finding) => finding.severity === "error");
  let room = FINDING_CAP;
  let warnings = Math.max(0, FINDING_CAP - errors.length);
  return findings.filter((finding) => {
    if (finding.severity === "error") {
      room -= 1;
      return room >= 0;
    }
    warnings -= 1;
    return warnings >= 0;
  });
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

/** Where a finding applies, as one line, or `undefined` when it names no place. */
function location(finding: Finding): string | undefined {
  const parts: string[] = [];
  if (finding.row !== undefined) {
    parts.push(`row ${String(finding.row)}`);
  }
  if (finding.target !== undefined) {
    parts.push(finding.target);
  }
  if (finding.joint !== undefined) {
    parts.push(finding.joint);
  }
  if (finding.time !== undefined) {
    parts.push(`${show(finding.time[0])} s to ${show(finding.time[1])} s`);
  }
  if (finding.frames !== undefined) {
    parts.push(`frames ${String(finding.frames[0])} to ${String(finding.frames[1])}`);
  }
  if (finding.source !== undefined) {
    const { file, line, column } = finding.source;
    parts.push(`${file}:${String(line)}:${String(column)}`);
  }
  return parts.length === 0 ? undefined : parts.join(", ");
}

/**
 * A report as compiler-style text: one block per finding with where it applies and
 * its fix line, then the count.
 */
export function formatReport(report: CheckReport): string {
  const blocks = report.findings.map((finding) => {
    const at = location(finding);
    return (
      `${finding.severity} ${finding.code}: ${finding.message}\n` +
      (at === undefined ? "" : `  at: ${at}\n`) +
      `  fix: ${finding.fix}\n\n`
    );
  });
  const { errors, warnings, truncated } = report.summary;
  return (
    blocks.join("") +
    `${plural(errors, "error")}, ${plural(warnings, "warning")}\n` +
    (truncated ? "Later findings were dropped: fix these and check again.\n" : "")
  );
}
