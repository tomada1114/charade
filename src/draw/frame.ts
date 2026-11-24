import { CharadeError } from "../errors.js";
import { poseAtFrame } from "../rig/compose.js";
import type { Point } from "../rig/kinematics.js";
import { builtinBackdrops, builtinEffects, builtinProps } from "../scene/builtins.js";
import { randomSource } from "../timeline/random.js";
import type { DrawMoment } from "../timeline/segments.js";
import {
  frameInSegment,
  frameSeconds,
  type Micros,
  MICROS_PER_SECOND,
} from "../timeline/time.js";
import type { Timeline, TimelineTrack } from "../timeline/timeline.js";
import type { DrawingContext, ShapeContext } from "./context.js";
import { drawFigure, facingOf, FIGURE_LINE, INK, PAPER } from "./figure.js";
import { type RowLayout, rowLayout, rowTransform, rowView } from "./layout.js";
import { effectPlacement, propPlacement } from "./prop.js";
import { isTextTrack, placedText, textFont } from "./text.js";

/** The width of the ground line, in units. */
const GROUND_LINE = 0.01;

/**
 * The draw order within a row, back to front. `backdrop` holds the row's backdrops and
 * then the ground line; `text` holds the row's labels and speech bubbles. A prop is
 * behind the actor unless it is moving or in a near (`R`) hand or foot;
 * `propsInFront` holds those, then the row's effects, then its free drawings.
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
  /**
   * The CSS font family list the frame's text is drawn in. Without it the context's
   * font is left as it is, which on a fresh context is its default sans-serif.
   */
  readonly textFont?: string;
}

/** Sets the font `source` names for its text; called after the context is cleared. */
export function useTextFont(ctx: DrawingContext, source: FrameSource): void {
  if (source.textFont !== undefined) {
    ctx.font = textFont(source.textFont);
  }
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

type DrawCallback = (ctx: ShapeContext, t: number, moment: DrawMoment) => unknown;

/** The kinds of item drawn by their definition's `draw`. */
type DrawnKind = "prop" | "backdrop" | "effect";

/** The built-in maps of the drawn kinds, as records, which a map typed by its names is not. */
const BUILTIN_DRAWN: Readonly<Record<DrawnKind, Readonly<Record<string, unknown>>>> = {
  prop: { ...builtinProps },
  backdrop: { ...builtinBackdrops },
  effect: { ...builtinEffects },
};

type ItemDraw = (ctx: ShapeContext, params: unknown, moment: DrawMoment) => unknown;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isDrawCallback(value: unknown): value is DrawCallback {
  return typeof value === "function";
}

/**
 * The `draw` of the item a segment shows: its definition's when it was passed as one,
 * the built-in's of its name and kind otherwise. A parsed timeline holds a placeholder
 * where a passed definition's function was, and a name may be one this version lacks;
 * either draws nothing.
 */
function itemDraw(
  kind: DrawnKind,
  data: Readonly<Record<string, unknown>>,
): ItemDraw | undefined {
  const { definition, name } = data;
  const builtins = BUILTIN_DRAWN[kind];
  const found =
    definition === null && typeof name === "string" && Object.hasOwn(builtins, name)
      ? builtins[name]
      : definition;
  if (!isRecord(found)) {
    return undefined;
  }
  const draw = found["draw"];
  return typeof draw === "function"
    ? (ctx, params, moment) => {
        // Called on its definition, as a method is.
        Reflect.apply(draw, found, [ctx, params, moment]);
      }
    : undefined;
}

/** The id of a track's item, as findings name it. */
export function idOf(row: number, track: TimelineTrack): string {
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
  useTextFont(ctx, source);
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

/** `paint`, with what it throws wrapped in a `FrameItemError` naming `track`. */
function guardedPainter(
  timeline: Timeline,
  row: number,
  frame: number,
  track: TimelineTrack,
  paint: Painter,
): Painter {
  return (ctx) => {
    try {
      paint(ctx);
    } catch (error) {
      throw new FrameItemError(
        row,
        idOf(row, track),
        frame,
        frame / timeline.fps,
        error,
      );
    }
  };
}

/** A painter for each of row `row`'s backdrop or effect tracks, in track order. */
function shownPainters(
  timeline: Timeline,
  layout: RowLayout,
  frame: number,
  kind: "backdrop" | "effect",
): Painter[] {
  return (timeline.rows[layout.index]?.tracks ?? [])
    .filter((track) => track.kind === kind)
    .map((track) =>
      guardedPainter(timeline, layout.index, frame, track, (ctx) => {
        if (kind === "effect") {
          const { point, mirrored } = effectPlacement(
            timeline,
            layout.index,
            track,
            frame,
          );
          drawItem(ctx, timeline, layout, track, frame, point, mirrored);
        } else {
          drawItem(ctx, timeline, layout, track, frame);
        }
      }),
    );
}

/** The backdrop slot of row `layout.index` at `frame`: its backdrops, then the ground line. */
export function rowBackdrop(
  timeline: Timeline,
  layout: RowLayout,
  frame: number,
): readonly Painter[] {
  return [
    ...shownPainters(timeline, layout, frame, "backdrop"),
    (ctx) => {
      drawGround(ctx, layout);
    },
  ];
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
  const guarded = (track: TimelineTrack, paint: Painter): Painter =>
    guardedPainter(timeline, row, frame, track, paint);
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
        drawTrack(ctx, timeline, layout, track, frame);
      }),
    );
  const propsBehind: Painter[] = [];
  const propsInFront: Painter[] = [];
  for (const track of tracks) {
    if (track.kind !== "prop") {
      continue;
    }
    // Asked here rather than in the painter: which slot the prop is in depends on it.
    let placed: ReturnType<typeof propPlacement>;
    try {
      placed = propPlacement(timeline, row, track, frame);
    } catch (error) {
      // Thrown from a painter after the actors', so a holder whose own function threw
      // is named for it first, and a caller that draws only some slots never meets it.
      propsInFront.push(() => {
        throw new FrameItemError(row, idOf(row, track), frame, time, error);
      });
      continue;
    }
    if (placed !== undefined) {
      const { point } = placed;
      (placed.front ? propsInFront : propsBehind).push(
        guarded(track, (ctx) => {
          drawItem(ctx, timeline, layout, track, frame, point);
        }),
      );
    }
  }
  const text = tracks.filter(isTextTrack).map((track) =>
    guarded(track, (ctx) => {
      placedText(ctx, timeline, layout, track, frame)?.paint(ctx);
    }),
  );
  return {
    backdrop: rowBackdrop(timeline, layout, frame),
    propsBehind,
    actor: actors,
    propsInFront: [
      ...propsInFront,
      ...shownPainters(timeline, layout, frame, "effect"),
      ...drawings,
    ],
    text,
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

const ORIGIN: Point = { x: 0, y: 0 };

function isDrawnKind(kind: string): kind is DrawnKind {
  return Object.hasOwn(BUILTIN_DRAWN, kind);
}

/**
 * Draws a prop, backdrop or effect with its ground point on `point`, the row's origin
 * by default, once for each of its segments of its own kind shown at `frame`. Its
 * `draw` starts as a free drawing's does: ink as both styles and the figure's line
 * width, and its moment's `view` is the row's visible area as seen from `point`.
 * `mirrored` flips the drawing left to right about `point`, and its `view` with it.
 */
export function drawItem(
  ctx: ShapeContext,
  timeline: Timeline,
  layout: RowLayout,
  track: TimelineTrack,
  frame: number,
  point: Point = ORIGIN,
  mirrored = false,
): void {
  const { kind } = track;
  if (!isDrawnKind(kind)) {
    return;
  }
  const row = layout.index;
  const seen = rowView(layout, point.x, point.y);
  const view = mirrored ? { ...seen, left: -seen.right, right: -seen.left } : seen;
  const { fps } = timeline;
  const random = randomSource({
    seed: timeline.seed,
    row,
    kind: track.kind,
    name: track.name,
    occurrence: track.occurrence,
  });
  const time = frame / fps;
  for (const { data, start, end } of track.segments) {
    if (
      !isRecord(data) ||
      data["kind"] !== kind ||
      !frameInSegment(frame, start, end, fps)
    ) {
      continue;
    }
    const draw = itemDraw(kind, data);
    if (draw === undefined) {
      continue;
    }
    const t = sinceStart(frame, start, fps);
    const duration = end === null ? Infinity : (end - start) / MICROS_PER_SECOND;
    ctx.save();
    try {
      ctx.translate(point.x, point.y);
      if (mirrored) {
        ctx.scale(-1, 1);
      }
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      ctx.lineWidth = FIGURE_LINE;
      guarded(ctx, () => {
        draw(ctx, data["params"], {
          time,
          duration,
          progress: end === null ? 0 : t / duration,
          t,
          random,
          view,
        });
      });
    } finally {
      ctx.restore();
    }
  }
}

/**
 * Seconds from a segment's start to frame `frame`, from the difference in frame units:
 * `frame / fps − start` in floats would let the same distance from the start round two
 * ways at two starts, and a repeating effect then differ by where it was placed.
 */
function sinceStart(frame: number, start: Micros, fps: number): number {
  return (frame * MICROS_PER_SECOND - start * fps) / (fps * MICROS_PER_SECOND);
}

/** The members a drawing's guard shadows on the shared context while it runs. */
const GUARDED = ["reset", "save", "restore"] as const;

/**
 * Calls `draw` with `reset` a no-op and `save`/`restore` counted, so a plain-JS drawing
 * can neither clear nor pop the row's state; `.claude/rules/engine.md` has the reasons.
 */
function guarded(ctx: ShapeContext, draw: () => void): void {
  if (!Object.isExtensible(ctx) || GUARDED.some((name) => Object.hasOwn(ctx, name))) {
    draw();
    return;
  }
  const save = ctx.save.bind(ctx);
  const restore = ctx.restore.bind(ctx);
  let open = 0;
  const shadow = (name: (typeof GUARDED)[number], value: () => void): void => {
    Object.defineProperty(ctx, name, { configurable: true, writable: true, value });
  };
  shadow("reset", () => undefined);
  shadow("save", () => {
    save();
    open += 1;
  });
  shadow("restore", () => {
    if (open > 0) {
      open -= 1;
      restore();
    }
  });
  try {
    draw();
  } finally {
    for (const name of GUARDED) {
      Reflect.deleteProperty(ctx, name);
    }
    for (; open > 0; open -= 1) {
      restore();
    }
  }
}

/** Calls a free drawing's function for each of its segments shown at `frame`. */
export function drawTrack(
  ctx: DrawingContext,
  timeline: Timeline,
  layout: RowLayout,
  track: TimelineTrack,
  frame: number,
): void {
  const { fps } = timeline;
  const row = layout.index;
  const view = rowView(layout);
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
    const t = sinceStart(frame, start, fps);
    const duration = end === null ? Infinity : (end - start) / MICROS_PER_SECOND;
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = FIGURE_LINE;
    guarded(ctx, () => {
      draw(ctx, t, {
        time,
        duration,
        progress: end === null ? 0 : t / duration,
        t,
        random,
        view,
      });
    });
  }
}
