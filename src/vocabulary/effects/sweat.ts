import { defineEffect, type EffectDefinition, type Stage } from "../../index.js";
import { slumpAction } from "../actions/slump.js";
import { dejectedExpression } from "../expressions/dejected.js";

const sweatParams = {
  drops: {
    type: "number",
    default: 3,
    min: 1,
    max: 6,
    doc: "How many droplets are in the air at once.",
  },
  size: {
    type: "number",
    default: 0.07,
    min: 0.02,
    max: 0.12,
    unit: "units",
    doc: "A droplet's length; the figure's head is 0.18 across.",
  },
  side: {
    type: "enum",
    values: ["back", "front", "both"],
    default: "back",
    doc: "Which side of the head the droplets leave from: behind it, in front of the face, or both.",
  },
  color: {
    type: "color",
    default: "#8fd0f5",
    doc: "The droplets' fill colour.",
  },
} as const;

/** A droplet's flight from the head, in seconds. */
const PERIOD = 0.6;

export const sweatEffect: EffectDefinition<typeof sweatParams> = defineEffect({
  name: "sweat",
  description:
    "Droplets flying off a head, for a figure that is nervous, flustered or worn out: each leaves the edge of the head upwards and outwards, falls a little and is gone, and the next follows for as long as the effect is shown. Its origin is the centre of the head, so put it on an actor (on: actor), where it follows the head through whatever the figure does, or give on a point 0.9 above the ground for a standing figure. The droplets are scattered from the scene's seed.",
  params: sweatParams,
  draw(ctx, { drops, size, side, color }, { time, duration, progress, random }) {
    // An open-ended effect has no progress, so it runs on scene time.
    const t = Number.isFinite(duration) ? progress * duration : time;
    const count = Math.round(drops);
    ctx.fillStyle = color;
    ctx.lineWidth = 0.008;
    ctx.lineJoin = "round";
    for (let i = 0; i < count; i += 1) {
      const phase = i / count;
      const cycle = Math.floor(t / PERIOD + phase);
      const p = t / PERIOD + phase - cycle;
      // A droplet that would have left before the effect began is not there yet.
      if (cycle - phase < 0) {
        continue;
      }
      const draw = (cycle * count + i) * 3;
      const front = side === "front" || (side === "both" && (cycle + i) % 2 === 1);
      // One droplet to a slice of the fan, so two never fly on each other.
      const lean = 0.1 + (1.05 * (i + 0.15 + 0.7 * random.float(draw))) / count;
      const angle = Math.PI / 2 + (front ? -lean : lean);
      const travel = 0.09 + 0.06 * random.float(draw + 1);
      const out = 0.115 + travel * (1 - (1 - p) ** 2);
      const fall = 0.07;
      const x = Math.cos(angle) * out;
      const y = Math.sin(angle) * out - fall * p * p;
      const speed = travel * 2 * (1 - p);
      const heading = Math.atan2(
        Math.sin(angle) * speed - 2 * fall * p,
        Math.cos(angle) * speed,
      );
      const length =
        size *
        (0.8 + 0.4 * random.float(draw + 2)) *
        Math.min(1, p / 0.15, (1 - p) / 0.3);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(heading);
      // A teardrop flying round end first, its tail towards the head.
      ctx.beginPath();
      ctx.moveTo(-0.6 * length, 0);
      ctx.arc(0.12 * length, 0, 0.28 * length, 2.1, -2.1, true);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  },
  sample(stage: Stage): void {
    const actor = stage.actor();
    stage.effect(sweatEffect, { on: actor, duration: 2.2 });
    actor.wait(0.2);
    actor.do(slumpAction, { mood: dejectedExpression });
    actor.wait(0.6);
  },
});
