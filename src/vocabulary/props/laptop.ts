import { svgPath } from "../../draw/path-data.js";
import { defineProp, type PropDefinition } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const laptopParams = {
  size: {
    type: "number",
    default: 0.3,
    min: 0.1,
    max: 1,
    unit: "units",
    doc: "How deep the laptop is from its front edge to its hinge; the lid is as long.",
  },
  open: {
    type: "number",
    default: 1.9,
    min: 0,
    max: 2.6,
    unit: "rad",
    doc: "The angle between the base and the lid: 0 is shut, 1.9 is open for use.",
  },
  faces: {
    type: "enum",
    values: ["left", "right"],
    default: "left",
    doc: "The side the screen shows to, which is the side its user sits on.",
  },
  color: {
    type: "color",
    default: "#b9c4cc",
    doc: "The fill colour of the case.",
  },
  screen: {
    type: "color",
    default: "#7fd0ff",
    doc: "The colour of the lit screen on the inside of the lid.",
  },
} as const;

// One slab on a 100 × 8 grid with rounded ends, used for the base and for the lid.
const SLAB = "M 3 0 H 97 Q 100 0 100 3 V 5 Q 100 8 97 8 H 3 Q 0 8 0 5 V 3 Q 0 0 3 0 Z";

export const laptopProp: PropDefinition<typeof laptopParams> = defineProp({
  name: "laptop",
  description:
    "An open laptop seen from the side: a flat base and a lid hinged at its far end, the lit screen on the lid's inside. It rests on its ground point, centred on it; on the desk that is y = the desk's height, a little toward the user from the desk's middle. With open at 0 it is a shut slab, which a hand can carry.",
  params: laptopParams,
  draw(ctx, { size, open, faces, color, screen }) {
    if (faces === "right") {
      ctx.scale(-1, 1);
    }
    const scale = size / 100;
    const thick = 8 * scale;
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.012;
    ctx.fillStyle = color;
    ctx.beginPath();
    svgPath(ctx, SLAB, { scale, origin: { x: 50, y: 8 } });
    ctx.fill();
    ctx.stroke();
    // The lid turns about the hinge at the base's far top corner; shut, it lies back
    // along the base, so its inside is the side that then faces down.
    ctx.translate(size / 2, thick);
    ctx.rotate(Math.PI - open);
    ctx.beginPath();
    svgPath(ctx, SLAB, { scale, origin: { x: 0, y: 0 } });
    ctx.fill();
    ctx.stroke();
    if (open > 0.3) {
      ctx.fillStyle = screen;
      ctx.beginPath();
      ctx.rect(size * 0.08, -0.004, size * 0.84, 0.012);
      ctx.fill();
    }
  },
  sample(stage: Stage): void {
    stage.prop(laptopProp).place({ x: 0.5, y: 0 });
    stage
      .prop(laptopProp, { size: 0.5, open: 1.2, faces: "right", color: "#555b61" })
      .place({ x: -0.7, y: 0 });
    stage.actor().wait(1);
  },
});
