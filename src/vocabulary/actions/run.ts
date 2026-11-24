import { type ActionDefinition, defineAction } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";
import { type Gait, stride } from "./walk.js";

const runParams = {
  distance: {
    type: "number",
    default: 0.9,
    min: 0.5,
    max: 8,
    unit: "units",
    doc: "How far along the ground the run goes, the way the actor faces; about 0.45 a stride. From the middle of a square one-row frame, 0.9 stays inside it.",
  },
  from: {
    type: "number",
    default: 0,
    min: -20,
    max: 20,
    unit: "units",
    doc: "The x the actor stands at when the run starts: 0 until a walk or run has moved it, then where that one ended (its from + distance). A value off the frame's edge runs the actor in.",
  },
} as const;

const SPRINT: Gait = {
  step: 0.46,
  beat: 0.27,
  stance: 0.62,
  ahead: 0.3,
  between: 0.05,
  over: -0.04,
  lift: 0.24,
  carry: -0.04,
  drop: 0.7,
  heel: 0.7,
  peel: 0.55,
  strike: 0.05,
  hang: -0.35,
  body: { pelvis: 0.22, spine: 0.08, chest: 0.05, neck: -0.25 },
  end: {},
  arms: { front: [1.0, 1.7], back: [-0.9, 1.5] },
  settle: 0.25,
};

/** Fleeing: bolt upright, both arms thrown up and waving in turn. */
const PANIC: Gait = {
  ...SPRINT,
  beat: 0.23,
  step: 0.4,
  body: { pelvis: 0.06, spine: -0.08, chest: -0.1, neck: 0.05 },
  arms: { front: [2.2, 0.6], back: [2.95, 0.25] },
};

/** Worn out: a heavy jog that barely leaves the ground, bent over, arms low. */
const PLOD: Gait = {
  ...SPRINT,
  step: 0.3,
  beat: 0.36,
  stance: 0.92,
  ahead: 0.4,
  between: -0.02,
  over: -0.06,
  lift: 0.1,
  carry: 0,
  drop: 0.6,
  hang: -0.15,
  body: { pelvis: 0.18, spine: 0.2, chest: 0.28, neck: 0.3 },
  // A shoulder turned by as much as the back has bent hangs its arm plumb.
  end: { spine: 0.15, chest: 0.25, neck: 0.4, shoulderL: 0.35, shoulderR: 0.43 },
  arms: { front: [0.75, 0.7], back: [0.15, 0.5] },
  settle: 0.4,
};

export const runAction: ActionDefinition<typeof runParams, never> = defineAction({
  name: "run",
  description:
    "Runs along the ground the way the actor faces and pulls up, standing: leaning in, both feet off the ground between strides, the heels kicking up behind and the bent arms pumping. It moves the actor distance on from from and leaves it there, as walk does, at well over twice a walk's speed; speedLines on its pelvis go with it. A duration changes the pace, not the number of strides. The mood surprised flees bolt upright with both arms thrown up; the mood dejected plods, bent over and spent, barely leaving the ground.",
  params: runParams,
  moods: ["surprised", "dejected"],
  build(clip, { distance, from }) {
    const gait =
      clip.mood === "surprised" ? PANIC : clip.mood === "dejected" ? PLOD : SPRINT;
    stride(clip, gait, from, distance);
  },
  sample(stage: Stage): void {
    const actor = stage.actor();
    actor.do(runAction, { from: -0.9, distance: 1.8 });
    actor.wait(0.1);
  },
});
