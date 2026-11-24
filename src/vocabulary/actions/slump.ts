import { type ActionDefinition, defineAction } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const slumpParams = {
  depth: {
    type: "number",
    default: 0.8,
    min: 0.2,
    max: 1,
    doc: "How far the body gives way: 0.2 is a small sag of the shoulders, 1 folds the back as far as it goes.",
  },
} as const;

export const slumpAction: ActionDefinition<typeof slumpParams, never> = defineAction({
  name: "slump",
  description:
    "Gives up: a small breath in, then the back rounds, the head drops after it and the arms hang loose. It moves only the back, neck and arms, so it works standing and also seated, after sitDown, where it leaves the legs as they are. The mood dejected sinks further and more slowly.",
  params: slumpParams,
  moods: ["dejected"],
  build(clip, { depth }) {
    const heavy = clip.mood === "dejected";
    const d = heavy ? Math.min(1, depth + 0.2) : depth;
    const [breath, fall, settle] = heavy ? [0.35, 0.6, 0.45] : [0.25, 0.4, 0.3];
    const natural = breath + fall + settle;
    const k = (clip.duration ?? natural) / natural;
    // The lower back gives way backward under a rounded upper back, so the shoulders
    // stay over the hips; a back that only bends forward reads as a bow.
    const spine = -0.12 * d;
    const chest = 0.6 * d;

    clip.pose(
      { spine: -0.06, chest: -0.1, neck: -0.12, shoulderL: -0.05, shoulderR: -0.05 },
      { at: 0, blend: breath * k, duration: breath * k },
    );
    clip.pose(
      {
        spine,
        chest,
        // A shoulder turned by as much as the back has bent hangs its arm plumb.
        shoulderL: spine + chest - 0.08,
        shoulderR: spine + chest + 0.04,
        elbowL: 0.12,
        elbowR: 0.08,
      },
      {
        at: breath * k,
        blend: fall * k,
        followThrough: settle * k,
        duration: (fall + settle) * k,
      },
    );
    // The head goes last, a beat behind the back that carries it.
    clip.pose(
      { neck: 0.78 * d },
      {
        at: (breath + 0.12) * k,
        blend: fall * k,
        followThrough: (settle - 0.12) * k,
        duration: (fall + settle - 0.12) * k,
      },
    );
  },
  sample(stage: Stage): void {
    const actor = stage.actor();
    actor.wait(0.2);
    actor.do(slumpAction);
    actor.wait(0.4);
  },
});
