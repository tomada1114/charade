import { defineEffect, type EffectDefinition, type Stage } from "../../index.js";
import { happyExpression } from "../expressions/happy.js";

const sparkleParams = {
  stars: {
    type: "number",
    default: 4,
    min: 1,
    max: 8,
    doc: "How many stars twinkle at once.",
  },
  radius: {
    type: "number",
    default: 0.24,
    min: 0.12,
    max: 0.8,
    unit: "units",
    doc: "How far from the origin the stars sit, give or take a quarter; the figure's head is 0.09 in radius, so the default rings it.",
  },
  size: {
    type: "number",
    default: 0.07,
    min: 0.02,
    max: 0.15,
    unit: "units",
    doc: "A star's reach from its centre to a point, at its brightest.",
  },
  color: {
    type: "color",
    default: "#ffd84d",
    doc: "The stars' fill colour.",
  },
} as const;

/** One twinkle, from nothing to full size and back, in seconds. */
const PERIOD = 0.8;

export const sparkleEffect: EffectDefinition<typeof sparkleParams> = defineEffect({
  name: "sparkle",
  description:
    "Four-pointed stars twinkling in a ring around its origin, for delight, pride or something that shines: each star swells and fades in place, and the next appears somewhere else on the ring, for as long as the effect is shown. The ring leaves its middle clear, so on an actor (on: actor) the stars surround the head without covering the face; on a point, such as a prop's place, they surround that. The stars are scattered from the scene's seed.",
  params: sparkleParams,
  draw(ctx, { stars, radius, size, color }, { t, random }) {
    const count = Math.round(stars);
    ctx.fillStyle = color;
    ctx.lineWidth = 0.007;
    ctx.lineJoin = "round";
    for (let i = 0; i < count; i += 1) {
      const phase = i / count;
      const cycle = Math.floor(t / PERIOD + phase);
      const p = t / PERIOD + phase - cycle;
      // A star that would have begun before the effect did is not there yet.
      if (cycle - phase < 0) {
        continue;
      }
      const draw = (cycle * count + i) * 3;
      // One star to a sector of the ring, so two never sit on each other.
      const angle = ((i + 0.15 + 0.7 * random.float(draw)) / count) * Math.PI * 2;
      const out = radius * (0.75 + 0.5 * random.float(draw + 1));
      const r = size * (0.6 + 0.4 * random.float(draw + 2)) * Math.sin(Math.PI * p);
      const [x, y] = [Math.cos(angle) * out, Math.sin(angle) * out];
      ctx.beginPath();
      ctx.moveTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.quadraticCurveTo(x, y, x, y - r);
      ctx.quadraticCurveTo(x, y, x - r, y);
      ctx.quadraticCurveTo(x, y, x, y + r);
      ctx.fill();
      ctx.stroke();
    }
  },
  sample(stage: Stage): void {
    const actor = stage.actor();
    stage.effect(sparkleEffect, { on: actor, duration: 2 });
    actor.express(happyExpression, { duration: 2 });
  },
});
