import { defineProp, type PropDefinition, type Stage } from "../../index.js";

const deskParams = {
  width: {
    type: "number",
    default: 0.9,
    min: 0.4,
    max: 2.4,
    unit: "units",
    doc: "How wide the desk top is.",
  },
  height: {
    type: "number",
    default: 0.44,
    min: 0.25,
    max: 1,
    unit: "units",
    doc: "How high the desk top's surface is; a figure seated on the default box has its elbows near 0.4.",
  },
  color: {
    type: "color",
    default: "#c58b4e",
    doc: "The desk's fill colour.",
  },
} as const;

const [TOP, LEG] = [0.045, 0.04];

export const deskProp: PropDefinition<typeof deskParams> = defineProp({
  name: "desk",
  description:
    'An office desk seen from the side: a top on two legs with a drawer under its right end, standing on its ground point and centred on it. Its surface is at y = height (0.44 by default): place a laptop there. For a figure sitting at it, place it with layer: "front" so the top covers the knees.',
  params: deskParams,
  draw(ctx, { width, height, color }) {
    const half = width / 2;
    const under = height - TOP;
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.015;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.rect(-half + 0.05, 0, LEG, under);
    ctx.rect(half - 0.05 - LEG, 0, LEG, under);
    const drawer = Math.min(0.3, width * 0.36);
    ctx.rect(half - 0.05 - drawer, under - 0.13, drawer, 0.13);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(-half, under, width, TOP);
    ctx.fill();
    ctx.stroke();
    ctx.lineCap = "round";
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    ctx.moveTo(half - 0.05 - drawer / 2 - 0.035, under - 0.065);
    ctx.lineTo(half - 0.05 - drawer / 2 + 0.035, under - 0.065);
    ctx.stroke();
  },
  sample(stage: Stage): void {
    stage.prop(deskProp).place({ x: 0.72, y: 0 });
    stage
      .prop(deskProp, { width: 0.5, height: 0.7, color: "#b9c4cc" })
      .place({ x: -0.8, y: 0 });
    stage.actor().wait(1);
  },
});
