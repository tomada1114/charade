import {
  type ActionDefinition,
  defineAction,
  type PoseChannels,
  type Stage,
} from "../../index.js";

const thinkParams = {
  ponder: {
    type: "number",
    default: 1.4,
    min: 0.4,
    max: 10,
    unit: "s",
    doc: "How long the thinking lasts once the hand is at the chin: the head goes down, then up to look into the air.",
  },
} as const;

export const thinkAction: ActionDefinition<typeof thinkParams, never> = defineAction({
  name: "think",
  description:
    "Thinks it over: the near hand comes up to the chin with the elbow resting on the far hand, the head tips down, then tilts up to look into the air, and the figure stays like that; a stand or another action brings it out of it. It moves only the back, neck and arms, so it works standing and also seated, after sitDown. The mood happy ends on the idea arriving: the head comes up and the near hand shoots up, finger raised, and stays there, which is where a lightbulb fits. The mood dejected gets nowhere: the far hand goes up to scratch the back of the hanging head, then drops, and the figure ends hunched.",
  params: thinkParams,
  moods: ["happy", "dejected"],
  build(clip, { ponder }) {
    const idea = clip.mood === "happy";
    const stuck = clip.mood === "dejected";
    const [settle, turn, finish] = [0.5, 0.45, idea ? 0.75 : stuck ? 0.7 : 0];
    const natural = settle + ponder + finish;
    const k = (clip.duration ?? natural) / natural;
    const first = Math.max(0.2, (ponder - turn) * 0.45);

    /**
     * A pose from `start` that takes `blend` to arrive and lasts until `until`, when the
     * next one on its channels has arrived: one that ended sooner would give way,
     * while the next blends in, to a bounded call running beneath it.
     */
    const key = (
      channels: PoseChannels,
      start: number,
      blend: number,
      until: number,
      swing: { anticipation?: number; followThrough?: number } = {},
    ): void => {
      clip.pose(channels, {
        at: start * k,
        blend: blend * k,
        anticipation: (swing.anticipation ?? 0) * k,
        followThrough: (swing.followThrough ?? 0) * k,
        duration: (Math.min(until, natural) - start) * k,
      });
    };
    const done = settle + ponder;

    if (stuck) {
      // Scratching: the forearm works back and forth behind the head.
      const strokes = Math.max(2, Math.round(ponder / 0.18));
      const stroke = ponder / strokes;
      // The far arm, so the hand goes behind the head and the face stays in view.
      key(
        {
          spine: 0.05,
          chest: 0.1,
          neck: 0.45,
          shoulderL: 3,
          elbowL: 2.3,
          shoulderR: 0.2,
          elbowR: 0.1,
        },
        0,
        settle,
        done + finish * 0.8,
      );
      for (let i = 0; i < strokes; i += 1) {
        const start = settle + i * stroke;
        key(
          { elbowL: i % 2 === 0 ? 1.9 : 2.3 },
          start,
          stroke,
          i + 1 < strokes ? start + 2 * stroke : done + finish * 0.8,
        );
      }
      key(
        {
          spine: 0.15,
          chest: 0.28,
          neck: 0.6,
          // A shoulder turned by as much as the back has bent hangs its arm plumb.
          shoulderR: 0.47,
          elbowR: 0.05,
          shoulderL: 0.38,
          elbowL: 0.05,
        },
        done,
        finish * 0.8,
        natural,
      );
      return;
    }

    const turned = settle + first + turn;
    // The hand to the chin: the upper arm out in front, the forearm folded back up,
    // and the far forearm across the body under the near elbow.
    key(
      {
        spine: 0.04,
        chest: 0.1,
        neck: 0.3,
        shoulderR: 1.18,
        shoulderL: 0.3,
        elbowL: 1.7,
        gazeY: -0.6,
      },
      0,
      settle * 0.8,
      turned,
      { followThrough: settle * 0.2 },
    );
    // The elbow folds close to its limit, so it arrives without the overshoot.
    key({ elbowR: 2.4 }, 0, settle * 0.8, idea ? done + 0.35 : natural);
    // The chin goes up and back with the head, and the hand stays under it.
    key(
      {
        spine: -0.04,
        chest: 0.02,
        neck: -0.15,
        shoulderR: 1.34,
        elbowR: 2.5,
        gazeX: 0.3,
        gazeY: 0.9,
      },
      settle + first,
      turn,
      idea ? done + 0.35 : natural,
    );
    if (idea) {
      // A small drop first, then up: the head, the chest and the finger.
      key(
        {
          spine: -0.08,
          chest: -0.1,
          neck: -0.1,
          shoulderR: 2.5,
          shoulderL: -0.25,
          elbowL: 0.5,
          gazeX: 0.2,
          gazeY: 0.5,
        },
        done,
        0.2,
        natural,
        { anticipation: 0.15, followThrough: 0.3 },
      );
      // The arm ends nearly straight, close to the elbow's limit, without the swing.
      key({ elbowR: 0.25 }, done + 0.15, 0.2, natural);
    }
  },
  sample(stage: Stage): void {
    const actor = stage.actor();
    actor.wait(0.2);
    actor.do(thinkAction);
    actor.wait(0.6);
  },
});
