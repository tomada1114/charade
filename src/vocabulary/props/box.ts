import { defineProp, type PropDefinition } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const boxParams = {
  width: {
    type: "number",
    default: 0.36,
    min: 0.05,
    max: 2,
    unit: "units",
    doc: "How wide the box is.",
  },
  height: {
    type: "number",
    default: 0.26,
    min: 0.05,
    max: 2,
    unit: "units",
    doc: "How tall the box is; sitDown's seat defaults to this height.",
  },
  color: {
    type: "color",
    default: "#d9b382",
    doc: "The box's fill colour.",
  },
} as const;

export const boxProp: PropDefinition<typeof boxParams> = defineProp({
  name: "box",
  description:
    "A wooden crate standing on its ground point, centred on it. It is the seat of sitDown, and of slump done after it: place it 0.24 behind the actor, box.place({ x: -0.24, y: 0 }), and its default height is sitDown's default seat. throw does not use it.",
  params: boxParams,
  draw(ctx, { width, height, color }) {
    const left = -width / 2;
    const inset = Math.min(width, height) * 0.14;
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.015;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.rect(left, 0, width, height);
    ctx.fill();
    ctx.stroke();
    // The planks of a crate: an inner frame and one diagonal brace.
    ctx.lineWidth = 0.008;
    ctx.beginPath();
    ctx.rect(left + inset, inset, width - 2 * inset, height - 2 * inset);
    ctx.moveTo(left + inset, inset);
    ctx.lineTo(left + width - inset, height - inset);
    ctx.stroke();
  },
  sample(stage: Stage): void {
    stage.prop(boxProp, { duration: 1 }).place({ x: -0.4, y: 0 });
    stage
      .prop(boxProp, { width: 0.5, height: 0.5, color: "#b9c4cc", duration: 1 })
      .place({ x: 0.35, y: 0 });
  },
});
