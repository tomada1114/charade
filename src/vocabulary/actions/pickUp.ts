import { type ActionDefinition, defineAction } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";
import { boxProp } from "../props/box.js";
import { ANKLE, ankleFor, FOOT, STANDING } from "./walk.js";

const pickUpParams = {
  prop: {
    type: "prop",
    doc: "The prop to pick up, such as a box or a ball: the handle row.prop returned.",
  },
  where: {
    type: "point",
    default: { x: 0.36, y: 0 },
    doc: "Where the prop's ground point is, measured from the actor's feet: x ahead of from, y above the ground (a desk's top is its height). Place the prop there.",
  },
  grip: {
    type: "point",
    default: { x: -0.18, y: 0.08 },
    doc: "Where on the prop the hands take hold, measured from its ground point: the default is low on the near side of a default box; { x: 0, y: 0 } is underneath a ball. Keep where + grip between 0.1 and 0.4 ahead of the feet.",
  },
  from: {
    type: "number",
    default: 0,
    min: -20,
    max: 20,
    unit: "units",
    doc: "The x the actor stands at: 0 until a walk or run has moved it, then where that one ended (its from + distance).",
  },
} as const;

/** The hand height from which nothing needs bending for: about the hips'. */
const NO_BEND = 0.56;

/** The arms a prop is carried in, in front of the belly. `carry` walks in the same pose. */
export const CARRYING = { shoulder: 0.25, elbow: 1.05 } as const;

/** What `crouch` poses. */
export interface Crouch {
  readonly pelvisX: number;
  readonly pelvisY: number;
  readonly pelvis: number;
  readonly spine: number;
  readonly chest: number;
  readonly neck: number;
}

/**
 * The body bent at the knees and hips over feet at `from`, as far as hands working at
 * the height `reach` need: all the way for the ground, not at all at hip height.
 */
export function crouch(from: number, reach: number): Crouch {
  // No deeper than the hips fold: 0.9 leaves them a tenth of a radian.
  const q = Math.min(0.9, Math.max(0, 1 - reach / NO_BEND));
  return {
    pelvisX: from - 0.12 * q,
    pelvisY: -0.3 * q,
    pelvis: 0.4 * q,
    spine: 0.35 * q,
    chest: 0.3 * q,
    // The head stays up enough to look at the thing.
    neck: -0.35 * q,
  };
}

/**
 * A foot whose toe stays on the ground at `x` under hips at `hipX`, `hipY`: flat while
 * the ankle can turn that far, and up on its toe by the rest when the shin tips further.
 */
export function squat(
  hipX: number,
  hipY: number,
  x: number,
): {
  readonly foot: { readonly x: number; readonly y: number };
  readonly ankle: number;
} {
  // `ankleFor` clamps, so the flat foot's angle is read a radian down, clear of the limit.
  const flat = ankleFor(hipX, hipY, x, 0, -1) + 1;
  const heel = Math.max(0, flat - ANKLE[1]);
  const foot = { x: x + FOOT * (1 - Math.cos(heel)), y: FOOT * Math.sin(heel) };
  return { foot, ankle: ankleFor(hipX, hipY, foot.x, foot.y, -heel) };
}

export const pickUpAction: ActionDefinition<typeof pickUpParams, "grip" | "up"> =
  defineAction({
    name: "pickUp",
    description:
      "Picks a prop up off the ground, or off a surface, in front of the actor: bends at the knees and hips until the hands are on it (the mark grip), then straightens up with it and ends standing, holding it in front of the belly (the mark up). Place the prop at where, in front of the actor, before the action: it stands still until grip and rides the near hand from then on. grip is the spot on the prop the hands take, which stays on the hands. The feet stay at from. A carry or a throw of the same prop follows on from the end pose. The mood dejected heaves a heavy thing up in two goes and ends stooped, holding it low.",
    params: pickUpParams,
    marks: ["grip", "up"],
    moods: ["dejected"],
    build(clip, { prop, where, grip, from }) {
      const heavy = clip.mood === "dejected";
      // Bend down, take hold, straighten up (a heavy thing stops half way), settle.
      const [bend, take, lift, settle] = heavy
        ? [0.6, 0.3, 1.1, 0.4]
        : [0.5, 0.18, 0.55, 0.3];
      const natural = bend + take + lift + settle;
      const k = (clip.duration ?? natural) / natural;
      const gripped = (bend + take) * k;
      const lifted = (bend + take + lift) * k;
      const end = natural * k;

      const hand = { x: from + where.x + grip.x, y: where.y + grip.y };
      const down = crouch(from, hand.y);
      const stoop = heavy ? 1 : 0;
      const up = {
        // At `from`, in both moods: carry starts its walk with the hips there.
        pelvisX: from,
        pelvisY: -0.07 * stoop,
        pelvis: 0.1 * stoop,
        spine: heavy ? 0.3 : -0.06,
        chest: heavy ? 0.3 : -0.04,
        neck: heavy ? 0.3 : 0,
      };
      const arms = heavy
        ? { shoulder: 0.85, elbow: 0.2 }
        : { shoulder: CARRYING.shoulder, elbow: CARRYING.elbow };

      clip.pose({ pelvisX: from }, { at: 0, blend: 0 });
      clip.pose(down, { at: 0, blend: bend * k, anticipation: 0, duration: lifted });
      if (heavy) {
        // Half way up, a sag back down, then the rest: the weight shows as a second go.
        const half = (name: keyof typeof down, p: number): number =>
          down[name] + (up[name] - down[name]) * p;
        const part = (p: number): typeof down => ({
          pelvisX: half("pelvisX", p),
          pelvisY: half("pelvisY", p),
          pelvis: half("pelvis", p),
          spine: half("spine", p),
          chest: half("chest", p),
          neck: half("neck", p),
        });
        clip.pose(part(0.45), {
          at: gripped,
          blend: lift * 0.3 * k,
          duration: lift * 0.55 * k,
        });
        clip.pose(part(0.3), {
          at: gripped + lift * 0.3 * k,
          blend: lift * 0.25 * k,
          duration: lift * 0.7 * k,
        });
        clip.pose(up, {
          at: gripped + lift * 0.55 * k,
          blend: lift * 0.45 * k,
          duration: end - gripped - lift * 0.55 * k,
        });
      } else {
        clip.pose(up, { at: gripped, blend: lift * k, duration: end - gripped });
        // Overshoot on the back only: straight legs are on their limit.
        clip.pose(
          { spine: up.spine, chest: up.chest },
          {
            at: gripped,
            blend: lift * k,
            followThrough: settle * k,
            duration: end - gripped,
          },
        );
      }

      // The hands go down to the thing, over the body above, and stay on it while
      // they take hold; the arms then bring it up, recorded after so they win.
      for (const side of ["L", "R"] as const) {
        clip.reach(`hand${side}`, hand, {
          at: 0.1 * bend * k,
          blend: 0.9 * bend * k,
          duration: gripped - 0.1 * bend * k + lift * k,
        });
        clip.pose(
          { [`shoulder${side}`]: arms.shoulder, [`elbow${side}`]: arms.elbow },
          { at: gripped, blend: lift * k, duration: end - gripped },
        );
      }
      prop.hold("handR", { at: gripped, offset: { x: -grip.x, y: -grip.y } });
      clip.mark("grip", gripped);
      clip.mark("up", lifted);

      // The feet last, so they are solved over the poses above, and the ankles after
      // them from the same geometry.
      for (const [side, x] of [
        ["L", from + 0.05],
        ["R", from - 0.03],
      ] as const) {
        const low = squat(down.pelvisX, STANDING + down.pelvisY, x);
        clip.reach(
          `foot${side}`,
          { x, y: 0 },
          { at: 0, blend: 0.12 * k, duration: end },
        );
        clip.reach(`foot${side}`, low.foot, {
          at: 0.3 * bend * k,
          blend: 0.7 * bend * k,
          duration: gripped - 0.3 * bend * k + 0.6 * lift * k,
        });
        clip.reach(
          `foot${side}`,
          { x, y: 0 },
          { at: gripped, blend: 0.6 * lift * k, duration: end - gripped },
        );
        clip.pose(
          { [`ankle${side}`]: low.ankle },
          { at: 0, blend: bend * k, duration: lifted },
        );
        clip.pose(
          {
            [`ankle${side}`]: ankleFor(up.pelvisX, STANDING + up.pelvisY, x, 0, 0),
          },
          { at: gripped, blend: lift * k, duration: end - gripped },
        );
      }
    },
    sample(stage: Stage): void {
      const box = stage.prop(boxProp);
      box.place({ x: 0.36, y: 0 });
      const actor = stage.actor();
      actor.wait(0.2);
      actor.do(pickUpAction, { prop: box });
      actor.wait(0.4);
    },
  });
