import { type ActionDefinition, defineAction, type Stage } from "../../index.js";
import { boxProp } from "../props/box.js";
import { CARRYING, pickUpAction } from "./pickUp.js";
import { glide } from "./push.js";
import { type Gait, stride, strideTime } from "./walk.js";

const carryParams = {
  prop: {
    type: "prop",
    doc: "The prop to carry, the load: the handle row.prop returned. It is in the hands from the action's start, as pickUp leaves it.",
  },
  distance: {
    type: "number",
    default: 0.9,
    min: 0.3,
    max: 8,
    unit: "units",
    doc: "How far the actor walks with the load, the way it faces. From the middle of a square one-row frame, 0.9 stays inside it.",
  },
  by: {
    type: "enum",
    values: ["arms", "cart"],
    default: "arms",
    doc: "arms walks with the load held in front of the belly. cart first sets the load down on a cart's deck, takes the cart's handle and walks behind it; the scene moves the cart.",
  },
  grip: {
    type: "point",
    default: { x: -0.18, y: 0.08 },
    doc: "Where on the prop the hands hold it, measured from its ground point; give pickUp's grip when it follows one. The default is low on the near side of a default box.",
  },
  deck: {
    type: "point",
    default: { x: 0.72, y: 0.24 },
    doc: "By cart: where the load's ground point is set down, measured from the actor's feet: x ahead of from, y the deck's height. The default is on a default cart placed 0.87 ahead of from.",
  },
  handle: {
    type: "point",
    default: { x: 0.28, y: 0.5 },
    doc: "By cart: where the cart's push handle is, measured from the actor's feet. The default is a default cart placed 0.87 ahead of from.",
  },
  from: {
    type: "number",
    default: 0,
    min: -20,
    max: 20,
    unit: "units",
    doc: "The x the actor stands at when the carry starts: 0 until a walk or run has moved it, then where that one ended (its from + distance). The carry leaves the actor distance further on.",
  },
} as const;

const arms = [CARRYING.shoulder, CARRYING.elbow] as const;

/** A walk with the arms kept still around a load, leaning back a little against it. */
const LOADED: Gait = {
  step: 0.28,
  beat: 0.5,
  stance: 1.14,
  ahead: 0.5,
  between: -0.03,
  over: -0.012,
  lift: 0.07,
  carry: 0,
  drop: 0.55,
  heel: 0.3,
  peel: 0.3,
  strike: 0.15,
  hang: -0.05,
  body: { pelvis: 0, spine: -0.06, chest: -0.04, neck: 0 },
  end: {
    spine: -0.06,
    chest: -0.04,
    shoulderL: CARRYING.shoulder,
    shoulderR: CARRYING.shoulder,
    elbowL: CARRYING.elbow,
    elbowR: CARRYING.elbow,
  },
  arms: { front: arms, back: arms },
  settle: 0.25,
};

const LOW = [0.85, 0.2] as const;

/** Bowed under a heavy load held low: small slow steps, as pickUp's dejected end stands. */
const BURDENED: Gait = {
  ...LOADED,
  step: 0.2,
  beat: 0.62,
  between: -0.09,
  over: -0.07,
  lift: 0.03,
  strike: 0.05,
  body: { pelvis: 0.1, spine: 0.3, chest: 0.3, neck: 0.3 },
  end: {
    pelvis: 0.1,
    spine: 0.3,
    chest: 0.3,
    neck: 0.3,
    shoulderL: LOW[0],
    shoulderR: LOW[0],
    elbowL: LOW[1],
    elbowR: LOW[1],
  },
  arms: { front: LOW, back: LOW },
  settle: 0.4,
};

/** Behind a cart: leaning into the handle a little, an easy pace. */
const WHEELING: Gait = {
  ...LOADED,
  step: 0.3,
  beat: 0.46,
  between: -0.03,
  over: -0.015,
  lift: 0.08,
  body: { pelvis: 0.14, spine: 0.14, chest: 0.12, neck: -0.12 },
  // It stops still leaning on the handle its hands stay on.
  end: { pelvis: 0.1, spine: 0.14, chest: 0.12, neck: -0.1 },
  arms: { front: [0.9, 0.5], back: [0.9, 0.5] },
};

const WHEELING_SPENT: Gait = {
  ...WHEELING,
  step: 0.22,
  beat: 0.6,
  lift: 0.03,
  body: { pelvis: 0.16, spine: 0.22, chest: 0.2, neck: 0.4 },
  end: { pelvis: 0.1, spine: 0.2, chest: 0.2, neck: 0.4 },
  settle: 0.4,
};

export const carryAction: ActionDefinition<
  typeof carryParams,
  "loaded" | "off" | "stop"
> = defineAction({
  name: "carry",
  description:
    "Walks off with a prop that is in the hands, so do pickUp first: the prop rides the near hand from the action's start. By arms the actor holds it in front of the belly and walks distance, ending standing with it still held. By cart the actor first leans over a cart and lets the prop down on its deck (the mark loaded), takes the cart's push handle and walks distance behind it, ending with the hands on the handle; from the mark off to the mark stop the prop travels in a straight line at constant speed, and so must the cart. An action moves one prop and cannot set a prop's parameters, so the scene moves the cart over the same times. Make the cart after the carry: const cart = row.prop(\"cart\", { roll: distance, rollAt: span.marks.off, rollFor: span.marks.stop - span.marks.off }); cart.place({ x: from + 0.87, y: 0 }); cart.move({ x: from + 0.87 + distance, y: 0 }, { at: span.marks.off, duration: span.marks.stop - span.marks.off }). By arms loaded is the action's start, and off and stop are when the walk sets off and arrives. The mood dejected trudges bowed, the load held low, or the head down behind the cart.",
  params: carryParams,
  marks: ["loaded", "off", "stop"],
  moods: ["dejected"],
  build(clip, { prop, distance, by, grip, deck, handle, from }) {
    const heavy = clip.mood === "dejected";
    const held = { x: -grip.x, y: -grip.y };
    prop.hold("handR", { at: 0, offset: held });

    if (by === "arms") {
      const gait = heavy ? BURDENED : LOADED;
      clip.pose(
        {
          shoulderL: gait.arms.front[0],
          shoulderR: gait.arms.front[0],
          elbowL: gait.arms.front[1],
          elbowR: gait.arms.front[1],
        },
        { at: 0, blend: 0.2, duration: 0.3 },
      );
      const travel = stride(clip, gait, from, distance);
      clip.mark("loaded", 0);
      clip.mark("off", travel.leaves);
      clip.mark("stop", travel.arrives);
      return;
    }

    const gait = heavy ? WHEELING_SPENT : WHEELING;
    // Lean over the deck, let the load down, come back and take the handle, walk.
    const [over, down, take] = heavy ? [0.6, 0.3, 0.6] : [0.45, 0.2, 0.5];
    const walked = strideTime(gait, distance);
    const natural = over + down + take + walked;
    const k = (clip.duration ?? natural) / natural;
    const released = over * k;
    const loaded = (over + down) * k;
    const begins = (over + down + take) * k;

    const set = { x: from + deck.x, y: deck.y };
    const bar = { x: from + handle.x, y: handle.y };
    // As far over the deck as the arms need: the hands let go a little above it.
    const above = { x: set.x + grip.x, y: set.y + grip.y + 0.06 };
    const lean = Math.min(1, Math.max(0, (above.x - from - 0.2) / 0.4));
    clip.pose({ pelvisX: from }, { at: 0, blend: 0 });
    clip.pose(
      {
        pelvisX: from + 0.1 * lean,
        pelvisY: -0.06 * lean,
        pelvis: 0.45 * lean,
        spine: 0.3 * lean,
        chest: 0.25 * lean,
        neck: -0.2 * lean,
      },
      { at: 0, blend: released, duration: begins },
    );
    clip.pose(
      { pelvisX: from, pelvisY: 0, ...gait.body },
      { at: loaded, blend: take * k, duration: take * k },
    );
    for (const side of ["L", "R"] as const) {
      clip.reach(
        `foot${side}`,
        { x: from, y: 0 },
        { at: 0, blend: 0, duration: begins },
      );
      clip.pose(
        { [`ankle${side}`]: 0.25 * lean },
        { at: 0, blend: released, duration: begins },
      );
      clip.pose(
        { [`ankle${side}`]: 0 },
        { at: loaded, blend: take * k, duration: take * k },
      );
    }
    const travel = stride(clip, gait, from, distance, {
      at: begins,
      duration: walked * k,
    });

    // The hands, over all of the above: out over the deck with the load, back to the
    // handle, then on the handle as it goes.
    glide(clip, () => above, 0, released, loaded + 0.06);
    glide(clip, () => bar, loaded, loaded + take * 0.8 * k, travel.leaves + 0.06);
    glide(
      clip,
      (p) => ({ x: bar.x + distance * p, y: bar.y }),
      travel.leaves,
      travel.arrives,
      travel.end,
    );
    prop.move(set, { at: released, duration: loaded - released });
    prop.move(
      { x: set.x + distance, y: set.y },
      { at: travel.leaves, duration: travel.arrives - travel.leaves },
    );
    clip.mark("loaded", loaded);
    clip.mark("off", travel.leaves);
    clip.mark("stop", travel.arrives);
  },
  sample(stage: Stage): void {
    const box = stage.prop(boxProp);
    box.place({ x: -0.54, y: 0 });
    const actor = stage.actor();
    actor.pose({ pelvisX: -0.9 }, { blend: 0, duration: 0.2 });
    actor.do(pickUpAction, { prop: box, from: -0.9 });
    actor.do(carryAction, { prop: box, from: -0.9, distance: 1.5 });
    actor.wait(0.3);
  },
});
