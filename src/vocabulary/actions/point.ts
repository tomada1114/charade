import { type ActionDefinition, defineAction } from "../../scene/define.js";
import type { PoseChannels, Stage } from "../../scene/handles.js";

const pointParams = {
  to: {
    type: "point",
    default: { x: 1, y: 0.95 },
    doc: "What the arm points at, in row units; it has to be in front of the actor. The arm takes its direction, it does not reach it.",
  },
  from: {
    type: "number",
    default: 0,
    min: -20,
    max: 20,
    unit: "units",
    doc: "The x the actor stands at: 0 until a walk or run has moved it, then where that one ended.",
  },
  hold: {
    type: "number",
    default: 0.8,
    min: 0,
    max: 10,
    unit: "s",
    doc: "How long the arm stays out before it comes down.",
  },
} as const;

/** The pelvis's rest height, and the two segments of the back above it. */
const HIPS = 0.48;
const BACK = 0.14;

export const pointAction: ActionDefinition<typeof pointParams, "aimed"> = defineAction({
  name: "point",
  description:
    "Points at something in front with the near arm: the hand comes up by the chest, then the arm shoots out straight at to while the body leans after it and the eyes follow, holds for hold seconds, and comes down, ending standing. The mark aimed is the moment the arm is out. It leaves the actor where it stands; say where that is with from after a walk. The mood angry jabs the arm twice, leaning in with the other fist on the hip; the mood surprised leans back from what it points at, the other arm thrown out behind.",
  params: pointParams,
  marks: ["aimed"],
  moods: ["angry", "surprised"],
  build(clip, { to, from, hold }) {
    const angry = clip.mood === "angry";
    const startled = clip.mood === "surprised";
    const [raise, thrust, lower] = angry ? [0.25, 0.14, 0.4] : [0.3, 0.2, 0.4];
    const jab = angry ? 0.36 : 0;
    const natural = raise + thrust + jab + hold + lower;
    const k = (clip.duration ?? natural) / natural;

    // The back's lean decides where the shoulder is, and the arm's angle from it.
    const [pelvis, spine, chest] = startled
      ? [-0.06, -0.12, -0.1]
      : angry
        ? [0.1, 0.1, 0.06]
        : [0.03, 0.06, 0.04];
    const lower2 = pelvis + spine;
    const tilt = lower2 + chest;
    const shoulderX = from + BACK * (Math.sin(lower2) + Math.sin(tilt));
    const shoulderY = HIPS + BACK * (Math.cos(lower2) + Math.cos(tilt));
    const ahead = Math.max(to.x - shoulderX, 0.05);
    const aim = Math.atan2(to.y - shoulderY, ahead);
    // Straight down is 0 and straight ahead a quarter turn; the limit stops short of overhead.
    const shoulderR = Math.min(Math.max(aim + Math.PI / 2 + tilt, 0.3), 3);
    // The hips turn back by the pelvis's tilt, so the legs stay where they stand.
    const body = { pelvis, spine, chest, hipL: pelvis, hipR: pelvis };
    // The head turns a part of the way the arm goes, and the eyes the rest.
    const neck = -0.35 * aim - (startled ? 0.15 : 0);
    const look = { gazeX: 0.7, gazeY: Math.max(-1, Math.min(1, 1.2 * aim)) };
    const other = angry
      ? { shoulderL: -0.55, elbowL: 1.5 }
      : startled
        ? { shoulderL: -0.75, elbowL: 0.35 }
        : { shoulderL: -0.2, elbowL: 0.25 };

    /**
     * A pose from `start` that takes `blend` to arrive and lasts until `until`, when the
     * next one on its channels has arrived: one that ended sooner would give way,
     * while the next blends in, to whatever the scene has running beneath.
     */
    const key = (
      channels: PoseChannels,
      start: number,
      blend: number,
      until: number,
      followThrough = 0,
    ): void => {
      clip.pose(channels, {
        at: start * k,
        blend: blend * k,
        followThrough: followThrough * k,
        duration: (Math.min(until, natural) - start) * k,
      });
    };
    const out = raise + thrust;
    const down = out + jab + hold;

    key(
      {
        shoulderR: shoulderR - 0.9,
        elbowR: 2.2,
        spine: -0.04,
        chest: -0.05,
        neck: neck / 2,
        ...look,
      },
      0,
      raise,
      out,
    );
    key(
      { ...body, ...other, neck },
      raise,
      thrust,
      natural,
      Math.min(0.25, hold + jab),
    );
    // The elbow straightens on its limit and an arm aimed high is near the shoulder's,
    // so the arm arrives without the overshoot the body has.
    key({ shoulderR, elbowR: 0 }, raise, thrust, natural);
    clip.mark("aimed", out * k);
    if (angry) {
      // The second jab: the arm cocks back half way and stabs out again.
      const again = out + 0.1;
      key(
        {
          shoulderR: shoulderR - 0.25,
          elbowR: 1.3,
          pelvis: 0.04,
          hipL: 0.04,
          hipR: 0.04,
          spine: 0.04,
        },
        again,
        0.14,
        again + 0.24,
      );
      key(
        {
          shoulderR,
          elbowR: 0,
          pelvis,
          hipL: pelvis,
          hipR: pelvis,
          spine,
        },
        again + 0.14,
        0.1,
        natural,
      );
    }
    key(
      {
        pelvis: 0,
        hipL: 0,
        hipR: 0,
        spine: 0,
        chest: 0,
        neck: 0,
        shoulderR: 0,
        elbowR: 0,
        shoulderL: 0,
        elbowL: 0,
        gazeX: 0,
        gazeY: 0,
      },
      down,
      lower,
      natural,
    );
  },
  sample(stage: Stage): void {
    const actor = stage.actor();
    actor.wait(0.2);
    actor.do(pointAction);
    actor.wait(0.4);
  },
});
