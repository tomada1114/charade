import {
  type ActionDefinition,
  type Clip,
  defineAction,
  type Point,
  type PoseChannels,
  type Stage,
} from "../../index.js";
import { rockProp } from "../props/rock.js";
import { crouch, squat } from "./pickUp.js";
import { type Gait, smoothstep, STANDING, stride, strideTime } from "./walk.js";

const pushParams = {
  prop: {
    type: "prop",
    doc: "The prop to push, such as a rock, a box or a cart: the handle row.prop returned.",
  },
  distance: {
    type: "number",
    default: 0,
    min: 0,
    max: 8,
    unit: "units",
    doc: "How far the prop goes, the way the actor faces. 0, the default, is a push that gets nowhere: the prop is not touched. By hands the actor walks that far behind it; by lever keep it small, such as 0.15.",
  },
  by: {
    type: "enum",
    values: ["hands", "lever"],
    default: "hands",
    doc: "hands leans on the prop itself and drives with the legs. lever bears down on a lever's handle end, which grip then names, while the prop shifts.",
  },
  where: {
    type: "point",
    default: { x: 0.6, y: 0 },
    doc: "Where the prop's ground point is, measured from the actor's feet: x ahead of from, y above the ground. Place the prop there.",
  },
  grip: {
    type: "point",
    default: { x: -0.22, y: 0.42 },
    doc: "Where the hands go, measured from the prop's ground point: the default is the near face of a default rock. By lever it is the lever's handle end. Keep where + grip 0.3 to 0.42 ahead of the feet and 0.3 to 0.6 up.",
  },
  press: {
    type: "point",
    default: { x: -0.07, y: -0.26 },
    doc: "By lever only: how far the hands travel as they bear down, which is how far the handle end goes; the default is a default lever (length 1.2, tilt 0.4) swung by -0.3.",
  },
  tries: {
    type: "number",
    default: 2,
    min: 1,
    max: 6,
    doc: "By hands: how many times the actor heaves, the back foot slipping after each, before the prop gives or the actor gives up.",
  },
  from: {
    type: "number",
    default: 0,
    min: -20,
    max: 20,
    unit: "units",
    doc: "The x the actor stands at when the push starts: 0 until a walk or run has moved it, then where that one ended (its from + distance). By hands the push leaves the actor distance further on.",
  },
} as const;

/** Short heavy steps behind a load: leaning in, the hips low, both feet down for long. */
const SHOVE: Gait = {
  step: 0.2,
  beat: 0.5,
  stance: 1.2,
  ahead: 0.35,
  between: -0.1,
  over: -0.08,
  lift: 0.04,
  carry: 0,
  drop: 0.5,
  heel: 0.5,
  peel: 0.5,
  strike: 0,
  hang: -0.05,
  body: { pelvis: 0.36, spine: 0.2, chest: 0.15, neck: 0.1 },
  end: {},
  // The hands are on the load: the reaches recorded after the stride say where.
  arms: { front: [1.2, 0.2], back: [1.2, 0.2] },
  settle: 0.5,
};

const SHOVE_SPENT: Gait = {
  ...SHOVE,
  beat: 0.65,
  body: { pelvis: 0.36, spine: 0.3, chest: 0.25, neck: 0.4 },
  // A shoulder turned by as much as the back has bent hangs its arm plumb.
  end: { spine: 0.2, chest: 0.15, neck: 0.35, shoulderL: 0.3, shoulderR: 0.38 },
  settle: 0.7,
};

/**
 * Keeps both hands on a point that travels from `start` to `end`: `pointAt` takes how
 * far through it is, 0 to 1. A blend is eased, so the way is cut into short reaches
 * that each arrive as the next sets off; the last stays until `until`.
 */
export function glide(
  clip: Clip,
  pointAt: (p: number) => Point,
  start: number,
  end: number,
  until: number,
): void {
  const count = Math.max(1, Math.ceil((end - start) / 0.06));
  const each = (end - start) / count;
  for (let i = 1; i <= count; i += 1) {
    const at = start + (i - 1) * each;
    const options = {
      at,
      blend: each,
      duration: i === count ? Math.max(until - at, each) : 2 * each,
    };
    clip.reach("handL", pointAt(i / count), options);
    clip.reach("handR", pointAt(i / count), options);
  }
}

const REST: PoseChannels = {
  pelvisY: 0,
  pelvis: 0,
  spine: 0,
  chest: 0,
  neck: 0,
};

export const pushAction: ActionDefinition<
  typeof pushParams,
  "contact" | "heave" | "stop"
> = defineAction({
  name: "push",
  description:
    "Pushes a prop along the ground, or fails to. Place the prop at where, in front of the actor, before the action. By hands the actor leans in with both hands on it (the mark contact) and heaves tries times, the back leg driving and slipping; then with distance 0 it gives up and straightens, and the prop, which the action never touches, stays where the scene placed it, while with a distance the prop gives and the actor walks that far behind it in short heavy steps. Either way it ends upright with the arms down. By lever the actor takes a lever's handle end, bears down on it once, crouching, and stays there holding it down while the prop shifts distance. The prop goes in a straight line at constant speed from the mark heave to the mark stop; with distance 0 those are the first heave and the end of the last. An action moves one prop and cannot set a prop's parameters, so the scene gives a moving part the same times, on a prop made after the push: a lever with swingAt: span.marks.heave and swingFor: span.marks.stop - span.marks.heave, a pushed cart with roll: distance and rollAt and rollFor likewise. For a default lever placed at x L and a prop at x R, grip is { x: L - 0.83 - R, y: 0.49 }, the actor stands 0.25 behind that handle end, and a swing of -0.3 is the default press; the lever's tip is 0.28 ahead of L. The mood dejected is slower and weaker and ends stooped.",
  params: pushParams,
  marks: ["contact", "heave", "stop"],
  moods: ["dejected"],
  build(clip, { prop, distance, by, where, grip, press, tries, from }) {
    const spent = clip.mood === "dejected";
    const slow = spent ? 1.3 : 1;
    const hand = { x: from + where.x + grip.x, y: where.y + grip.y };
    const there = { x: from + where.x + distance, y: where.y };
    const feet = [
      ["L", from + 0.05],
      ["R", from - 0.03],
    ] as const;

    if (by === "lever") {
      // Take the handle, gather, bear down, stay.
      const [take, gather, bear, stay] = [0.45, 0.3 * slow, 0.55 * slow, 0.4];
      const natural = take + gather + bear + stay;
      const k = (clip.duration ?? natural) / natural;
      const taken = take * k;
      const heave = (take + gather) * k;
      const stop = (take + gather + bear) * k;
      const end = natural * k;
      const pressed = { x: hand.x + press.x, y: hand.y + press.y };

      const high = crouch(from, hand.y - 0.14);
      // Up over the handle before the weight comes down on it.
      const risen = { ...high, pelvisY: high.pelvisY * 0.4, neck: 0.15 };
      const low = { ...crouch(from, pressed.y - 0.08), neck: spent ? 0.3 : 0 };
      clip.pose({ pelvisX: from }, { at: 0, blend: 0 });
      clip.pose(high, { at: 0, blend: taken, duration: heave });
      clip.pose(risen, { at: taken, blend: gather * k, duration: stop - taken });
      clip.pose(low, { at: heave, blend: bear * k, duration: end - heave });
      for (const [side, x] of feet) {
        const bent = squat(low.pelvisX, STANDING + low.pelvisY, x);
        clip.reach(
          `foot${side}`,
          { x, y: 0 },
          { at: 0, blend: 0.12 * k, duration: stop },
        );
        clip.reach(`foot${side}`, bent.foot, {
          at: heave,
          blend: bear * k,
          duration: end - heave,
        });
        clip.pose(
          { [`ankle${side}`]: squat(high.pelvisX, STANDING + high.pelvisY, x).ankle },
          { at: 0, blend: taken, duration: stop },
        );
        clip.pose(
          { [`ankle${side}`]: bent.ankle },
          { at: heave, blend: bear * k, duration: end - heave },
        );
      }
      glide(clip, () => hand, 0.1 * taken, taken, heave + 0.06);
      // Eased like the lever's own swing, so the hands stay on its handle end.
      glide(
        clip,
        (p) => ({
          x: hand.x + press.x * smoothstep(p),
          y: hand.y + press.y * smoothstep(p),
        }),
        heave,
        stop,
        end,
      );
      if (distance > 0) {
        prop.move(there, { at: heave, duration: stop - heave });
      }
      clip.mark("contact", taken);
      clip.mark("heave", heave);
      clip.mark("stop", stop);
      return;
    }

    const count = Math.round(tries);
    const moves = distance > 0;
    const gait = spent ? SHOVE_SPENT : SHOVE;
    // Lean in, heave so many times, then walk on behind it or straighten up.
    const [lean, period, drive, gatherUp, giveUp] = [
      0.4,
      0.9 * slow,
      0.3 * slow,
      0.3,
      0.6 * slow,
    ];
    const heaves = moves ? (count - 1) * period + drive + 0.15 : count * period;
    const walking = strideTime(gait, distance);
    const walked = moves ? gatherUp + walking : giveUp;
    const natural = lean + heaves + walked;
    const k = (clip.duration ?? natural) / natural;
    const contact = lean * k;
    const after = (lean + heaves) * k;
    const end = natural * k;

    const set = {
      pelvisX: from - 0.06,
      pelvisY: -0.12,
      pelvis: 0.35,
      spine: 0.2,
      chest: 0.15,
      neck: -0.1,
    };
    const driven = {
      pelvisX: from + 0.01,
      pelvisY: -0.1,
      pelvis: spent ? 0.38 : 0.42,
      spine: 0.22,
      chest: spent ? 0.25 : 0.15,
      neck: spent ? 0.45 : 0.3,
    };
    const front = from + 0.05;
    const [back, slipped] = [from - 0.3, from - 0.4];
    // What the body does, as [pose, start, arrival], in seconds before scaling.
    const body: [typeof set, number, number][] = [[set, 0, lean]];
    // Where the back foot goes, the same way.
    const steps: [number, number, number][] = [[back, 0, lean * 0.8]];
    for (let i = 0; i < count; i += 1) {
      const t = lean + i * period;
      body.push([driven, t, t + drive]);
      if (!moves || i < count - 1) {
        body.push([set, t + drive + 0.12 * slow, t + drive + 0.4 * slow]);
        steps.push(
          [slipped, t + drive + 0.08 * slow, t + drive + 0.26 * slow],
          [back, t + drive + 0.34 * slow, t + period],
        );
      }
    }
    clip.pose({ pelvisX: from }, { at: 0, blend: 0 });
    body.forEach(([pose, start, arrives], i) => {
      // The last lasts until the figure has gathered itself or straightened up.
      const until =
        body[i + 1]?.[2] ?? lean + heaves + (moves ? gatherUp : giveUp * 0.7);
      clip.pose(pose, {
        at: start * k,
        blend: (arrives - start) * k,
        duration: (until - start) * k,
      });
    });
    if (!moves) {
      clip.pose(
        {
          pelvisX: from,
          ...REST,
          ...(spent ? { spine: 0.2, chest: 0.15, neck: 0.35 } : {}),
        },
        { at: after, blend: giveUp * 0.7 * k, duration: end - after },
      );
    } else {
      clip.pose(
        { pelvisX: from, pelvisY: -0.04 },
        { at: after, blend: gatherUp * k, duration: gatherUp * k },
      );
    }

    // The feet, solved over the body above: the front one planted, the back one
    // driving, skidding away and stepping up again.
    const hips = (t: number): { x: number; y: number } => {
      const at = body.findLast(([, , arrives]) => arrives <= t + 1e-9);
      const pose = at?.[0] ?? { pelvisX: from, pelvisY: 0 };
      return { x: pose.pelvisX, y: STANDING + pose.pelvisY };
    };
    const stand = after + (moves ? gatherUp : giveUp * 0.7) * k;
    body.forEach(([pose, start, arrives], i) => {
      const planted = squat(pose.pelvisX, STANDING + pose.pelvisY, front);
      const until = body[i + 1]?.[2] ?? after / k;
      const options = {
        at: start * k,
        blend: (arrives - start) * k,
        duration: (Math.max(until, arrives) - start) * k,
      };
      clip.reach("footL", planted.foot, options);
      clip.pose({ ankleL: planted.ankle }, options);
    });
    steps.forEach(([x, start, arrives], i) => {
      const until = steps[i + 1]?.[2] ?? lean + heaves;
      const under = hips(arrives);
      const planted = squat(under.x, under.y, x);
      clip.reach("footR", planted.foot, {
        at: start * k,
        blend: (arrives - start) * k,
        duration: (Math.max(until, arrives) - start) * k,
      });
      clip.pose(
        { ankleR: planted.ankle },
        {
          at: start * k,
          blend: (arrives - start) * k,
          duration: (Math.max(until, arrives) - start) * k,
        },
      );
    });
    // The back foot is driven off its heel at the top of each heave.
    for (let i = 0; i < count; i += 1) {
      const t = lean + i * period;
      const off = squat(driven.pelvisX, STANDING + driven.pelvisY, back);
      const options = { at: t * k, blend: drive * k, duration: (drive + 0.1) * k };
      clip.reach("footR", off.foot, options);
      clip.pose({ ankleR: off.ankle }, options);
    }
    for (const side of ["L", "R"] as const) {
      // A walk takes the feet over from here; with none they stand to the end.
      const options = {
        at: after,
        blend: stand - after,
        duration: (moves ? stand : end) - after,
      };
      clip.reach(`foot${side}`, { x: from, y: 0 }, options);
      clip.pose({ [`ankle${side}`]: 0 }, options);
    }

    const travel = moves
      ? stride(clip, gait, from, distance, {
          at: after + gatherUp * k,
          duration: walking * k,
        })
      : undefined;
    const heave = travel?.leaves ?? (lean + drive) * k;
    const stop = travel?.arrives ?? after;

    // The hands last: on the prop from contact, with it while it goes, then down.
    glide(clip, () => hand, 0.15 * contact, contact, heave + 0.06);
    if (travel !== undefined) {
      glide(
        clip,
        (p) => ({ x: hand.x + distance * p, y: hand.y }),
        travel.leaves,
        travel.arrives,
        travel.arrives + 0.4 * k,
      );
      prop.move(there, { at: travel.leaves, duration: travel.arrives - travel.leaves });
    }
    const hang = spent ? [0.3, 0.38] : [0, 0];
    clip.pose(
      { shoulderL: hang[0] ?? 0, shoulderR: hang[1] ?? 0, elbowL: 0, elbowR: 0 },
      { at: stop, blend: Math.min(0.4 * k, end - stop), duration: end - stop },
    );
    clip.mark("contact", contact);
    clip.mark("heave", heave);
    clip.mark("stop", stop);
  },
  sample(stage: Stage): void {
    const rock = stage.prop(rockProp);
    rock.place({ x: 0.6, y: 0 });
    const actor = stage.actor();
    actor.wait(0.2);
    actor.do(pushAction, { prop: rock });
    actor.wait(0.4);
  },
});
