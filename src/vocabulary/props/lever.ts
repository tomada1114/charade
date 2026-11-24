import { defineProp, type PropDefinition } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const leverParams = {
  length: {
    type: "number",
    default: 1.2,
    min: 0.4,
    max: 3,
    unit: "units",
    doc: "How long the beam is; three quarters of it are on the handle's side of the fulcrum.",
  },
  tilt: {
    type: "number",
    default: 0.4,
    min: -0.7,
    max: 0.7,
    unit: "rad",
    doc: "The beam's angle: 0 is level, positive raises the handle end and lowers the tip. At the default length the tip is on the ground at 0.4 and the handle end at -0.13.",
  },
  swing: {
    type: "number",
    default: 0,
    min: -1.4,
    max: 1.4,
    unit: "rad",
    doc: "How far the tilt changes while the lever is worked, added to tilt: -0.5 presses the handle down. 0 keeps the beam still.",
  },
  swingAt: {
    type: "number",
    default: 0,
    min: 0,
    unit: "s",
    doc: "The scene time the swing starts at.",
  },
  swingFor: {
    type: "number",
    default: 0.4,
    min: 0,
    unit: "s",
    doc: "How long the swing takes; the beam stays at tilt + swing afterwards.",
  },
  handle: {
    type: "enum",
    values: ["left", "right"],
    default: "left",
    doc: "The side the long handle end is on, which is the side the figure working it stands on.",
  },
  color: {
    type: "color",
    default: "#c58b4e",
    doc: "The beam's fill colour.",
  },
} as const;

/** The pivot's height: the fulcrum's apex and half the beam's thickness. */
const PIVOT = 0.14;

export const leverProp: PropDefinition<typeof leverParams> = defineProp({
  name: "lever",
  description:
    "A beam on a wedge-shaped fulcrum. The ground point is the fulcrum's foot and the beam turns about a pivot 0.14 above it; the short end, the tip, goes under a load. The moving part is the beam's angle, given as parameters since an action writes only the prop's track: tilt is where it starts, and swing, swingAt and swingFor turn it once at a scene time, eased, to stay at tilt + swing. The handle end is 0.75 × length × (cos, sin) of the angle from the pivot, away from the tip: by default 0.83 to the left of the pivot and 0.35 above it (0.49 above the ground point), for a hand to reach.",
  params: leverParams,
  draw(ctx, { length, tilt, swing, swingAt, swingFor, handle, color }, { time }) {
    const p = swingFor > 0 ? Math.min(1, Math.max(0, (time - swingAt) / swingFor)) : 1;
    const eased = time < swingAt ? 0 : p * p * (3 - 2 * p);
    if (handle === "right") {
      ctx.scale(-1, 1);
    }
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.015;
    ctx.fillStyle = "#8d8d86";
    ctx.beginPath();
    ctx.moveTo(-0.1, 0);
    ctx.lineTo(0.1, 0);
    ctx.lineTo(0, PIVOT - 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.translate(0, PIVOT);
    // Clockwise raises the left end, and a positive rotation is counter-clockwise.
    ctx.rotate(-(tilt + swing * eased));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.rect(-0.75 * length, -0.02, length, 0.04);
    ctx.fill();
    ctx.stroke();
  },
  sample(stage: Stage): void {
    stage.prop(leverProp).place({ x: 0.9, y: 0 });
    stage
      .prop(leverProp, { length: 0.8, tilt: -0.2, handle: "right", color: "#8fa3ad" })
      .place({ x: -0.8, y: 0 });
    stage.actor().wait(1);
  },
});
