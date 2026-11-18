import { type ActionDefinition, defineAction, type Stage } from "../../index.js";
import { boxProp } from "../props/box.js";

const sitDownParams = {
  seat: {
    type: "number",
    default: 0.26,
    min: 0.2,
    max: 0.4,
    unit: "units",
    doc: "The height of the seat's top above the ground; the default is a box's height.",
  },
} as const;

/** How far behind the feet the hips come down: the middle of the seat. */
const BACK = 0.24;

/** The rig's thigh and shin, which are the same length. */
const LEG = 0.24;

/** The pelvis's rest height, which `pelvisY` is counted from. */
const STANDING = 2 * LEG;

/**
 * The ankle angle that lays a foot flat on the ground at `foot`, with the hips at
 * `hipX`, `hipY` and the knee bent forward: the shin's lean, undone.
 */
function flat(hipX: number, hipY: number, foot: number): number {
  const reach = Math.min(Math.hypot(foot - hipX, hipY), 2 * LEG);
  const shin = Math.atan2(-hipY, foot - hipX) - Math.acos(reach / (2 * LEG));
  return -Math.PI / 2 - shin;
}

const FOOT_L = -0.04;
const FOOT_R = 0.04;

export const sitDownAction: ActionDefinition<typeof sitDownParams, never> =
  defineAction({
    name: "sitDown",
    description:
      "Sits down on a seat behind the actor and stays seated: the hips go back and down while the feet stay planted, the body leans forward to balance, then settles upright with the hands on the thighs. Put a seat under it, such as a box placed 0.24 behind the actor; seat is its height. The mood dejected drops the last of the way and ends hunched, head hanging.",
    params: sitDownParams,
    moods: ["dejected"],
    build(clip, { seat }) {
      const heavy = clip.mood === "dejected";
      // Lean forward, lower the hips, settle. A dejected sit lets go and drops, then sags.
      const [lean, lower, settle] = heavy ? [0.45, 0.4, 0.75] : [0.3, 0.5, 0.35];
      const natural = lean + lower + settle;
      const k = (clip.duration ?? natural) / natural;
      const down = lean * k;
      const seated = (lean + lower) * k;

      const leanX = -0.07;
      const leanY = -0.05;
      const hips = seat + 0.015;

      clip.pose(
        {
          pelvisX: leanX,
          pelvisY: leanY,
          pelvis: 0.2,
          spine: 0.1,
          neck: heavy ? 0.3 : 0.12,
          shoulderL: 0.5,
          shoulderR: 0.4,
          elbowL: 0.3,
          elbowR: 0.3,
          ankleL: flat(leanX, STANDING + leanY, FOOT_L),
          ankleR: flat(leanX, STANDING + leanY, FOOT_R),
        },
        { at: 0, blend: down, duration: down },
      );
      clip.pose(
        {
          pelvisX: -BACK,
          pelvisY: hips - STANDING,
          pelvis: 0.3,
          spine: heavy ? 0.3 : 0.15,
          chest: heavy ? 0.2 : 0.05,
          shoulderL: 0.8,
          shoulderR: 0.7,
          elbowL: 0.4,
          elbowR: 0.4,
        },
        { at: down, blend: lower * k, duration: lower * k },
      );
      // The shins stay tipped forward until the hips are nearly down, so the ankles
      // follow them late.
      clip.pose(
        { ankleL: flat(-BACK, hips, FOOT_L), ankleR: flat(-BACK, hips, FOOT_R) },
        {
          at: down + 0.45 * lower * k,
          blend: 0.55 * lower * k,
          duration: 0.55 * lower * k,
        },
      );
      clip.pose(
        heavy
          ? {
              pelvis: 0.1,
              spine: 0.4,
              chest: 0.35,
              neck: 0.55,
              shoulderL: 0.95,
              shoulderR: 0.85,
              elbowL: 0.2,
              elbowR: 0.2,
            }
          : {
              pelvis: 0,
              spine: 0.05,
              chest: 0.05,
              neck: 0,
              shoulderL: 0.6,
              shoulderR: 0.5,
              elbowL: 0.35,
              elbowR: 0.35,
            },
        {
          at: seated,
          blend: settle * k * 0.6,
          followThrough: settle * k * 0.4,
          duration: settle * k,
        },
      );
      // Recorded last: a reach is solved over what was recorded before it, so the feet
      // stay planted while the poses above carry the hips back and down.
      const planted = { at: 0, blend: 0.1 * k, duration: natural * k };
      clip.reach("footL", { x: FOOT_L, y: 0 }, planted);
      clip.reach("footR", { x: FOOT_R, y: 0 }, planted);
    },
    sample(stage: Stage): void {
      stage.prop(boxProp).place({ x: -BACK, y: 0 });
      const actor = stage.actor();
      actor.wait(0.2);
      actor.do(sitDownAction);
      actor.wait(0.4);
    },
  });
