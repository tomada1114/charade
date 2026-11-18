import { defineProp, type PropDefinition, type Stage } from "../../index.js";

const cartParams = {
  width: {
    type: "number",
    default: 0.8,
    min: 0.4,
    max: 2,
    unit: "units",
    doc: "How long the deck is.",
  },
  turn: {
    type: "number",
    default: 0,
    unit: "rad",
    doc: "How far the wheels have turned before any roll, positive as when rolling to the right.",
  },
  roll: {
    type: "number",
    default: 0,
    min: -20,
    max: 20,
    unit: "units",
    doc: "How far the cart travels in the move its wheels turn with, positive to the right: the x distance of the prop's move. 0 keeps the wheels still.",
  },
  rollAt: {
    type: "number",
    default: 0,
    min: 0,
    unit: "s",
    doc: "The scene time the roll starts at: the move's at.",
  },
  rollFor: {
    type: "number",
    default: 0.5,
    min: 0,
    unit: "s",
    doc: "How long the roll takes: the move's duration.",
  },
  handle: {
    type: "enum",
    values: ["left", "right"],
    default: "left",
    doc: "The side the push handle is on, which is the side the figure stands on.",
  },
  color: {
    type: "color",
    default: "#c58b4e",
    doc: "The deck's fill colour.",
  },
} as const;

const WHEEL = 0.09;
/** The deck's top: where a load's ground point goes. */
const DECK = 0.24;

export const cartProp: PropDefinition<typeof cartParams> = defineProp({
  name: "cart",
  description:
    "A flat hand cart seen from the side: a deck on two spoked wheels, a lip at the far end and a push handle rising to hand height (0.5) 0.16 beyond the near end. The ground point is under the deck's middle and the deck's top is 0.24 up: place a load at y 0.24. The moving part is the wheels' rotation, given as parameters since an action writes only the prop's track: turn is where they start, and roll, rollAt and rollFor turn them at constant speed for one move of the handle (the move's x distance, at and duration), as wheels of radius 0.09 rolling on the ground.",
  params: cartParams,
  draw(ctx, { width, turn, roll, rollAt, rollFor, handle, color }, { time }) {
    const p = rollFor > 0 ? Math.min(1, Math.max(0, (time - rollAt) / rollFor)) : 1;
    const rolled = time < rollAt ? 0 : (roll * p) / WHEEL;
    const mirror = handle === "right";
    if (mirror) {
      ctx.scale(-1, 1);
    }
    const half = width / 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // The handle, behind the deck it is fixed to.
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(-half + 0.02, DECK - 0.025);
    ctx.lineTo(-half - 0.16, 0.5);
    ctx.lineTo(-half - 0.22, 0.5);
    ctx.stroke();
    ctx.lineWidth = 0.015;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.rect(-half, DECK - 0.05, width, 0.05);
    ctx.rect(half - 0.03, DECK, 0.03, 0.07);
    ctx.fill();
    ctx.stroke();
    // Kept a wheel's radius off the middle, so a short deck's wheels do not overlap.
    const axle = Math.max(half - 0.15, WHEEL);
    for (const x of [-axle, axle]) {
      ctx.save();
      ctx.translate(x, WHEEL);
      ctx.lineWidth = 0.015;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, DECK - 0.05 - WHEEL);
      ctx.stroke();
      // Rolling to the right is clockwise; the mirror has already turned it over.
      ctx.rotate((mirror ? 1 : -1) * (turn + rolled));
      ctx.fillStyle = "#ffffff";
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.arc(0, 0, WHEEL - 0.01, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 0.008;
      ctx.beginPath();
      for (let i = 0; i < 3; i += 1) {
        const a = (i * Math.PI) / 3;
        ctx.moveTo(-Math.cos(a) * (WHEEL - 0.01), -Math.sin(a) * (WHEEL - 0.01));
        ctx.lineTo(Math.cos(a) * (WHEEL - 0.01), Math.sin(a) * (WHEEL - 0.01));
      }
      ctx.stroke();
      ctx.fillStyle = "#111111";
      ctx.beginPath();
      ctx.arc(0, 0, 0.018, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },
  sample(stage: Stage): void {
    stage.prop(cartProp).place({ x: 0.72, y: 0 });
    stage
      .prop(cartProp, { width: 0.5, turn: 0.5, handle: "right", color: "#8fa3ad" })
      .place({ x: -0.75, y: 0 });
    stage.actor().wait(1);
  },
});
