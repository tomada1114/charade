import { defineProp, type PropDefinition } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const hoopParams = {
  height: {
    type: "number",
    default: 1.5,
    min: 0.6,
    max: 1.8,
    unit: "units",
    doc: "How high the rim is above the ground; a standing figure is 1.",
  },
  faces: {
    type: "enum",
    values: ["left", "right"],
    default: "left",
    doc: "The side the rim sticks out to, which is the side the thrower stands on.",
  },
  color: {
    type: "color",
    default: "#e4572e",
    doc: "The rim's colour.",
  },
} as const;

const RIM = 0.13;

export const hoopProp: PropDefinition<typeof hoopParams> = defineProp({
  name: "hoop",
  description:
    "A basketball hoop seen from the side: a rim with a net, a backboard and a pole. Its ground point is straight under the rim's centre, not under the pole, so a ball aimed at { x: the hoop's x, y: height } goes through the rim; the pole stands 0.42 further from the thrower. The rim is 0.26 across, wide enough for the default ball.",
  params: hoopParams,
  draw(ctx, { height, faces, color }) {
    if (faces === "right") {
      ctx.scale(-1, 1);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // The pole, its foot, and the arm that carries the backboard.
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.moveTo(0.34, 0);
    ctx.lineTo(0.5, 0);
    ctx.moveTo(0.42, 0);
    ctx.lineTo(0.42, height + 0.1);
    ctx.lineTo(RIM + 0.06, height + 0.1);
    ctx.stroke();
    ctx.lineWidth = 0.015;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.rect(RIM + 0.02, height - 0.06, 0.04, 0.36);
    ctx.fill();
    ctx.stroke();
    // The net hangs from the rim and narrows; the rim is drawn over its top.
    ctx.lineWidth = 0.006;
    ctx.beginPath();
    const [bottom, drop] = [RIM * 0.55, 0.17];
    for (let i = 0; i <= 4; i += 1) {
      const p = i / 2 - 1;
      ctx.moveTo(p * RIM, height);
      ctx.lineTo(Math.max(-1, Math.min(1, p + 0.5)) * bottom, height - drop);
      ctx.moveTo(p * RIM, height);
      ctx.lineTo(Math.max(-1, Math.min(1, p - 0.5)) * bottom, height - drop);
    }
    ctx.moveTo(-bottom, height - drop);
    ctx.lineTo(bottom, height - drop);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.022;
    ctx.beginPath();
    ctx.ellipse(0, height, RIM, 0.028, 0, 0, Math.PI * 2);
    ctx.moveTo(RIM, height);
    ctx.lineTo(RIM + 0.02, height);
    ctx.stroke();
  },
  sample(stage: Stage): void {
    stage.prop(hoopProp).place({ x: 0.65, y: 0 });
    stage.prop(hoopProp, { height: 1, faces: "right" }).place({ x: -0.7, y: 0 });
    stage.actor().wait(1);
  },
});
