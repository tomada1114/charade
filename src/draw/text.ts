import { poseAtFrame } from "../rig/compose.js";
import { forwardKinematics, mirrorSkeleton, type Point } from "../rig/kinematics.js";
import { SEGMENT_LENGTHS } from "../rig/rig.js";
import { TEXT_ALIGNS, type TextAlign } from "../timeline/segments.js";
import { frameInSegment } from "../timeline/time.js";
import type { Timeline, TimelineTrack } from "../timeline/timeline.js";
import type { DrawingContext, ShapeContext } from "./context.js";
import { facingOf, INK, PAPER } from "./figure.js";
import type { RowLayout } from "./layout.js";

/**
 * The defaults the scene layer records with every label and bubble; they are read
 * here only for a hand-built timeline that leaves a field out.
 */
const DEFAULT_TEXT_SIZE = 0.16;
const DEFAULT_LABEL_POINT: Point = { x: 0, y: 2 };
const BUBBLE_WRAP = 12;

/** The distance from one line's middle to the next, in font sizes. */
const LINE_HEIGHT = 1.35;

/** The paper-coloured outline that keeps a label readable over a drawing, in font sizes. */
const HALO = 0.25;

/** A bubble's padding around its text, in font sizes. */
const BUBBLE_PAD_X = 0.6;
const BUBBLE_PAD_Y = 0.4;
/** A bubble's corner radius and the width of its tail's base, in font sizes. */
const BUBBLE_RADIUS = 0.6;
const TAIL_WIDTH = 0.8;
/** A bubble's outline, the gap from the head to the tail's tip, and the tail's height, in units. */
const BUBBLE_LINE = 0.015;
const TAIL_GAP = 0.04;
const TAIL_HEIGHT = 0.12;
/** How close to its row's side edges a bubble may sit, in units. */
const BUBBLE_MARGIN = 0.05;

const HEAD_RADIUS = SEGMENT_LENGTHS.head / 2;

/**
 * The pixel size the engine sets the context's font to before a frame's text is
 * drawn. Text is drawn at this size under a scale, never at its size in row units: a
 * font a fraction of a pixel tall is not a size every rasteriser takes.
 */
const TEXT_FONT_PX = 100;

/** The context font that draws text in `family`, a CSS font family list. */
export function textFont(family: string): string {
  return `${String(TEXT_FONT_PX)}px ${family}`;
}

const FONT_PX = /(\d+(?:\.\d+)?)px/;

/** What laying text out needs of a context: its font and its measurer. */
export type TextMeasurer = Pick<DrawingContext, "font" | "measureText">;

/** The pixel size of the context's font; 10, the standard default, when it names none. */
function fontPx(ctx: TextMeasurer): number {
  const size = Number(FONT_PX.exec(ctx.font)?.[1]);
  return size > 0 ? size : 10;
}

/** Text broken into lines, with the size of the block they make, in row units. */
export interface TextBlock {
  readonly lines: readonly string[];
  readonly width: number;
  readonly height: number;
  /** The font size. */
  readonly size: number;
}

function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    (codePoint >= 0x20000 && codePoint <= 0x3ffff)
  );
}

/** Characters a line may not start with: they stay with the one before them. */
const NO_LINE_START = "、。，．！？：；）」』】〉》〕｝ー～…‥・ゃゅょっャュョッ";
/** Characters a line may not end with: they stay with the one after them. */
const NO_LINE_END = "（「『【〈《〔｛";

/** One piece a line cannot be broken inside, and whether a space came before it. */
interface Atom {
  text: string;
  readonly spaced: boolean;
}

/**
 * The pieces of one paragraph a line may break between: a run of narrow characters up
 * to a space is one (a word), and each wide character (kana, kanji, hangul, full-width
 * forms) is its own, since such text has no spaces to break at.
 */
function atomsOf(paragraph: string): Atom[] {
  const atoms: Atom[] = [];
  let spaced = false;
  let joins = false;
  let wide = false;
  for (const character of paragraph) {
    if (character.trim() === "") {
      spaced = true;
      joins = false;
      continue;
    }
    const nowWide = isWide(character.codePointAt(0) ?? 0);
    const last = atoms.at(-1);
    if (
      last !== undefined &&
      !spaced &&
      (joins || NO_LINE_START.includes(character) || (!nowWide && !wide))
    ) {
      last.text += character;
    } else {
      atoms.push({ text: character, spaced });
    }
    spaced = false;
    joins = NO_LINE_END.includes(character);
    wide = nowWide;
  }
  return atoms;
}

/**
 * Breaks `text` into lines and measures them with `ctx`, at a font `size` in row
 * units. A newline always breaks; with `wrap`, a line is also broken where it would
 * run wider than that many units, between words and between wide characters. A piece
 * wider than `wrap` keeps a line of its own.
 */
export function layoutText(
  ctx: TextMeasurer,
  text: string,
  size: number,
  wrap: number | null,
): TextBlock {
  const unitsPerPx = size / fontPx(ctx);
  const widthOf = (line: string): number => ctx.measureText(line).width * unitsPerPx;
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (wrap === null) {
      lines.push(paragraph.trim());
      continue;
    }
    let line = "";
    for (const atom of atomsOf(paragraph)) {
      const longer =
        line === "" ? atom.text : `${line}${atom.spaced ? " " : ""}${atom.text}`;
      if (line !== "" && widthOf(longer) > wrap) {
        lines.push(line);
        line = atom.text;
      } else {
        line = longer;
      }
    }
    lines.push(line);
  }
  return {
    lines,
    width: Math.max(0, ...lines.map((line) => (line === "" ? 0 : widthOf(line)))),
    height: lines.length * LINE_HEIGHT * size,
    size,
  };
}

/** The left edge of a block `width` wide whose alignment point is at `x`. */
function leftOf(x: number, width: number, align: TextAlign): number {
  return align === "left" ? x : align === "right" ? x - width : x - width / 2;
}

/**
 * Draws a block with its alignment point at `x` and its middle at `y`, in the current
 * fill style. The context's `y` points up, so the text is drawn under a flip of its
 * own and reads the right way up.
 */
function paintBlock(
  ctx: DrawingContext,
  block: TextBlock,
  x: number,
  y: number,
  align: TextAlign,
  halo: boolean,
): void {
  const px = fontPx(ctx);
  const scale = block.size / px;
  ctx.save();
  try {
    ctx.translate(x, y);
    ctx.scale(scale, -scale);
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    if (halo) {
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = HALO * px;
      ctx.lineJoin = "round";
    }
    block.lines.forEach((line, index) => {
      const lineY = (index - (block.lines.length - 1) / 2) * LINE_HEIGHT * px;
      if (halo) {
        ctx.strokeText(line, 0, lineY);
      }
      ctx.fillText(line, 0, lineY);
    });
  } finally {
    ctx.restore();
  }
}

/**
 * Options of {@link drawText}.
 *
 * @public
 */
export interface DrawTextOptions {
  /** Where the text's alignment point is along `x`. Defaults to 0. */
  readonly x?: number;
  /** Where the middle of the text block is along `y`. Defaults to 0. */
  readonly y?: number;
  /** The font size, in the context's units. Defaults to 0.16. */
  readonly size?: number;
  /** Which part of the block `x` names. Defaults to `center`. */
  readonly align?: TextAlign;
  /** The width lines wrap at, in the context's units. Without it only `\n` breaks. */
  readonly width?: number;
}

/**
 * The size of a block of drawn text, in the context's units.
 *
 * @public
 */
export interface TextSize {
  /** The width of the widest line. */
  readonly width: number;
  /** The height of all lines. */
  readonly height: number;
}

function hasText(ctx: ShapeContext): ctx is DrawingContext {
  return "fillText" in ctx && "measureText" in ctx && "font" in ctx;
}

/**
 * Draw text in a depth 4 drawing: a prop's, a backdrop's, an effect's, or `row.draw`'s.
 *
 * @remarks
 * A `ShapeContext` has no text members, because its `y` points up and raw text would
 * come out upside down. This draws the text the right way up, in the context's current
 * fill style and in the scene's font, centred on (`x`, `y`). It returns the block's
 * size so a drawing can fit a shape around it; the size comes from the font, so it
 * differs between machines with different fonts.
 *
 * Text drawn this way belongs to its drawing: `check` measures labels and speech
 * bubbles, not this. On a context charade did not hand you, one without text members,
 * it draws nothing and returns a size of 0.
 *
 * @param ctx - The context the drawing was handed.
 * @param text - The text; `\n` starts a new line.
 * @param options - Where the text goes, its size, alignment and wrapping width.
 * @returns The size of the block of text.
 *
 * @example
 * ```ts
 * import { defineProp } from "charade";
 *
 * const sign = defineProp({
 *   name: "sign",
 *   description: "A board on a post, with a word on it.",
 *   params: { word: { type: "text", default: "止まれ", doc: "What the sign says." } },
 *   draw(ctx, { word }) {
 *     ctx.strokeRect(-0.4, 0.5, 0.8, 0.3);
 *     drawText(ctx, word, { y: 0.65, size: 0.12 });
 *   },
 * });
 * ```
 *
 * @public
 */
export function drawText(
  ctx: ShapeContext,
  text: string,
  options: DrawTextOptions = {},
): TextSize {
  if (!hasText(ctx)) {
    return { width: 0, height: 0 };
  }
  const { x = 0, y = 0, size = DEFAULT_TEXT_SIZE, align = "center", width } = options;
  const block = layoutText(ctx, text, size, width ?? null);
  paintBlock(ctx, block, x, y, align, false);
  return { width: block.width, height: block.height };
}

/** A box in row units: `x` and `y` are its lower left corner, `y` up. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A label or a bubble as it is shown at one frame. */
export interface PlacedText {
  /** What the item covers: a label's lines, a bubble's body without its tail. */
  readonly box: Box;
  /** The font size, in row units. */
  readonly size: number;
  /** The text shown. */
  readonly text: string;
  paint(ctx: DrawingContext): void;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function isAlign(value: unknown): value is TextAlign {
  return TEXT_ALIGNS.some((align) => align === value);
}

function placedLabel(
  ctx: TextMeasurer,
  data: Readonly<Record<string, unknown>>,
  text: string,
): PlacedText {
  const size = positive(data["size"], DEFAULT_TEXT_SIZE);
  const x = finite(data["x"], DEFAULT_LABEL_POINT.x);
  const y = finite(data["y"], DEFAULT_LABEL_POINT.y);
  const align = isAlign(data["align"]) ? data["align"] : "center";
  const wrap = data["width"] === null ? null : positive(data["width"], Infinity);
  const block = layoutText(ctx, text, size, wrap === Infinity ? null : wrap);
  return {
    box: {
      x: leftOf(x, block.width, align),
      y: y - block.height / 2,
      width: block.width,
      height: block.height,
    },
    size,
    text,
    paint: (painted) => {
      painted.fillStyle = INK;
      paintBlock(painted, block, x, y, align, true);
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return min > max ? (min + max) / 2 : Math.min(Math.max(value, min), max);
}

/**
 * A bubble above `head`, the centre of the speaker's head: as near to straight above
 * as the row's side edges allow, its tail pointing down at the head.
 */
function placedBubble(
  ctx: TextMeasurer,
  data: Readonly<Record<string, unknown>>,
  text: string,
  head: Point,
  layout: RowLayout,
): PlacedText {
  const size = positive(data["size"], DEFAULT_TEXT_SIZE);
  const block = layoutText(
    ctx,
    text,
    size,
    positive(data["width"], BUBBLE_WRAP * size),
  );
  const width = block.width + 2 * BUBBLE_PAD_X * size;
  const height = block.height + 2 * BUBBLE_PAD_Y * size;
  const edge = layout.units / 2 - BUBBLE_MARGIN;
  const left = clamp(head.x - width / 2, -edge, edge - width);
  const right = left + width;
  const tip = { x: head.x, y: head.y + HEAD_RADIUS + TAIL_GAP };
  const bottom = tip.y + TAIL_HEIGHT;
  const top = bottom + height;
  const radius = Math.min(BUBBLE_RADIUS * size, width / 2, height / 2);
  const tail = Math.min(TAIL_WIDTH * size, width - 2 * radius) / 2;
  const base = clamp(head.x, left + radius + tail, right - radius - tail);
  return {
    box: { x: left, y: bottom, width, height },
    size,
    text,
    paint: (painted) => {
      painted.beginPath();
      painted.moveTo(left + radius, bottom);
      painted.lineTo(base - tail, bottom);
      painted.lineTo(tip.x, tip.y);
      painted.lineTo(base + tail, bottom);
      painted.lineTo(right - radius, bottom);
      painted.arcTo(right, bottom, right, bottom + radius, radius);
      painted.lineTo(right, top - radius);
      painted.arcTo(right, top, right - radius, top, radius);
      painted.lineTo(left + radius, top);
      painted.arcTo(left, top, left, top - radius, radius);
      painted.lineTo(left, bottom + radius);
      painted.arcTo(left, bottom, left + radius, bottom, radius);
      painted.closePath();
      painted.fillStyle = PAPER;
      painted.fill();
      painted.strokeStyle = INK;
      painted.lineWidth = BUBBLE_LINE;
      painted.lineJoin = "round";
      painted.stroke();
      painted.fillStyle = INK;
      paintBlock(
        painted,
        block,
        (left + right) / 2,
        (bottom + top) / 2,
        "center",
        false,
      );
    },
  };
}

/** Where the actor a bubble names has the centre of its head at `frame`. */
function headOf(
  timeline: Timeline,
  row: number,
  actor: unknown,
  frame: number,
): Point | undefined {
  if (!isRecord(actor)) {
    return undefined;
  }
  const speaker = timeline.rows[row]?.tracks.find(
    (candidate) =>
      candidate.kind === "actor" &&
      candidate.name === actor["name"] &&
      candidate.occurrence === actor["occurrence"],
  );
  if (speaker === undefined) {
    return undefined;
  }
  const skeleton = forwardKinematics(poseAtFrame(timeline, row, speaker, frame));
  return (facingOf(speaker) === "left" ? mirrorSkeleton(skeleton) : skeleton)
    .headCentre;
}

/** Whether a track holds text: a label's, or an actor's speech bubbles. */
export function isTextTrack(track: TimelineTrack): boolean {
  return track.kind === "label" || track.kind === "bubble";
}

/**
 * The label or bubble `track` shows at `frame`, laid out with `ctx`'s measurer, or
 * `undefined` while it shows none. When two of its segments cover the frame the one
 * recorded later is shown: an actor has one bubble at a time. Composing the speaker's
 * pose calls its functions, so this throws what they throw.
 */
export function placedText(
  ctx: TextMeasurer,
  timeline: Timeline,
  layout: RowLayout,
  track: TimelineTrack,
  frame: number,
): PlacedText | undefined {
  const data = track.segments.findLast(
    (segment) =>
      isRecord(segment.data) &&
      frameInSegment(frame, segment.start, segment.end, timeline.fps),
  )?.data;
  if (!isRecord(data)) {
    return undefined;
  }
  const { kind, text } = data;
  if (typeof text !== "string") {
    return undefined;
  }
  if (kind === "label") {
    return placedLabel(ctx, data, text);
  }
  const head =
    kind === "say" ? headOf(timeline, layout.index, data["actor"], frame) : undefined;
  return head === undefined ? undefined : placedBubble(ctx, data, text, head, layout);
}
