import { svgPath } from "../../draw/path-data.js";
import { type BackdropDefinition, defineBackdrop } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const nightParams = {
  sky: {
    type: "color",
    default: "#2f3b6b",
    doc: "The sky's colour at the top of the row.",
  },
  horizon: {
    type: "color",
    default: "#96a5cc",
    doc: "The sky's colour at the ground line; keep it light, since the figure is drawn in near-black ink against it.",
  },
  moon: {
    type: "enum",
    values: ["crescent", "full", "none"],
    default: "crescent",
    doc: "The moon's shape, or none for stars alone.",
  },
} as const;

const [CELL, LIGHT, MOON_X, MOON_Y] = [0.18, "#f6f1d3", 0.85, 1.78];
// Drawn on a 100 × 100 grid around (50, 50).
const CRESCENT = "M 62 4 A 48 48 0 1 0 96 62 A 38 38 0 1 1 62 4 Z";

export const nightBackdrop: BackdropDefinition<typeof nightParams> = defineBackdrop({
  name: "night",
  description:
    "A night sky: deep blue at the top of the row fading to a lighter blue at the ground line, so the ink figure still reads against it, with stars above head height, a moon up and to the right of the row's centre (x 0.85, y 1.78), low dark hills on the horizon and dark ground below the ground line. The stars are placed from the scene's seed and differ from row to row. It paints the whole row opaquely, edge to edge at every canvas shape and row count.",
  params: nightParams,
  draw(ctx, { sky, horizon, moon }, { view, random }) {
    const { left, right } = view;
    const width = right - left;
    const fade = ctx.createLinearGradient(0, view.top, 0, 0);
    fade.addColorStop(0, sky);
    fade.addColorStop(1, horizon);
    ctx.fillStyle = fade;
    ctx.fillRect(left, 0, width, view.top);

    // One star to a cell, so a wider row has more of the same sky rather than a
    // stretched one. A draw index is a whole number from 0, so cells left of the
    // centre take the odd ones.
    ctx.fillStyle = LIGHT;
    for (let i = Math.floor(left / CELL); i <= Math.ceil(right / CELL); i += 1) {
      const draw = (i < 0 ? -2 * i - 1 : 2 * i) * 4;
      const x = (i + random.float(draw)) * CELL;
      const y = 1.12 + random.float(draw + 1) * 1.02;
      if (moon !== "none" && Math.hypot(x - MOON_X, y - MOON_Y) < 0.3) {
        continue;
      }
      ctx.globalAlpha = 0.55 + 0.45 * random.float(draw + 2);
      ctx.beginPath();
      ctx.arc(x, y, 0.007 + 0.009 * random.float(draw + 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (moon === "full") {
      ctx.beginPath();
      ctx.arc(MOON_X, MOON_Y, 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else if (moon === "crescent") {
      ctx.beginPath();
      svgPath(ctx, CRESCENT, {
        scale: 0.0034,
        origin: { x: 50 - MOON_X / 0.0034, y: 50 + MOON_Y / 0.0034 },
      });
      ctx.fill();
    }

    ctx.fillStyle = sky;
    ctx.globalAlpha = 0.45;
    const [first, last] = [Math.floor(left / 0.25), Math.ceil(right / 0.25)];
    ctx.beginPath();
    ctx.moveTo(first * 0.25, 0);
    for (let i = first; i <= last; i += 1) {
      const x = i * 0.25;
      ctx.lineTo(x, 0.24 + 0.1 * Math.sin(0.8 * x + 1) + 0.05 * Math.sin(2.1 * x));
    }
    ctx.lineTo(last * 0.25, 0);
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = horizon;
    ctx.fillRect(left, view.bottom, width, -view.bottom);
    ctx.fillStyle = sky;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(left, view.bottom, width, -view.bottom);
  },
  sample(stage: Stage): void {
    stage.backdrop(nightBackdrop);
    stage.actor().wait(1);
  },
});
