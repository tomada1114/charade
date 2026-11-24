import type { ShapeContext } from "../../draw/context.js";
import { svgPath } from "../../draw/path-data.js";
import { type BackdropDefinition, defineBackdrop } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const hillParams = {
  grass: {
    type: "color",
    default: "#9ccb8b",
    doc: "The grass's colour: the ground below the ground line, and paler on the hills behind.",
  },
  sky: {
    type: "color",
    default: "#e4f1f7",
    doc: "The sky's colour.",
  },
} as const;

const STEP = 0.2;
// How far apart the near hill's crests are: one period of its main wave.
const CRESTS = (2 * Math.PI) / 0.9;
// Drawn on a 100 × 60 grid, its foot at (50, 60).
const CLOUD =
  "M 14 60 Q 0 60 2 46 Q 4 34 18 36 Q 22 16 42 18 Q 58 4 72 22 Q 92 20 94 40 Q 100 58 84 60 Z";
// Drawn on a 60 × 100 grid, its foot at (30, 100).
const CROWN = "M 30 62 Q 4 64 6 40 Q 2 14 28 8 Q 54 2 56 34 Q 60 62 30 62 Z";

/** The near hill's height at `x`: one crest every 7 units, the first 1.08 right of centre. */
function near(x: number): number {
  return 0.8 + 0.42 * Math.sin(0.9 * x + 0.6) + 0.06 * Math.sin(2.3 * x + 1);
}

/** The far ridge's height at `x`. */
function far(x: number): number {
  return 1.22 + 0.2 * Math.sin(0.55 * x + 2.4) + 0.08 * Math.sin(1.7 * x);
}

/** Fills the area under `height` from `left` to `right`, down to the ground line. */
function ridge(
  ctx: ShapeContext,
  height: (x: number) => number,
  left: number,
  right: number,
): void {
  const first = Math.floor(left / STEP);
  const last = Math.ceil(right / STEP);
  ctx.beginPath();
  ctx.moveTo(first * STEP, 0);
  for (let i = first; i <= last; i += 1) {
    ctx.lineTo(i * STEP, height(i * STEP));
  }
  ctx.lineTo(last * STEP, 0);
  ctx.fill();
}

export const hillBackdrop: BackdropDefinition<typeof hillParams> = defineBackdrop({
  name: "hill",
  description:
    "Open country: a grassy hill rising behind the flat ground the figure stands on, a paler ridge beyond it, a tree on the crest and a cloud in the sky. The hill crests 1.2 high about 1.1 right of the row's centre and again every 7 units, so a square row shows one slope climbing to the right and a wide row shows rolling hills; the ground line itself stays level. It paints the whole row opaquely, edge to edge at every canvas shape and row count.",
  params: hillParams,
  draw(ctx, { grass, sky }, { view }) {
    const { left, right } = view;
    const width = right - left;
    ctx.fillStyle = sky;
    ctx.fillRect(left, 0, width, view.top);

    ctx.fillStyle = "#ffffff";
    // A large cloud and a small higher one take turns, 2.9 apart.
    for (let i = Math.floor((left - 1) / 2.9); i <= Math.ceil(right / 2.9); i += 1) {
      const scale = i % 2 === 0 ? 0.0075 : 0.005;
      ctx.save();
      ctx.translate(i * 2.9 - 0.55, i % 2 === 0 ? 1.72 : 1.93);
      ctx.beginPath();
      svgPath(ctx, CLOUD, { scale, origin: { x: 50, y: 60 } });
      ctx.fill();
      ctx.restore();
    }

    // The hills are the grass colour thinned over the sky, so one colour sets all three.
    ctx.fillStyle = grass;
    ctx.globalAlpha = 0.3;
    ridge(ctx, far, left, right);
    ctx.globalAlpha = 0.62;
    ridge(ctx, near, left, right);

    // A tree just short of each crest.
    ctx.strokeStyle = "#8a7a63";
    ctx.lineCap = "round";
    ctx.lineWidth = 0.022;
    for (
      let i = Math.floor((left - 2) / CRESTS);
      i <= Math.ceil(right / CRESTS);
      i += 1
    ) {
      const x = 0.95 + i * CRESTS;
      ctx.save();
      ctx.translate(x, near(x) - 0.01);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 0.2);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      svgPath(ctx, CROWN, { scale: 0.0045, origin: { x: 30, y: 100 } });
      ctx.fill();
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    ctx.fillRect(left, view.bottom, width, -view.bottom);
  },
  sample(stage: Stage): void {
    stage.backdrop(hillBackdrop);
    stage.actor().wait(1);
  },
});
