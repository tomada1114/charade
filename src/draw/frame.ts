import { CharadeError } from "../errors.js";
import { poseAtFrame } from "../rig/compose.js";
import { randomSource } from "../timeline/random.js";
import type { Moment } from "../timeline/segments.js";
import { frameInSegment, frameSeconds, MICROS_PER_SECOND } from "../timeline/time.js";
import type { Timeline, TimelineTrack } from "../timeline/timeline.js";
import type { DrawingContext, ShapeContext } from "./context.js";
import { drawFigure, type Facing, FIGURE_LINE, INK, PAPER } from "./figure.js";
import { type RowLayout, rowLayout, rowTransform } from "./layout.js";

/** The width of the ground line, in units. */
const GROUND_LINE = 0.01;

/**
 * The draw order within a row, back to front. Backdrops, props and text have no
 * vocabulary yet, so the drawer fills `backdrop` with the ground line, `propsInFront`
 * with the row's free drawings, and leaves `propsBehind` and `text` empty.
 */
export const ROW_SLOTS = [
  "backdrop",
  "propsBehind",
  "actor",
  "propsInFront",
  "text",
] as const;

export type RowSlot = (typeof ROW_SLOTS)[number];

/** Draws one item of a row, in row units. */
export type Painter = (ctx: DrawingContext) => void;

/** What one row draws at one frame, slot by slot. */
export type RowContent = Readonly<Record<RowSlot, readonly Painter[]>>;

/** What a frame is drawn from: the canvas size and the timeline. A `Scene` is one. */
export interface FrameSource {
  readonly width: number;
  readonly height: number;
  readonly timeline: Timeline;
}

/**
 * Drawing one item of a frame threw: the author's `drive` or `draw` function, or a
 * drawing call the context rejected, such as `NaN` given to `lineTo`. `row`, `target`
 * (the item's id), `frame` and `time` (seconds) say where; the original error is the
 * `cause`.
 */
export class FrameItemError extends CharadeError {
  readonly code = "ERR_SCENE_DRAWING_FAILED" as const;

  readonly row: number;

  readonly target: string;

  readonly frame: number;

  readonly time: number;

  constructor(
    row: number,
    target: string,
    frame: number,
    time: number,
    cause: unknown,
  ) {
    super(`Drawing ${target} at frame ${String(frame)} failed.`, { cause });
    this.row = row;
    this.target = target;
    this.frame = frame;
    this.time = time;
  }
}

type DrawCallback = (ctx: ShapeContext, t: number, moment: Moment) => unknown;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isDrawCallback(value: unknown): value is DrawCallback {
  return typeof value === "function";
}

/** The facing an actor's track carries; right unless it says `left`. */
function facingOf(track: TimelineTrack): Facing {
  return "facing" in track && track.facing === "left" ? "left" : "right";
}

function idOf(row: number, track: TimelineTrack): string {
  return `row${String(row)}/${track.kind}/${track.name}/${String(track.occurrence)}`;
}

/**
 * Draws frame `frame` of `source` on `ctx`: a pure function of the timeline and the
 * frame number. The context is reset first, so nothing an earlier frame left on it
 * reaches this one.
 *
 * @throws `FrameItemError` when drawing one item throws.
 */
export function drawFrame(
  ctx: DrawingContext,
  source: FrameSource,
  frame: number,
): void {
  const { timeline, width, height } = source;
  frameSeconds(frame, timeline.fps);
  ctx.reset();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  const count = timeline.rows.length;
  timeline.rows.forEach((_, index) => {
    const layout = rowLayout(width, height, count, index);
    drawRow(ctx, layout, rowContent(timeline, layout, frame));
  });
}

/**
 * Draws one row: clipped to its band, in row units, every slot of {@link ROW_SLOTS}
 * in order. Each painter runs between `save` and `restore`, so the state it sets
 * stays with it.
 */
export function drawRow(
  ctx: DrawingContext,
  layout: RowLayout,
  content: RowContent,
): void {
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(0, layout.top, layout.width, layout.height);
    ctx.clip();
    ctx.setTransform(...rowTransform(layout));
    for (const slot of ROW_SLOTS) {
      for (const paint of content[slot]) {
        ctx.save();
        try {
          paint(ctx);
        } finally {
          ctx.restore();
        }
      }
    }
  } finally {
    ctx.restore();
  }
}

/** What row `layout.index` of `timeline` draws at `frame`. */
export function rowContent(
  timeline: Timeline,
  layout: RowLayout,
  frame: number,
): RowContent {
  const row = layout.index;
  const tracks = timeline.rows[row]?.tracks ?? [];
  const time = frame / timeline.fps;
  const guarded =
    (track: TimelineTrack, paint: Painter): Painter =>
    (ctx) => {
      try {
        paint(ctx);
      } catch (error) {
        throw new FrameItemError(row, idOf(row, track), frame, time, error);
      }
    };
  const actors = tracks
    .filter((track) => track.kind === "actor")
    .map((track) =>
      guarded(track, (ctx) => {
        drawFigure(ctx, poseAtFrame(timeline, row, track, frame), facingOf(track), 0);
      }),
    );
  const drawings = tracks
    .filter((track) => track.kind === "draw")
    .map((track) =>
      guarded(track, (ctx) => {
        drawTrack(ctx, timeline, row, track, frame);
      }),
    );
  return {
    backdrop: [
      (ctx) => {
        drawGround(ctx, layout);
      },
    ],
    propsBehind: [],
    actor: actors,
    propsInFront: drawings,
    text: [],
  };
}

function drawGround(ctx: DrawingContext, layout: RowLayout): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = GROUND_LINE;
  ctx.beginPath();
  ctx.moveTo(-layout.units / 2, 0);
  ctx.lineTo(layout.units / 2, 0);
  ctx.stroke();
}

/** Calls a free drawing's function for each of its segments shown at `frame`. */
function drawTrack(
  ctx: DrawingContext,
  timeline: Timeline,
  row: number,
  track: TimelineTrack,
  frame: number,
): void {
  const { fps } = timeline;
  const random = randomSource({
    seed: timeline.seed,
    row,
    kind: track.kind,
    name: track.name,
    occurrence: track.occurrence,
  });
  const time = frame / fps;
  for (const segment of track.segments) {
    const { data, start, end } = segment;
    if (!isRecord(data) || data["kind"] !== "draw") {
      continue;
    }
    const draw = data["draw"];
    // A parsed timeline holds a placeholder where the function was, which draws nothing.
    if (!isDrawCallback(draw) || !frameInSegment(frame, start, end, fps)) {
      continue;
    }
    const t = time - start / MICROS_PER_SECOND;
    const duration = end === null ? Infinity : (end - start) / MICROS_PER_SECOND;
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = FIGURE_LINE;
    draw(ctx, t, {
      time,
      duration,
      progress: end === null ? 0 : t / duration,
      random,
    });
  }
}
