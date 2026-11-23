import { defineEffect, type EffectDefinition, type Stage } from "../../index.js";

const speedLinesParams = {
  lines: {
    type: "number",
    default: 5,
    min: 2,
    max: 10,
    doc: "How many streaks are in the air at once.",
  },
  length: {
    type: "number",
    default: 0.5,
    min: 0.1,
    max: 2,
    unit: "units",
    doc: "How long the longest streak grows; a standing figure is 1 tall.",
  },
  spread: {
    type: "number",
    default: 0.6,
    min: 0.05,
    max: 2,
    unit: "units",
    doc: "The height of the band the streaks fill, centred on the origin.",
  },
  gap: {
    type: "number",
    default: 0.22,
    min: 0,
    max: 1,
    unit: "units",
    doc: "How far behind the origin the streaks begin, which keeps them clear of the body.",
  },
  moving: {
    type: "enum",
    values: ["right", "left"],
    default: "right",
    doc: "Which way the subject moves; the streaks trail on the other side.",
  },
  color: {
    type: "color",
    default: "#111111",
    doc: "The streaks' colour.",
  },
} as const;

/** One streak, from its start to gone, in seconds. */
const PERIOD = 0.36;

export const speedLinesEffect: EffectDefinition<typeof speedLinesParams> = defineEffect(
  {
    name: "speedLines",
    description:
      "Horizontal streaks trailing behind something that moves fast: each starts a little behind the origin, shoots backwards and is gone, and the next follows for as long as the effect is shown. Its origin is the middle of what moves, so on a running figure give on the actor's pelvis (on: { actor, part: \"pelvis\" }, with an offset upwards if a trailing leg is in the way) and on a fast arm or leg its hand or foot with a smaller spread and length; the streaks trail to the left unless moving says left, and are mirrored with a left-facing actor. The streaks are scattered from the scene's seed.",
    params: speedLinesParams,
    draw(ctx, { lines, length, spread, gap, moving, color }, { t, random }) {
      const count = Math.round(lines);
      if (moving === "left") {
        ctx.scale(-1, 1);
      }
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      for (let i = 0; i < count; i += 1) {
        // Odd steps through the lines, so neighbours do not start one after another.
        const phase = ((i * 3) % count) / count;
        const cycle = Math.floor(t / PERIOD + phase);
        const p = t / PERIOD + phase - cycle;
        // A streak that would have begun before the effect did is not there yet.
        if (cycle - phase < 0) {
          continue;
        }
        const draw = (cycle * count + i) * 3;
        // One streak to a band of the height, so two never lie on each other.
        const y = ((i + 0.15 + 0.7 * random.float(draw)) / count - 0.5) * spread;
        const reach = length * (0.5 + 0.5 * random.float(draw + 1));
        const head = -gap - reach * 0.6 * p;
        ctx.lineWidth = 0.011 + 0.007 * random.float(draw + 2);
        ctx.beginPath();
        ctx.moveTo(head, y);
        ctx.lineTo(head - reach * Math.sin(Math.PI * p), y);
        ctx.stroke();
      }
    },
    sample(stage: Stage): void {
      const actor = stage.actor();
      stage.effect(speedLinesEffect, {
        // Raised clear of the trailing foot.
        on: { actor, part: "pelvis", offset: { x: 0, y: 0.12 } },
        at: 0.3,
        duration: 1.5,
      });
      // A sprint held in mid-stride: leaning in, arms and legs opposed.
      actor.pose(
        {
          pelvis: 0.3,
          spine: 0.1,
          neck: -0.3,
          shoulderR: -0.8,
          elbowR: 1.4,
          shoulderL: 1.1,
          elbowL: 1.5,
          hipR: 1.2,
          kneeR: 1.5,
          hipL: -0.3,
          kneeL: 0.5,
          pelvisY: -0.04,
        },
        { blend: 0.3, duration: 2 },
      );
    },
  },
);
