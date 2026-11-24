import { type ActionDefinition, defineAction } from "../../scene/define.js";
import type { Clip, PoseChannels, Stage } from "../../scene/handles.js";

/** The rig's thigh and shin, which are the same length, and its foot. */
const LEG = 0.24;
export const FOOT = 0.08;

/** The pelvis's rest height, which `pelvisY` is counted from. */
export const STANDING: number = 2 * LEG;

/** How far a hip may be from a planted ankle: short of the whole leg, so the knee stays bent. */
const LEG_REACH = 0.477;

/** The ankle's limits, with a margin an arrival's rounding cannot cross. */
export const ANKLE = [-0.55, 0.45] as const;

/**
 * One way of going on two feet. Lengths are in units of the figure's height and times
 * in seconds; `stride` scales the times when the scene asks for a duration.
 */
export interface Gait {
  /** How far apart footfalls are; the nearest whole number of steps is taken. */
  readonly step: number;
  /** Seconds from one footfall to the next. */
  readonly beat: number;
  /** How long a foot stays down, in beats: above 1 both feet are down at once, below 1 neither is. */
  readonly stance: number;
  /** How much of the way the hips travel over a planted foot is still to come when it lands. */
  readonly ahead: number;
  /** `pelvisY` half way between two footfalls' supports: the low of a walk, the top of a run's flight. */
  readonly between: number;
  /** `pelvisY` over the middle of a planted foot. */
  readonly over: number;
  /** How high the swinging foot is carried. */
  readonly lift: number;
  /** Where the swinging foot is carried, forward of the hips. */
  readonly carry: number;
  /** How far through its swing the foot starts down to its landing. */
  readonly drop: number;
  /** How far the heel peels up before the foot leaves, in radians of the foot's pitch. */
  readonly heel: number;
  /** How much of its time on the ground the foot spends peeling up. */
  readonly peel: number;
  /** How far the toe is up as the foot lands, in radians. */
  readonly strike: number;
  /** The ankle while the foot swings; negative lets the toe hang. */
  readonly hang: number;
  /** The posture carried the whole way: the back, the neck. */
  readonly body: PoseChannels;
  /** The posture it ends in. */
  readonly end: PoseChannels;
  /** The arm that is forward and the arm that is back at a footfall: shoulder, then elbow. */
  readonly arms: {
    readonly front: readonly [number, number];
    readonly back: readonly [number, number];
  };
  /** Seconds standing after the last foot has landed. */
  readonly settle: number;
}

/** How many gaps behind its targets a ramp of four overlapped blends runs. */
const LAG = 2.33;

/** How far through its swing a lifted foot is up, clear of the ground. */
const RAISED = 0.4;

/** How far a heel has peeled half way through peeling: the leg unfolds late. */
const HALF_PEELED = 0.35;

export function smoothstep(p: number): number {
  return p * p * (3 - 2 * p);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The ankle angle that pitches a foot by `pitch` (toe up is positive) with its ankle
 * at `footX`, `footY`, the hips at `hipX`, `hipY` and the knee bent forward: the
 * shin's lean, undone.
 */
export function ankleFor(
  hipX: number,
  hipY: number,
  footX: number,
  footY: number,
  pitch: number,
): number {
  const reach = Math.min(Math.hypot(footX - hipX, hipY - footY), 2 * LEG);
  const shin = Math.atan2(footY - hipY, footX - hipX) - Math.acos(reach / (2 * LEG));
  return clamp(-Math.PI / 2 - shin + pitch, ...ANKLE);
}

/** How long `stride` takes over `distance` when no duration is asked, in seconds. */
export function strideTime(gait: Gait, distance: number): number {
  const count = Math.max(3, Math.round(distance / gait.step) + 1);
  const swing = 2 * gait.beat - gait.stance * gait.beat;
  return 0.08 + swing + (count - 1) * gait.beat + gait.settle;
}

/** When a stride's hips travel, in the clip's seconds. */
export interface Travel {
  /** When the hips, but for their eased start, leave `from`. */
  readonly leaves: number;
  /** When the hips, but for their eased stop, are `distance` further on. */
  readonly arrives: number;
  /** When the figure stands still again: the stride's end. */
  readonly end: number;
}

/**
 * Records `gait` on `clip` from standing at `from` to standing `distance` further on.
 * The hips travel at a steady speed between an eased start and stop, every planted
 * foot is held on its spot by a reach, and a swinging foot is carried over. It takes
 * the whole clip unless `within` says when it starts and how long it may last, for an
 * action that does something before or after walking.
 */
export function stride(
  clip: Clip,
  gait: Gait,
  from: number,
  distance: number,
  within?: { readonly at: number; readonly duration: number },
): Travel {
  // Footfalls: each `step` past the last, the final one closing beside the other foot.
  const count = Math.max(3, Math.round(distance / gait.step) + 1);
  const step = distance / (count - 1);
  const beat = gait.beat;
  const speed = step / beat;
  const down = gait.stance * beat;
  const swing = 2 * beat - down;
  const ahead = gait.ahead * speed * down;
  const landing = (k: number): number => 0.08 + swing + (k - 1) * beat;
  const natural = strideTime(gait, distance);
  const began = within?.at ?? 0;
  const k =
    (within === undefined ? (clip.duration ?? natural) : within.duration) / natural;
  const to = from + distance;
  const plant = (n: number): number => from + Math.min(n, count - 1) * step;

  /**
   * A pose that starts at `start`, has arrived at `at` and lasts until `until`, when the
   * next one on its channels has arrived: one that ended sooner would give way, for
   * as long as the next takes to blend in, to whatever the scene has running beneath.
   */
  const key = (
    channels: PoseChannels,
    start: number,
    at: number,
    until: number,
  ): void => {
    clip.pose(channels, {
      at: began + start * k,
      blend: (at - start) * k,
      duration: (Math.max(until, at) - start) * k,
    });
  };

  /** Where the hips are along the ground, but for the easing of the start and the stop. */
  const hipX = (t: number): number =>
    clamp(from + step - ahead + speed * (t - landing(1)), from, to);

  // A blend is eased, so a steady speed is many of them overlapped: each takes four
  // gaps to arrive and the next starts one gap later, which keeps the speed within a
  // fourteenth of steady and arrives 2.33 gaps behind. Clamping the targets eases
  // both ends.
  const gap = beat / 4;
  clip.pose({ pelvisX: from }, { at: began, blend: 0 });
  for (let j = 0; j * gap < natural; j += 1) {
    const target = hipX((j + LAG) * gap);
    if (target > from && hipX((j - 1 + LAG) * gap) < to) {
      clip.pose(
        { pelvisX: target },
        { at: began + j * gap * k, blend: 4 * gap * k, duration: 4 * gap * k },
      );
    }
  }

  // The hips' height, keyed: between two supports, over a planted foot, and so on.
  // With both feet down it is no higher than the legs can span.
  const span = Math.max(ahead, step - ahead + speed * Math.max(0, down - beat));
  const between =
    gait.stance > 1
      ? Math.min(gait.between, Math.sqrt(LEG_REACH ** 2 - span ** 2) - STANDING)
      : gait.between;
  const heights: [number, number][] = [[0, 0]];
  for (let n = 1; n < count; n += 1) {
    const middle = landing(n) + (down - beat) / 2;
    heights.push([middle, between], [middle + beat / 2, gait.over]);
  }
  heights.push([landing(count) + gait.settle * 0.5, 0]);
  heights.slice(1).forEach(([t, pelvisY], i) => {
    const [before] = heights[i] ?? [0];
    const [after] = heights[i + 2] ?? [natural];
    key({ pelvisY }, before, t, after);
  });
  const hipY = (t: number): number => {
    const next = heights.findIndex(([at]) => at > t);
    const [t1, y1] = heights.at(next === -1 ? -1 : next) ?? [0, 0];
    const [t0, y0] = heights.at(next <= 0 ? next : next - 1) ?? [0, 0];
    const p = t1 > t0 ? clamp((t - t0) / (t1 - t0), 0, 1) : 1;
    return STANDING + y0 + (y1 - y0) * smoothstep(p);
  };

  // The back and the arms. An arm is forward when the other side's foot lands.
  const last = landing(count);
  key(gait.body, 0, 0.3, last);
  for (let n = 1; n < count; n += 1) {
    const start = Math.max(0, landing(n) - beat);
    const [front, back] = n % 2 === 1 ? (["L", "R"] as const) : (["R", "L"] as const);
    key(
      {
        [`shoulder${front}`]: gait.arms.front[0],
        [`elbow${front}`]: gait.arms.front[1],
        [`shoulder${back}`]: gait.arms.back[0],
        [`elbow${back}`]: gait.arms.back[1],
      },
      start,
      landing(n),
      landing(n + 1),
    );
  }
  key(
    {
      pelvis: 0,
      spine: 0,
      chest: 0,
      neck: 0,
      shoulderL: 0,
      shoulderR: 0,
      elbowL: 0,
      elbowR: 0,
      ...gait.end,
    },
    last - beat,
    last,
    natural,
  );

  // The feet last, so they are solved over the poses above. The near foot leads.
  const heelFor = down * gait.peel;
  for (const side of ["R", "L"] as const) {
    const foot = `foot${side}` as const;
    const own = side === "R" ? 1 : 2;
    const ankles: [number, number][] = [];
    clip.reach(
      foot,
      { x: from, y: 0 },
      { at: began, blend: 0, duration: (landing(own) - swing * (1 - RAISED)) * k },
    );
    for (let n = own; n <= count; n += 2) {
      const lifts = landing(n) - swing;
      const lands = landing(n);
      // It stays planted until its next step is under way, or to the end.
      const leaves = n + 2 <= count ? landing(n + 2) - swing * (1 - RAISED) : natural;
      const stood = n > 2 ? plant(n - 2) : from;
      // The heel peels up over the toe, as far as the hips have gone on ahead.
      const gone = clamp((hipX(lifts) - stood) / (speed * down - ahead), 0, 1);
      const pitch = gait.heel * gone;
      const peel = (by: number): { readonly x: number; readonly y: number } => ({
        x: stood + FOOT * (1 - Math.cos(by)),
        y: FOOT * Math.sin(by),
      });
      const peeled = peel(pitch);
      const peels = Math.max(0, lifts - heelFor);
      if (pitch > 0 && lifts > peels) {
        clip.reach(foot, peeled, {
          at: began + peels * k,
          blend: (lifts - peels) * k,
          duration: (lifts + swing * RAISED - peels) * k,
        });
      }
      const carried = lifts + swing * 0.5;
      // Carried over in three overlapping reaches: up behind, through, and down.
      const along = (p: number): number => stood + (plant(n) - stood) * p;
      clip.reach(
        foot,
        { x: along(0.2) + gait.carry, y: gait.lift },
        { at: began + lifts * k, blend: swing * RAISED * k, duration: swing * k },
      );
      clip.reach(
        foot,
        { x: along(0.75), y: gait.lift * 0.7 },
        {
          at: began + (lifts + swing * 0.25) * k,
          blend: swing * 0.45 * k,
          duration: swing * 0.75 * k,
        },
      );
      clip.reach(
        foot,
        { x: plant(n), y: 0 },
        {
          at: began + (lifts + swing * gait.drop) * k,
          blend: swing * (1 - gait.drop) * k,
          duration: (leaves - lifts - swing * gait.drop) * k,
        },
      );

      const flat = (t: number, lean = 0): [number, number] => [
        t,
        ankleFor(hipX(t), hipY(t), plant(n), 0, lean),
      ];
      if (n <= 2) {
        // Standing until its first step, while the hips set off over it.
        const still = (t: number): [number, number] => [
          t,
          ankleFor(hipX(t), hipY(t), from, 0, 0),
        ];
        ankles.push(still(peels / 2), still(peels));
      }
      const half = (peels + lifts) / 2;
      const partly = peel(pitch * HALF_PEELED);
      ankles.push(
        [
          half,
          ankleFor(hipX(half), hipY(half), partly.x, partly.y, -pitch * HALF_PEELED),
        ],
        [lifts, ankleFor(hipX(lifts), hipY(lifts), peeled.x, peeled.y, -pitch)],
        [carried, gait.hang],
        flat(lands, gait.strike),
        flat(lands + beat * 0.15),
      );
      if (n + 2 <= count) {
        ankles.push(flat(lands + down / 2), flat(landing(n + 2) - swing - heelFor));
      } else {
        ankles.push(flat(Math.min(natural, lands + down / 2)), [natural, 0]);
      }
    }
    const rising: [number, number][] = [];
    for (const entry of ankles) {
      if (entry[0] > (rising.at(-1)?.[0] ?? 0)) {
        rising.push(entry);
      }
    }
    rising.forEach(([t, angle], i) => {
      key(
        { [`ankle${side}`]: angle },
        rising[i - 1]?.[0] ?? 0,
        t,
        rising[i + 1]?.[0] ?? natural,
      );
    });
  }
  const leaves = landing(1) - (step - ahead) / speed;
  return {
    leaves: began + leaves * k,
    arrives: began + (leaves + distance / speed) * k,
    end: began + natural * k,
  };
}

const walkParams = {
  distance: {
    type: "number",
    default: 0.9,
    min: 0.3,
    max: 8,
    unit: "units",
    doc: "How far along the ground the walk goes, the way the actor faces; about 0.3 a step. From the middle of a square one-row frame, 0.9 stays inside it.",
  },
  from: {
    type: "number",
    default: 0,
    min: -20,
    max: 20,
    unit: "units",
    doc: "The x the actor stands at when the walk starts: 0 until a walk or run has moved it, then where that one ended (its from + distance). A value off the frame's edge walks the actor in.",
  },
} as const;

const EASY: Gait = {
  step: 0.32,
  beat: 0.46,
  stance: 1.12,
  ahead: 0.5,
  between: -0.02,
  over: -0.006,
  lift: 0.1,
  carry: 0,
  drop: 0.55,
  heel: 0.35,
  peel: 0.3,
  strike: 0.22,
  hang: -0.05,
  body: { pelvis: 0.03, spine: 0.03, chest: 0.02, neck: -0.04 },
  end: {},
  arms: { front: [0.42, 0.3], back: [-0.38, 0.12] },
  settle: 0.2,
};

/** Small heavy steps: the feet barely leave the ground, the back is round, the arms hang. */
const TRUDGE: Gait = {
  ...EASY,
  step: 0.24,
  beat: 0.6,
  between: -0.03,
  over: -0.02,
  lift: 0.03,
  carry: 0.01,
  heel: 0.35,
  strike: 0.08,
  hang: -0.05,
  body: { pelvis: 0.05, spine: 0.16, chest: 0.3, neck: 0.5 },
  // A shoulder turned by as much as the back has bent hangs its arm plumb.
  end: { spine: 0.1, chest: 0.25, neck: 0.45, shoulderL: 0.3, shoulderR: 0.38 },
  arms: { front: [0.5, 0.08], back: [0.3, 0.05] },
  settle: 0.35,
};

/** A bouncing stride: long steps, the chest up, the arms swinging high. */
const BOUNCE: Gait = {
  ...EASY,
  step: 0.34,
  beat: 0.4,
  between: -0.05,
  over: 0.0,
  lift: 0.12,
  carry: 0.06,
  strike: 0.3,
  body: { pelvis: 0, spine: -0.05, chest: -0.08, neck: -0.12 },
  arms: { front: [0.85, 0.5], back: [-0.6, 0.2] },
};

export const walkAction: ActionDefinition<typeof walkParams, never> = defineAction({
  name: "walk",
  description:
    "Walks along the ground the way the actor faces and stops, standing: each foot is planted while the hips pass over it, the arms swing against the legs. It moves the actor distance on from from and leaves it there, so what follows happens where the walk ended; a second walk or a run takes that place as its from. A duration changes the pace, not the number of steps. The mood dejected trudges in small heavy steps, back round and head down; the mood happy bounces along with long steps and high-swinging arms.",
  params: walkParams,
  moods: ["dejected", "happy"],
  build(clip, { distance, from }) {
    const gait =
      clip.mood === "dejected" ? TRUDGE : clip.mood === "happy" ? BOUNCE : EASY;
    stride(clip, gait, from, distance);
  },
  sample(stage: Stage): void {
    const actor = stage.actor();
    actor.do(walkAction, { from: -0.9, distance: 1.8 });
    actor.wait(0.3);
  },
});
