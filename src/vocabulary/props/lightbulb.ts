import { svgPath } from "../../draw/path-data.js";
import { defineProp, type PropDefinition } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const lightbulbParams = {
  size: {
    type: "number",
    default: 0.32,
    min: 0.1,
    max: 1,
    unit: "units",
    doc: "How tall the bulb is from the tip of its base to the top of the glass; the figure's head is 0.18.",
  },
  lit: {
    type: "boolean",
    default: true,
    doc: "Whether the bulb is on: lit, the glass is filled with color and rays stand around it.",
  },
  color: {
    type: "color",
    default: "#ffd84d",
    doc: "The colour of the lit glass and its rays.",
  },
} as const;

// Drawn on a 60 × 100 grid, base down, its tip at (30, 100); the glass centres on (30, 34).
const GLASS = "M 19 72 C 19 60 2 55 2 34 A 28 28 0 0 1 58 34 C 58 55 41 60 41 72 Z";
const BASE = "M 19 72 H 41 V 90 L 35 100 H 25 L 19 90 Z";
const THREADS = "M 19 78 H 41 M 19 84 H 41";
const FILAMENT = "M 25 72 L 23 46 L 27 53 L 30 45 L 33 53 L 37 46 L 35 72";

export const lightbulbProp: PropDefinition<typeof lightbulbParams> = defineProp({
  name: "lightbulb",
  description:
    "The light bulb of having an idea: a glass bulb over a screw base, lit with rays around it or unlit. It floats, so its ground point is the tip of its base: place it above the head, for a standing figure about { x: 0, y: 1.15 }. Show it from a moment on with at, or an unlit one first and a lit one after it.",
  params: lightbulbParams,
  draw(ctx, { size, lit, color }) {
    const shape = { scale: size / 100, origin: { x: 30, y: 100 } };
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (lit) {
      ctx.strokeStyle = color;
      ctx.lineWidth = size * 0.045;
      ctx.beginPath();
      for (let i = 0; i < 7; i += 1) {
        const a = Math.PI * (i / 4 - 0.25);
        const [x, y] = [Math.cos(a) * size, Math.sin(a) * size];
        ctx.moveTo(x * 0.37, size * 0.66 + y * 0.37);
        ctx.lineTo(x * 0.5, size * 0.66 + y * 0.5);
      }
      ctx.stroke();
      ctx.strokeStyle = "#111111";
    }
    ctx.lineWidth = 0.012;
    ctx.fillStyle = lit ? color : "#ffffff";
    ctx.beginPath();
    svgPath(ctx, GLASS, shape);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 0.007;
    ctx.beginPath();
    svgPath(ctx, FILAMENT, shape);
    ctx.stroke();
    ctx.lineWidth = 0.012;
    ctx.fillStyle = "#9a9a94";
    ctx.beginPath();
    svgPath(ctx, BASE, shape);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 0.007;
    ctx.beginPath();
    svgPath(ctx, THREADS, shape);
    ctx.stroke();
  },
  sample(stage: Stage): void {
    stage.prop(lightbulbProp).place({ x: 0, y: 1.15 });
    stage.prop(lightbulbProp, { size: 0.5, lit: false }).place({ x: 0.75, y: 0.6 });
    stage.actor().wait(1);
  },
});
