import { type RandomSource, randomSource } from "../timeline/random.js";
import type { BlendMode, Moment, MotionFunction } from "../timeline/segments.js";
import { MICROS_PER_SECOND } from "../timeline/time.js";
import type { Timeline, TimelineSegment, TimelineTrack } from "../timeline/timeline.js";
import { reach } from "./ik.js";
import {
  CHANNEL_NAMES,
  type ChannelName,
  EFFECTOR_CHAINS,
  EFFECTOR_NAMES,
  type EffectorName,
  type Pose,
  REST_POSE,
} from "./rig.js";

/** How far past its ends the arrival curve swings: a tenth of the way. */
const SWING = 0.1;

type MutablePose = Record<ChannelName, number>;

/** Gives a layer's channel values at `at` frame units, over the pose beneath it. */
type Evaluate = (
  at: number,
  beneath: Pose,
  instant: Instant,
) => [ChannelName, number][];

/** A segment that moves channels, with its times in frame units: µs × fps. */
interface Layer {
  readonly evaluate: Evaluate;
  /** The channels the segment names. */
  readonly names: readonly ChannelName[];
  /** Whether its values depend on the pose beneath it, as a reach's do. */
  readonly solved: boolean;
  readonly mode: BlendMode;
  readonly start: number;
  readonly end: number | null;
  readonly anticipation: number;
  readonly blend: number;
  readonly followThrough: number;
}

/** What one layer is evaluated with. */
interface Instant {
  /** The frame's time in frame units: `frame × 1e6`. */
  readonly now: number;
  readonly fps: number;
  readonly random: RandomSource;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isChannelName(name: string): name is ChannelName {
  return CHANNEL_NAMES.some((channel) => channel === name);
}

function isEffectorName(name: unknown): name is EffectorName {
  return EFFECTOR_NAMES.some((effector) => effector === name);
}

function isMotionFunction(value: unknown): value is MotionFunction {
  return typeof value === "function";
}

function reachOf(data: Readonly<Record<string, unknown>>): Evaluate | undefined {
  const { effector, target } = data;
  if (!isEffectorName(effector) || !isRecord(target)) {
    return undefined;
  }
  const { x, y } = target;
  if (typeof x !== "number" || typeof y !== "number") {
    return undefined;
  }
  return (_at, beneath) => {
    const solved = reach(beneath, effector, { x, y });
    return EFFECTOR_CHAINS[effector].map((name) => [name, solved[name]]);
  };
}

/**
 * The channels of a pose or a drive. A parsed timeline holds a placeholder where a
 * function was; that channel, like any value that is not a finite number, moves
 * nothing.
 */
function channelsOf(
  data: Readonly<Record<string, unknown>>,
  start: number,
  end: number | null,
): Evaluate | undefined {
  const { channels } = data;
  if (!isRecord(channels)) {
    return undefined;
  }
  return (at, _beneath, instant) => {
    const scale = instant.fps * MICROS_PER_SECOND;
    const duration = end === null ? Infinity : (end - start) / scale;
    const t = (at - start) / scale;
    const moment: Moment = {
      time: at / scale,
      duration,
      progress: end === null ? 0 : duration === 0 ? 1 : t / duration,
      random: instant.random,
    };
    const values: [ChannelName, number][] = [];
    for (const [name, entry] of Object.entries(channels)) {
      const value = isMotionFunction(entry) ? entry(t, moment) : entry;
      if (isChannelName(name) && typeof value === "number" && Number.isFinite(value)) {
        values.push([name, value]);
      }
    }
    return values;
  };
}

/**
 * The segment as a layer, or `undefined` when it moves nothing: a wait, or data this
 * version does not know.
 */
function layerOf(segment: TimelineSegment, fps: number): Layer | undefined {
  const data = segment.data;
  if (!isRecord(data)) {
    return undefined;
  }
  const start = segment.start * fps;
  const end = segment.end === null ? null : segment.end * fps;
  const kind = data["kind"];
  const evaluate =
    kind === "reach"
      ? reachOf(data)
      : kind === "pose" || kind === "drive"
        ? channelsOf(data, start, end)
        : undefined;
  if (evaluate === undefined) {
    return undefined;
  }
  const { effector, channels } = data;
  const names =
    kind === "reach" && isEffectorName(effector)
      ? EFFECTOR_CHAINS[effector]
      : Object.keys(isRecord(channels) ? channels : {}).filter(isChannelName);
  const phase = (key: string): number => {
    const value = data[key];
    return typeof value === "number" ? value * fps : 0;
  };
  return {
    evaluate,
    names,
    solved: kind === "reach",
    mode: data["mode"] === "add" ? "add" : "replace",
    start,
    end,
    anticipation: phase("anticipation"),
    blend: phase("blend"),
    followThrough: phase("followThrough"),
  };
}

function smoothstep(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

function swing(progress: number): number {
  return SWING * Math.sin(Math.PI * progress) ** 2;
}

/**
 * How much of a layer has arrived `elapsed` frame units after its start: a dip below
 * 0 during anticipation, a smooth rise to 1 over the blend, a rise above 1 and back
 * during follow-through.
 */
function arrival(layer: Layer, elapsed: number): number {
  const { anticipation, blend, followThrough } = layer;
  if (elapsed < anticipation) {
    return -swing(elapsed / anticipation);
  }
  const blending = elapsed - anticipation;
  if (blending < blend) {
    return smoothstep(blending / blend);
  }
  const settling = blending - blend;
  return settling < followThrough ? 1 + swing(settling / followThrough) : 1;
}

function mix(beneath: number, value: number, weight: number): number {
  // The endpoints exactly, as in interpolatePose.
  return weight === 1 ? value : beneath + weight * (value - beneath);
}

/**
 * The actor's pose at frame `frame`: every channel, composed from the track's
 * segments. The same frame always gives the same pose; no earlier frame is needed.
 *
 * Ended `replace` segments are held, later end over earlier, so a sequence keeps its
 * last pose. Over them the running segments apply in the order they were recorded:
 * the later one wins for the channels it names, by its arrival weight; `add` adds.
 * A segment that ends while an earlier-recorded one is still running on a channel
 * fades back to it over its own blend time; an `add` segment always fades.
 */
export function poseAtFrame(
  timeline: Timeline,
  row: number,
  track: TimelineTrack,
  frame: number,
): Pose {
  const { fps } = timeline;
  const instant: Instant = {
    now: frame * MICROS_PER_SECOND,
    fps,
    random: randomSource({
      seed: timeline.seed,
      row,
      kind: track.kind,
      name: track.name,
      occurrence: track.occurrence,
    }),
  };
  const { now } = instant;
  const layers = track.segments.flatMap((segment) => layerOf(segment, fps) ?? []);
  const pose: MutablePose = { ...REST_POSE };

  /** Per channel, the held segment whose value is the base. */
  const holder = new Map<ChannelName, Layer>();
  const held = layers
    .filter(
      (layer) => layer.mode === "replace" && layer.end !== null && layer.end <= now,
    )
    .sort((a, b) => (a.end ?? 0) - (b.end ?? 0));
  for (const layer of held) {
    for (const [name, value] of layer.evaluate(layer.end ?? now, pose, instant)) {
      pose[name] = value;
      holder.set(name, layer);
    }
  }

  /** The channels a running segment has moved so far. */
  const moved = new Set<ChannelName>();
  layers.forEach((layer, index) => {
    if (now < layer.start) {
      return;
    }
    const { end } = layer;
    if (end === null || now < end) {
      const weight = arrival(layer, now - layer.start);
      for (const [name, value] of layer.evaluate(now, pose, instant)) {
        pose[name] =
          layer.mode === "add"
            ? pose[name] + weight * value
            : mix(pose[name], value, weight);
        moved.add(name);
      }
      return;
    }
    const fade =
      now - end < layer.blend ? 1 - smoothstep((now - end) / layer.blend) : 0;
    if (fade === 0 && !layer.solved) {
      return;
    }
    // Whether an earlier-recorded segment was still running on the channel when this
    // one ended: decided at the end, so the fade goes on if that one ends meanwhile.
    const yields = (name: ChannelName): boolean =>
      layers
        .slice(0, index)
        .some(
          (lower) =>
            lower.names.includes(name) &&
            lower.start < end &&
            (lower.end === null || lower.end > end),
        );
    for (const [name, value] of layer.evaluate(end, pose, instant)) {
      if (layer.mode === "add") {
        pose[name] += fade * value;
      } else if (yields(name)) {
        pose[name] = mix(pose[name], value, fade);
      } else if (holder.get(name) === layer && !moved.has(name)) {
        // A held reach is solved again here, over the segments still running beneath
        // it, as it was while it ran; solved only in the base it would jump at its end.
        pose[name] = value;
      }
    }
  });
  return pose;
}
