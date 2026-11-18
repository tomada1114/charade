import {
  type ActionDefinition,
  type CycleKey,
  defineAction,
  type NoParams,
  type Stage,
} from "../../index.js";

/**
 * When the eyes close within one pass of {@link BLINK_PERIOD}: unevenly spaced, one of
 * them a double blink, so the loop does not read as a metronome.
 */
const BLINKS = [1.2, 4, 4.35, 7.6];
const BLINK_PERIOD = 10.4;

/** Added to `eyeOpen`: enough to shut the widest eye, which the drawing stops at 0. */
const SHUT = -1.5;

const blinkKeys: readonly CycleKey[] = BLINKS.flatMap((at) => [
  { at: at - 0.07, channels: { eyeOpen: 0 } },
  { at, channels: { eyeOpen: SHUT } },
  { at: at + 0.11, channels: { eyeOpen: 0 } },
]);

export const standAction: ActionDefinition<NoParams, never> = defineAction({
  name: "stand",
  description:
    "Stands at ease and stays alive: comes to an upright stance with the arms loose, then breathes, the chest rising and the head riding on it, and blinks now and then. Without a duration it goes on to the end of the scene and does not lengthen it, so start it first and time what follows with at, or give it a duration to use it as a pause. It leaves the actor where it stands. The mood dejected stands sagging, head low, and breathes slowly.",
  moods: ["dejected"],
  build(clip) {
    const low = clip.mood === "dejected";
    const period = low ? 4.6 : 3.4;
    // The lower back gives a little under a rounded upper back, as in slump, so the
    // shoulders stay over the hips.
    const [spine, chest, neck] = low ? [-0.04, 0.3, 0.42] : [0, 0, 0];
    const breath = low ? 0.6 : 1;
    const frame = (rise: number): CycleKey["channels"] => {
      const back = spine - 0.04 * rise * breath;
      const top = chest - 0.09 * rise * breath;
      return {
        spine: back,
        chest: top,
        // The head stays level while the chest tips back under it.
        neck: neck + 0.11 * rise * breath,
        // A shoulder turned by as much as the back has bent hangs its arm plumb.
        shoulderL: back + top - 0.06,
        shoulderR: back + top + 0.05,
      };
    };
    const timing = clip.duration === null ? {} : { duration: clip.duration };
    clip.cycle(
      [
        {
          at: 0,
          channels: {
            ...frame(0),
            pelvisY: 0,
            pelvis: 0,
            elbowL: low ? 0.06 : 0.14,
            elbowR: low ? 0.06 : 0.14,
            hipL: 0,
            hipR: 0,
            kneeL: 0,
            kneeR: 0,
            ankleL: 0,
            ankleR: 0,
          },
        },
        // In for a little less than out, which rests at the bottom.
        { at: period * 0.42, channels: frame(1) },
        { at: period * 0.9, channels: frame(0) },
      ],
      { at: 0, period, blend: 0.4, ...timing },
    );
    clip.cycle(blinkKeys, {
      at: 0,
      period: BLINK_PERIOD,
      mode: "add",
      blend: 0,
      ...timing,
    });
  },
  sample(stage: Stage): void {
    const actor = stage.actor();
    actor.do(standAction, { duration: 4.4 });
  },
});
