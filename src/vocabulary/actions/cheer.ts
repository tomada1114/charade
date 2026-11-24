import {
  type ActionDefinition,
  defineAction,
  type PoseChannels,
  type Stage,
} from "../../index.js";

const cheerParams = {
  times: {
    type: "number",
    default: 2,
    min: 1,
    max: 5,
    doc: "How many times the arms are thrown up; the nearest whole number is used.",
  },
} as const;

/** The rig's thigh and shin together: the pelvis's rest height. */
const STANDING = 0.48;

/**
 * Both knees bent by `bend` with the feet flat where they stand: the thigh tips
 * forward and the shin back by as much, so the ankle stays under the hip.
 */
function crouch(bend: number): PoseChannels {
  return {
    pelvisY: -STANDING * (1 - Math.cos(bend)),
    hipL: bend,
    hipR: bend,
    kneeL: 2 * bend,
    kneeR: 2 * bend,
    ankleL: bend,
    ankleR: bend,
  };
}

export const cheerAction: ActionDefinition<typeof cheerParams, "up"> = defineAction({
  name: "cheer",
  description:
    "Cheers: dips at the knees, then throws both arms up in a V with the chest lifted and the head back, pumps them times times and lets them down, ending standing. The mark up is the first moment the arms are at the top, where a sparkle on the actor fits. It leaves the actor where it stands. The mood happy also jumps off the ground with each throw; the mood dejected is a half-hearted one: one arm half way up, no spring, and it drops.",
  params: cheerParams,
  marks: ["up"],
  moods: ["happy", "dejected"],
  build(clip, { times }) {
    const count = Math.round(times);
    const leaping = clip.mood === "happy";
    const flat = clip.mood === "dejected";
    // Dip, throw the arms up, hold; then dip and throw again for each further time.
    const [dip, rise, hold, lower] = flat
      ? [0.3, 0.5, 0.5, 0.6]
      : leaping
        ? [0.22, 0.2, 0.26, 0.4]
        : [0.2, 0.2, 0.3, 0.4];
    const beat = dip + rise + hold;
    const natural = beat * count + lower;
    const k = (clip.duration ?? natural) / natural;
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
      followThrough = 0,
    ): void => {
      clip.pose(channels, {
        at: start * k,
        blend: blend * k,
        followThrough: followThrough * k,
        duration: (Math.min(until, natural) - start) * k,
      });
    };
    clip.mark("up", (dip + rise) * k);

    for (let i = 0; i < count; i += 1) {
      const start = i * beat;
      const top = start + dip;
      const held = top + rise;
      // When the pose after this throw has arrived: the next dip, or the arms down.
      const next = start + beat + (i + 1 < count ? dip : lower);
      if (flat) {
        key(
          {
            spine: 0.12,
            chest: 0.15,
            neck: 0.3,
            shoulderR: 0.4,
            elbowR: 0.5,
            shoulderL: 0.25,
          },
          start,
          dip,
          held,
        );
        // A limp wave of one hand, no higher than the head.
        key({ shoulderR: 1.9, elbowR: 0.9, neck: 0.2 }, top, rise, next);
        key({ elbowR: 0.6 }, held, hold * 0.5, held + hold);
        key({ elbowR: 0.95 }, held + hold * 0.5, hold * 0.5, next);
        continue;
      }
      // The wind-up: knees bend and the elbows come down by the ribs.
      key(
        {
          ...crouch(leaping ? 0.5 : 0.3),
          shoulderL: i === 0 ? -0.3 : 2.2,
          shoulderR: i === 0 ? -0.5 : 1.8,
          elbowL: i === 0 ? 0.9 : 1.6,
          elbowR: i === 0 ? 1.0 : 1.7,
          spine: 0.1,
          chest: 0.08,
          neck: 0.05,
        },
        start,
        dip,
        held,
      );
      // The near arm and the back overshoot the top.
      key(
        { shoulderR: 2.3, spine: -0.05, chest: -0.08, neck: -0.12 },
        top,
        rise,
        next,
        hold * 0.5,
      );
      // The far arm goes straight up, behind the near one, so the two show as a V. It
      // is close to the shoulder's limit there, as the straight elbows are to theirs, and
      // arrives without the overshoot.
      key({ shoulderL: 3.05, elbowL: 0.12, elbowR: 0.2 }, top, rise, next);
      if (leaping) {
        // Off the ground with the toes pointed, and down again into the next dip.
        const lands = held + hold * 0.35;
        key(
          { ...crouch(0), pelvisY: 0.14, ankleL: -0.45, ankleR: -0.4 },
          top,
          lands - top,
          start + beat,
        );
        key(crouch(0.12), lands, start + beat - lands, next);
      } else {
        key(crouch(0), top, rise, next);
      }
    }
    key(
      flat
        ? {
            spine: 0.15,
            chest: 0.2,
            neck: 0.4,
            // A shoulder turned by as much as the back has bent hangs its arm plumb.
            shoulderR: 0.4,
            elbowR: 0.05,
            shoulderL: 0.32,
          }
        : {
            ...crouch(0),
            shoulderL: 0,
            shoulderR: 0,
            elbowL: 0,
            elbowR: 0,
            spine: 0,
            chest: 0,
            neck: 0,
          },
      count * beat,
      lower,
      natural,
    );
  },
  sample(stage: Stage): void {
    const actor = stage.actor();
    actor.wait(0.2);
    actor.do(cheerAction);
    actor.wait(0.4);
  },
});
