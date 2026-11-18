import { defineEffect, type EffectDefinition, type Stage } from "../../index.js";
import { throwAction } from "../actions/throw.js";
import { ballProp } from "../props/ball.js";

const impactParams = {
  size: {
    type: "number",
    default: 0.16,
    min: 0.06,
    max: 0.6,
    unit: "units",
    doc: "The burst's radius to the tips of its star; the figure's head is 0.09 in radius.",
  },
  spikes: {
    type: "number",
    default: 7,
    min: 5,
    max: 12,
    doc: "How many points the star has.",
  },
  color: {
    type: "color",
    default: "#ffd84d",
    doc: "The star's fill colour.",
  },
} as const;

export const impactEffect: EffectDefinition<typeof impactParams> = defineEffect({
  name: "impact",
  description:
    "The burst of a hit: a jagged star pops out at its origin with short lines flying outwards between its points, then fades. It plays once over its duration, so give it one of about 0.4 s and start it (at) on the frame of the contact; without a duration it is a still burst. Its origin is the point of contact: a point of the row (on: { x, y }), such as where a thrown ball lands, or a hand or foot of an actor (on: { actor, part: \"handR\" }) for a punch, a kick or a stamp. The star's points are uneven, scattered from the scene's seed.",
  params: impactParams,
  draw(ctx, { size, spikes, color }, { duration, progress, random }) {
    // Without a duration there is no progress: a still burst, at its fullest.
    const p = Number.isFinite(duration) ? progress : 0.35;
    const count = Math.round(spikes);
    // Out fast, a beat at full size, then gone.
    const pop = 1 - (1 - Math.min(1, p / 0.25)) ** 2;
    const fade = Math.min(1, Math.max(0, (p - 0.55) / 0.45));
    const scale = size * (0.4 + 0.6 * pop) * (1 - 0.25 * fade);
    const turn = random.float(0) * Math.PI * 2;
    const step = Math.PI / count;
    ctx.globalAlpha = 1 - fade;
    ctx.lineJoin = "miter";
    ctx.lineCap = "round";
    ctx.lineWidth = 0.012;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < count; i += 1) {
      const tip = scale * (0.75 + 0.25 * random.float(1 + i));
      const angle = turn + 2 * i * step;
      ctx.lineTo(Math.cos(angle) * tip, Math.sin(angle) * tip);
      ctx.lineTo(
        Math.cos(angle + step) * scale * 0.42,
        Math.sin(angle + step) * scale * 0.42,
      );
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // A line through each notch of the star, flying outwards and thinning.
    const flown = 1 - (1 - p) ** 2;
    ctx.lineWidth = 0.014 * (1 - 0.5 * p);
    ctx.beginPath();
    for (let i = 0; i < count; i += 1) {
      const angle = turn + (2 * i + 1) * step;
      const from = size * (0.75 + 0.7 * flown);
      const to =
        from + size * (0.25 + 0.3 * random.float(1 + count + i)) * (1 - 0.6 * p);
      ctx.moveTo(Math.cos(angle) * from, Math.sin(angle) * from);
      ctx.lineTo(Math.cos(angle) * to, Math.sin(angle) * to);
    }
    ctx.stroke();
  },
  sample(stage: Stage): void {
    const ball = stage.prop(ballProp);
    const actor = stage.actor();
    const thrown = actor.do(throwAction, { ball, bounce: false });
    // The default throw is in the air for sqrt(8 × 0.3 / 12) s and lands at (1, 0).
    stage.effect(impactEffect, {
      on: { x: 1, y: 0.06 },
      at: thrown.marks.release + Math.sqrt(0.2),
      duration: 0.4,
    });
    actor.wait(0.5);
  },
});
