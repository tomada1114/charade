import { defineProp, type PropDefinition, type Stage } from "../../index.js";

const ballParams = {
  radius: {
    type: "number",
    default: 0.06,
    min: 0.02,
    max: 0.5,
    unit: "units",
    doc: "The ball's radius; the figure's head is 0.09.",
  },
  color: {
    type: "color",
    default: "#e4572e",
    doc: "The ball's fill colour.",
  },
} as const;

export const ballProp: PropDefinition<typeof ballParams> = defineProp({
  name: "ball",
  description:
    "A ball resting on its ground point, with a seam so it reads as a ball rather than a dot. The action throw takes it as its ball parameter.",
  params: ballParams,
  draw(ctx, { radius, color }) {
    ctx.beginPath();
    ctx.arc(0, radius, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 0.015;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-radius * 0.9, radius, radius * 1.1, -0.9, 0.9);
    ctx.lineWidth = 0.008;
    ctx.stroke();
  },
  sample(stage: Stage): void {
    stage.prop(ballProp, { duration: 1 }).place({ x: -0.3, y: 0 });
    stage.prop(ballProp, { radius: 0.12, color: "#f2c14e", duration: 1 });
  },
});
