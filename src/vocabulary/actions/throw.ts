import { type ActionDefinition, defineAction } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";
import { ballProp } from "../props/ball.js";

const throwParams = {
  ball: {
    type: "prop",
    doc: "The prop to throw, such as a ball: the handle row.prop returned.",
  },
  to: {
    type: "point",
    default: { x: 1, y: 0 },
    doc: "Where the ball comes down: a point of the row, not counted from from, so after a walk it names a spot ahead of where the walk ended.",
  },
  loft: {
    type: "number",
    default: 0.3,
    min: 0.05,
    max: 1.5,
    unit: "units",
    doc: "How high the ball's path arcs above the straight line to its landing; a higher arc also takes longer.",
  },
  bounce: {
    type: "boolean",
    default: true,
    doc: "Whether the ball hops once more, 0.12 further on, after it comes down; turn it off when something catches it.",
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

/**
 * What a thrown thing falls by, in row units per second squared: about twice what a
 * figure 1 unit tall would see, so a short throw is quick enough to read as thrown.
 */
const GRAVITY = 12;

/** How long a parabola that rises `arc` above its chord is in the air. */
function airTime(arc: number): number {
  return Math.sqrt((8 * arc) / GRAVITY);
}

export const throwAction: ActionDefinition<typeof throwParams, "release"> =
  defineAction({
    name: "throw",
    description:
      "Throws a prop overhand with the near hand: winds up leaning back with the far arm out in front, steps onto the far foot and whips the arm through, then recovers to standing. The prop rides the near hand from the action's start until the mark release, then flies a parabola to to, a point of the row. The feet stay at from, which says where the actor stands after a walk. The mood focused takes aim for longer before the throw; the mood dejected is a weak toss that falls short.",
    params: throwParams,
    marks: ["release"],
    moods: ["focused", "dejected"],
    build(clip, { ball, to, loft, bounce, from }) {
      const focused = clip.mood === "focused";
      const weak = clip.mood === "dejected";
      // Wind up (and aim), whip the arm through, hold the follow-through, recover.
      const [windUp, whip, hold, recover] = weak
        ? [0.5, 0.3, 0.2, 0.5]
        : [focused ? 0.8 : 0.45, 0.26, 0.2, 0.45];
      const natural = windUp + whip + hold + recover;
      const k = (clip.duration ?? natural) / natural;
      const thrown = windUp * k;
      const back = (windUp + whip + hold) * k;
      const s = weak ? 0.5 : 1;

      // Lowered into the palm, so a ball sits in the hand rather than on top of it.
      ball.hold("handR", { at: 0, offset: { x: 0, y: -0.05 } });
      // At `from` at once, as a walk leaves it, so the hips do not slide in over the feet.
      clip.pose({ pelvisX: from }, { at: 0, blend: 0 });
      clip.pose(
        {
          pelvisX: from - 0.06 * s,
          pelvis: -0.15 * s,
          spine: -0.15 * s,
          chest: -0.2 * s,
          // The head stays upright while the chest leans back, clear of the raised arm.
          neck: weak ? 0.35 : 0.6,
          shoulderR: weak ? 2.3 : 3.0,
          elbowR: weak ? 1.2 : 1.4,
          shoulderL: weak ? 0.3 : 1.35,
          elbowL: 0.25,
          ankleR: -0.12 * s,
        },
        { at: 0, blend: (focused ? 0.45 : windUp) * k, duration: thrown },
      );
      clip.pose(
        {
          pelvisX: from + 0.12 * s,
          pelvisY: -0.03 * s,
          pelvis: 0.2 * s,
          spine: 0.2 * s,
          chest: 0.2 * s,
          neck: weak ? 0.2 : -0.2,
          shoulderR: 1.2,
          elbowR: 0.3,
          shoulderL: -0.5 * s,
          elbowL: 0.4,
          ankleL: 0.1 * s,
          ankleR: 0.2 * s,
        },
        {
          at: thrown,
          blend: whip * k,
          followThrough: hold * k,
          duration: (whip + hold) * k,
        },
      );
      clip.pose(
        {
          pelvisX: from,
          pelvisY: 0,
          pelvis: 0,
          spine: weak ? 0.2 : 0,
          chest: weak ? 0.15 : 0,
          neck: weak ? 0.35 : 0,
          // A shoulder turned by as much as the back has bent hangs its arm plumb.
          shoulderR: weak ? 0.38 : 0,
          elbowR: 0,
          shoulderL: weak ? 0.3 : 0,
          elbowL: 0,
          ankleL: 0,
          ankleR: 0,
        },
        { at: back, blend: recover * k, duration: recover * k },
      );
      // The feet last, so they are solved over the poses above: the near foot stays
      // where it stands, the far foot lifts, steps out and comes back.
      const step = 0.22 * s;
      clip.reach(
        "footR",
        { x: from, y: 0 },
        { at: 0, blend: 0.1 * k, duration: thrown },
      );
      // The near heel comes up as the weight goes onto the far foot.
      clip.reach(
        "footR",
        { x: from, y: 0.05 * s },
        { at: thrown, blend: whip * k, duration: back - thrown },
      );
      clip.reach(
        "footL",
        { x: from + 0.06 * s, y: 0.1 * s },
        { at: 0, blend: thrown, duration: thrown },
      );
      clip.reach(
        "footL",
        { x: from + step, y: 0 },
        { at: thrown, blend: whip * k * 0.7, duration: back - thrown },
      );
      clip.reach(
        "footL",
        { x: from, y: 0 },
        { at: back, blend: recover * k, duration: recover * k },
      );
      clip.reach(
        "footR",
        { x: from, y: 0 },
        { at: back, blend: recover * k, duration: recover * k },
      );

      // Let go as the hand comes over the top, while it still travels forward.
      const release = thrown + whip * k * 0.65;
      clip.mark("release", release);
      const arc = weak ? loft * 0.6 : loft;
      const landing = weak ? { x: from + (to.x - from) * 0.55, y: to.y } : to;
      const flight = airTime(arc);
      ball.move(landing, { at: release, duration: flight, arc });
      if (bounce) {
        ball.move(
          // On the way it was thrown, which is backwards when to is behind from.
          { x: landing.x + (landing.x < from ? -0.12 : 0.12), y: landing.y },
          { at: release + flight, duration: airTime(0.06), arc: 0.06 },
        );
      }
    },
    sample(stage: Stage): void {
      const ball = stage.prop(ballProp);
      const actor = stage.actor();
      actor.do(throwAction, { ball });
      actor.wait(0.5);
    },
  });
