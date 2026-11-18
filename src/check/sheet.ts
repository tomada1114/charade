import type { DrawingContext } from "../draw/context.js";
import { drawFigure, INK, PAPER } from "../draw/figure.js";
import {
  drawRow,
  facingOf,
  FrameItemError,
  type FrameSource,
  idOf,
  type Painter,
  rowContent,
} from "../draw/frame.js";
import { type RowLayout, rowLayout } from "../draw/layout.js";
import { poseAtFrame } from "../rig/compose.js";
import { frameSeconds } from "../timeline/time.js";
import type { Timeline, TimelineTrack } from "../timeline/timeline.js";
import { round } from "./describe.js";

/** How many frames a contact sheet shows when none are named. */
export const SHEET_CELLS = 12;

/** How many ghosts a ghost image overlays when no times are named. */
export const GHOSTS = 8;

/** The most frames one sheet or ghost image takes; past it a cell is too small to read. */
export const MAX_SHEET_FRAMES = 48;

/**
 * The longest edge of a check image, in pixels: the size an agent's image input takes
 * without scaling it down again, which would blur the labels.
 */
export const SHEET_EDGE = 1568;

const COLUMNS = 4;
const GAP = 8;
const LABEL_HEIGHT = 24;
/** A generic family, so no font file is needed; the size is fixed in sheet pixels. */
const LABEL_FONT = "16px sans-serif";
const FAINTEST_GHOST = 0.15;

/**
 * Up to `count` frames evenly spaced from `first` to `last`, both included. Frame `i`
 * of `n + 1` is `first + i × span / n` rounded to the nearest frame, a half up, in
 * integers. A span with fewer frames than `count` gives every frame once.
 */
export function spreadFrames(first: number, last: number, count: number): number[] {
  const span = last - first;
  if (count <= 1) {
    return [first];
  }
  if (span < count) {
    return Array.from({ length: span + 1 }, (_, i) => first + i);
  }
  const n = count - 1;
  return Array.from(
    { length: count },
    (_, i) => first + Math.floor((2 * i * span + n) / (2 * n)),
  );
}

/** One frame's place on a contact sheet, in sheet pixels. */
export interface SheetCell {
  readonly frame: number;
  /** The frame's time in seconds, to three decimals. */
  readonly time: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The text under the cell: its time and its frame number. */
  readonly label: string;
}

/** A contact sheet: its size in pixels and where each frame goes. */
export interface SheetLayout {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly SheetCell[];
}

/**
 * Lays `frames` out row by row, four to a row, each cell with the aspect ratio
 * `aspectWidth : aspectHeight` and a label strip under it. The sheet is
 * {@link SHEET_EDGE} wide unless that would make it taller than {@link SHEET_EDGE};
 * then the cells shrink until it fits.
 */
export function sheetLayout(
  aspectWidth: number,
  aspectHeight: number,
  frames: readonly number[],
  fps: number,
): SheetLayout {
  const columns = Math.max(1, Math.min(COLUMNS, frames.length));
  const rows = Math.max(1, Math.ceil(frames.length / columns));
  let cellWidth = Math.floor((SHEET_EDGE - GAP * (columns + 1)) / columns);
  let cellHeight = Math.max(1, Math.round((cellWidth * aspectHeight) / aspectWidth));
  const tallest = Math.floor((SHEET_EDGE - GAP) / rows) - LABEL_HEIGHT - GAP;
  if (cellHeight > tallest) {
    cellHeight = Math.max(1, tallest);
    cellWidth = Math.max(1, Math.round((cellHeight * aspectWidth) / aspectHeight));
  }
  const cells = frames.map((frame, index): SheetCell => {
    const time = round(frame / fps);
    return {
      frame,
      time,
      x: GAP + (index % columns) * (cellWidth + GAP),
      y: GAP + Math.floor(index / columns) * (cellHeight + LABEL_HEIGHT + GAP),
      width: cellWidth,
      height: cellHeight,
      label: `${String(time)} s  frame ${String(frame)}`,
    };
  });
  return {
    width: GAP + columns * (cellWidth + GAP),
    height: GAP + rows * (cellHeight + LABEL_HEIGHT + GAP),
    cells,
  };
}

function labelStyle(ctx: DrawingContext): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = INK;
  ctx.font = LABEL_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
}

/**
 * Draws what a sheet adds over its cells' pictures: an outline around each cell, since
 * a cell is paper on paper, and its label beneath.
 */
export function drawSheetLabels(ctx: DrawingContext, layout: SheetLayout): void {
  labelStyle(ctx);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  for (const cell of layout.cells) {
    ctx.strokeRect(cell.x - 0.5, cell.y - 0.5, cell.width + 1, cell.height + 1);
    ctx.fillText(
      cell.label,
      cell.x,
      cell.y + cell.height + LABEL_HEIGHT / 2 + 1,
      cell.width,
    );
  }
}

/** Row `row` filling the whole of a `width` × `height` picture. */
function soleRowLayout(width: number, height: number, row: number): RowLayout {
  return { ...rowLayout(width, height, 1, 0), index: row };
}

function clear(ctx: DrawingContext, width: number, height: number): void {
  ctx.reset();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Draws one row of frame `frame` filling a picture of `source`'s size. The row keeps
 * its index, so its items draw exactly as they do in the whole frame.
 *
 * @throws `FrameItemError` when drawing one item throws.
 */
export function drawRowFrame(
  ctx: DrawingContext,
  source: FrameSource,
  row: number,
  frame: number,
): void {
  const { timeline, width, height } = source;
  frameSeconds(frame, timeline.fps);
  clear(ctx, width, height);
  const layout = soleRowLayout(width, height, row);
  drawRow(ctx, layout, rowContent(timeline, layout, frame));
}

/** The size of a row's band of a `width` × `height` scene, as an aspect ratio. */
export function rowAspect(
  width: number,
  height: number,
  rows: number,
): { readonly width: number; readonly height: number } {
  return { width, height: height / rows };
}

/** A ghost image: its size in pixels, the band the row is drawn in, and its legend. */
export interface GhostLayout {
  readonly width: number;
  readonly height: number;
  /** The height of the row's picture; the legend strip is below it. */
  readonly band: number;
  readonly legend: string;
}

/**
 * The layout of a ghost image of the actor `id` at `frames`: the actor's row at
 * {@link SHEET_EDGE} wide, or smaller when that would be taller than
 * {@link SHEET_EDGE}, with one legend line beneath.
 */
export function ghostLayout(
  aspectWidth: number,
  aspectHeight: number,
  id: string,
  frames: readonly number[],
): GhostLayout {
  let width = SHEET_EDGE;
  let band = Math.max(1, Math.round((width * aspectHeight) / aspectWidth));
  const tallest = SHEET_EDGE - LABEL_HEIGHT;
  if (band > tallest) {
    band = tallest;
    width = Math.max(1, Math.round((band * aspectWidth) / aspectHeight));
  }
  return {
    width,
    height: band + LABEL_HEIGHT,
    band,
    legend: `ghost ${id}, faint to solid: frames ${frames.join(", ")}`,
  };
}

/**
 * Draws one actor at each of `frames` on one picture of its row, the earliest
 * faintest and the last in full ink, over the row's backdrop at the last frame. The
 * row's other items are left out: they have no single time to be drawn at.
 *
 * @throws `FrameItemError` when the actor's pose cannot be composed at a frame.
 */
export function drawGhosts(
  ctx: DrawingContext,
  timeline: Timeline,
  row: number,
  track: TimelineTrack,
  frames: readonly number[],
  layout: GhostLayout,
): void {
  clear(ctx, layout.width, layout.height);
  const rowBand = soleRowLayout(layout.width, layout.band, row);
  const ghosts = frames.map((frame, index): Painter => (painted) => {
    try {
      painted.globalAlpha =
        frames.length === 1
          ? 1
          : FAINTEST_GHOST + ((1 - FAINTEST_GHOST) * index) / (frames.length - 1);
      drawFigure(painted, poseAtFrame(timeline, row, track, frame), facingOf(track), 0);
    } catch (error) {
      throw new FrameItemError(
        row,
        idOf(row, track),
        frame,
        frame / timeline.fps,
        error,
      );
    }
  });
  const last = frames.at(-1) ?? 0;
  drawRow(ctx, rowBand, {
    backdrop: rowContent(timeline, rowBand, last).backdrop,
    propsBehind: [],
    actor: ghosts,
    propsInFront: [],
    text: [],
  });
  labelStyle(ctx);
  ctx.fillText(
    layout.legend,
    GAP,
    layout.band + LABEL_HEIGHT / 2,
    layout.width - 2 * GAP,
  );
}

/** An actor's track and the row it is in. */
export interface ActorTrack {
  readonly row: number;
  readonly track: TimelineTrack;
}

/** What naming an actor found: the one actor, or the ids to choose from. */
export type ActorMatch =
  | ({ readonly kind: "found" } & ActorTrack)
  | { readonly kind: "none"; readonly ids: readonly string[] };

/**
 * Finds the actor `name` names: its id as findings print it, or its bare name when
 * exactly one actor in the scene has it.
 */
export function findActor(timeline: Timeline, name: string): ActorMatch {
  const actors = timeline.rows.flatMap((timelineRow, row) =>
    timelineRow.tracks
      .filter((track) => track.kind === "actor")
      .map((track): ActorTrack => ({ row, track })),
  );
  const byId = actors.find(({ row, track }) => idOf(row, track) === name);
  const named = actors.filter(({ track }) => track.name === name);
  const found = byId ?? (named.length === 1 ? named[0] : undefined);
  return found === undefined
    ? { kind: "none", ids: actors.map(({ row, track }) => idOf(row, track)) }
    : { kind: "found", ...found };
}
