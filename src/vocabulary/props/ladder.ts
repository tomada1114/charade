import { defineProp, type PropDefinition, type Stage } from "../../index.js";

const ladderParams = {
  height: {
    type: "number",
    default: 1.5,
    min: 0.4,
    max: 2.1,
    unit: "units",
    doc: "How tall the ladder is; a standing figure is 1.",
  },
  lean: {
    type: "number",
    default: 0.12,
    min: -0.6,
    max: 0.6,
    unit: "rad",
    doc: "How far the ladder leans from upright, positive with its top to the right. Both feet stay on the ground.",
  },
  color: {
    type: "color",
    default: "#c58b4e",
    doc: "The fill colour of the rails and rungs.",
  },
} as const;

const [HALF, RAIL, RUNG] = [0.15, 0.036, 0.024];

export const ladderProp: PropDefinition<typeof ladderParams> = defineProp({
  name: "ladder",
  description:
    "A straight ladder shown rungs-on so it reads as one: two rails 0.3 apart with a rung every 0.2 from 0.2 up, standing on its ground point and centred on it, taller than a figure by default. It leans against whatever the scene puts beside its top.",
  params: ladderParams,
  draw(ctx, { height, lean, color }) {
    // A shear, not a rotation: the feet stay on the ground and the rungs level.
    ctx.transform(1, 0, Math.tan(lean), 1, 0, 0);
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.012;
    ctx.fillStyle = color;
    ctx.beginPath();
    // Counted in tenths, since summing 0.2 drifts past a top rung such as 0.6.
    for (let tenths = 2; tenths / 10 <= height - 0.08; tenths += 2) {
      ctx.rect(-HALF, tenths / 10 - RUNG / 2, HALF * 2, RUNG);
    }
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 0.015;
    ctx.beginPath();
    ctx.rect(-HALF - RAIL / 2, 0, RAIL, height);
    ctx.rect(HALF - RAIL / 2, 0, RAIL, height);
    ctx.fill();
    ctx.stroke();
  },
  sample(stage: Stage): void {
    stage.prop(ladderProp).place({ x: 0.65, y: 0 });
    stage
      .prop(ladderProp, { height: 0.8, lean: -0.3, color: "#b9c4cc" })
      .place({ x: -0.6, y: 0 });
    stage.actor().wait(1);
  },
});
