import { svgPath } from "../../draw/path-data.js";
import { defineProp, type PropDefinition } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const rockParams = {
  size: {
    type: "number",
    default: 0.7,
    min: 0.1,
    max: 2,
    unit: "units",
    doc: "How wide the rock is; it is 0.78 times as tall.",
  },
  color: {
    type: "color",
    default: "#a3a39b",
    doc: "The rock's fill colour.",
  },
} as const;

// Drawn on a 100 × 78 grid, its foot at (50, 78).
const OUTLINE = "M 5 78 Q -3 58 10 41 Q 16 16 41 7 Q 67 -3 85 21 Q 103 47 95 78 Z";
const CRACKS = "M 28 27 Q 41 40 35 58 M 63 14 Q 72 30 66 44 M 66 44 Q 78 52 80 66";

export const rockProp: PropDefinition<typeof rockParams> = defineProp({
  name: "rock",
  description:
    "A heavy boulder resting on its ground point, centred on it, 0.55 tall at its default size: a little over half a figure, so it reads as too heavy to lift. It has no moving part; an action or a scene moves it with the handle's place and move, and on the cart's deck it sits at y 0.24.",
  params: rockParams,
  draw(ctx, { size, color }) {
    const shape = { scale: size / 100, origin: { x: 50, y: 78 } };
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 0.015;
    ctx.fillStyle = color;
    ctx.beginPath();
    svgPath(ctx, OUTLINE, shape);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 0.008;
    ctx.beginPath();
    svgPath(ctx, CRACKS, shape);
    ctx.stroke();
  },
  sample(stage: Stage): void {
    stage.prop(rockProp).place({ x: 0.7, y: 0 });
    stage.prop(rockProp, { size: 0.3, color: "#c9b79c" }).place({ x: -0.6, y: 0 });
    stage.actor().wait(1);
  },
});
