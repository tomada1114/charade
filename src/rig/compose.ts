import { type RandomSource, randomSource } from "../timeline/random.js";
import { type BlendMode, isMotion, type Moment } from "../timeline/segments.js";
import { MICROS_PER_SECOND } from "../timeline/time.js";
import type { Timeline, TimelineSegment, TimelineTrack } from "../timeline/timeline.js";
import { reach } from "./ik.js";
import {
  type ChannelName,
  EFFECTOR_CHAINS,
  isChannelName,
  isEffectorName,
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

/** What a segment moves: its channels, and how their values are found. */
interface Source {
  readonly evaluate: Evaluate;
  readonly names: readonly ChannelName[];
}

/** The finite numbers `values` holds for `names`; anything else moves nothing. */
function finiteValues(
  values: unknown,
  names: readonly ChannelName[],
): [ChannelName, number][] {
  if (!isRecord(values)) {
    return [];
  }
  return names.flatMap((name): [ChannelName, number][] => {
    const value = values[name];
    return typeof value === "number" && Number.isFinite(value) ? [[name, value]] : [];
  });
}

function reachOf(data: Readonly<Record<string, unknown>>): Source | undefined {
  const { effector, target } = data;
  if (!isEffectorName(effector) || !isRecord(target)) {
    return undefined;
  }
  const { x, y } = target;
  if (typeof x !== "number" || typeof y !== "number") {
    return undefined;
  }
  const names = EFFECTOR_CHAINS[effector];
  return {
    names,
    evaluate: (_at, beneath) => {
      const solved = reach(beneath, effector, { x, y });
      return names.map((name) => [name, solved[name]]);
    },
  };
}

function poseOf(data: Readonly<Record<string, unknown>>): Source | undefined {
  const { channels } = data;
  if (!isRecord(channels)) {
    return undefined;
  }
  const names = Object.keys(channels).filter(isChannelName);
  return { names, evaluate: () => finiteValues(channels, names) };
}

/**
 * A drive moves the channels recorded for it, and only those: a key its function
 * returns outside that set is ignored. A parsed timeline holds a placeholder where
 * the function was, which moves nothing.
 */
function driveOf(
  data: Readonly<Record<string, unknown>>,
  start: number,
  end: number | null,
): Source | undefined {
  const { channels, motion } = data;
  if (!Array.isArray(channels)) {
    return undefined;
  }
  const recorded: readonly unknown[] = channels;
  const names = recorded.filter(isChannelName);
  return {
    names,
    evaluate: (at, _beneath, instant) => {
      // A function that threw or named nothing at `t = 0` is not called again.
      if (!isMotion(motion) || names.length === 0) {
        return [];
      }
      const scale = instant.fps * MICROS_PER_SECOND;
      const duration = end === null ? Infinity : (end - start) / scale;
      const t = (at - start) / scale;
      const moment: Moment = {
        time: at / scale,
        duration,
        progress: end === null ? 0 : duration === 0 ? 1 : t / duration,
        random: instant.random,
      };
      return finiteValues(motion(t, moment), names);
    },
  };
}

/**
 * A cycle's value of each channel at a time: eased from the channel's key before that
 * time to its next, the last key leading back to the first one period on. A channel
 * with one key keeps that value.
 */
function cycleOf(
  data: Readonly<Record<string, unknown>>,
  start: number,
  fps: number,
): Source | undefined {
  const { keys, period } = data;
  if (!Array.isArray(keys) || typeof period !== "number" || !(period > 0)) {
    return undefined;
  }
  const recorded: readonly unknown[] = keys;
  const series = new Map<ChannelName, { at: number; value: number }[]>();
  for (const key of recorded) {
    if (!isRecord(key) || typeof key["at"] !== "number") {
      continue;
    }
    const names = isRecord(key["channels"])
      ? Object.keys(key["channels"]).filter(isChannelName)
      : [];
    for (const [name, value] of finiteValues(key["channels"], names)) {
      const points = series.get(name) ?? [];
      points.push({ at: key["at"] * fps, value });
      series.set(name, points);
    }
  }
  const length = period * fps;
  return {
    names: [...series.keys()],
    evaluate: (at) => {
      const local = (((at - start) % length) + length) % length;
      return [...series].map(([name, points]): [ChannelName, number] => {
        const after = points.findIndex((point) => point.at > local);
        const next = points.at(after === -1 ? 0 : after);
        const last = points.at(after === -1 ? -1 : after - 1);
        if (next === undefined || last === undefined || next === last) {
          return [name, next?.value ?? 0];
        }
        const from = last.at > local ? last.at - length : last.at;
        const to = next.at > local ? next.at : next.at + length;
        return [
          name,
          mix(last.value, next.value, smoothstep((local - from) / (to - from))),
        ];
      });
    },
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
  const source =
    kind === "reach"
      ? reachOf(data)
      : kind === "pose"
        ? poseOf(data)
        : kind === "drive"
          ? driveOf(data, start, end)
          : kind === "cycle"
            ? cycleOf(data, start, fps)
            : undefined;
  if (source === undefined) {
    return undefined;
  }
  const phase = (key: string): number => {
    const value = data[key];
    return typeof value === "number" ? value * fps : 0;
  };
  return {
    ...source,
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

/** How many of the ascending `sorted` are below `value`. */
function countBelow(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((sorted[middle] ?? Infinity) < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/** One channel's segments, for asking the latest end among those that start before a time. */
interface Running {
  /** The start of every segment that names the channel, ascending once all are in. */
  readonly starts: number[];
  /** A prefix-maximum tree over `starts`, holding the ends of the segments put in so far. */
  ends: number[];
}

/**
 * Per layer, the channels on which an earlier-recorded segment was still running when
 * the layer ended; `undefined` where there is none, and for a layer that is never held.
 * It is one pass in recorded order with a logarithm per channel a layer names: asking
 * each layer about every earlier one grows with the square of a walk's steps.
 */
function yieldingChannels(
  layers: readonly Layer[],
): readonly (ReadonlySet<ChannelName> | undefined)[] {
  // A hand-built time that is not a number is never compared as earlier or later; kept
  // in the tree it would unsort `starts` and turn every maximum it meets into NaN.
  const timed = layers.map(
    (layer) => !Number.isNaN(layer.start) && !Number.isNaN(layer.end ?? 0),
  );
  const channels = new Map<ChannelName, Running>();
  const named = layers.map((layer, index) =>
    layer.names.map((name): [ChannelName, Running] => {
      const running = channels.get(name) ?? { starts: [], ends: [] };
      channels.set(name, running);
      if (timed[index] === true) {
        running.starts.push(layer.start);
      }
      return [name, running];
    }),
  );
  for (const running of channels.values()) {
    running.starts.sort((a, b) => a - b);
    running.ends = running.starts.map(() => -Infinity);
  }
  return layers.map((layer, index) => {
    const { end } = layer;
    const yielding = new Set<ChannelName>();
    for (const [name, { starts, ends }] of named[index] ?? []) {
      if (end !== null && layer.mode === "replace") {
        let latest = -Infinity;
        for (let node = countBelow(starts, end); node > 0; node -= node & -node) {
          latest = Math.max(latest, ends[node - 1] ?? -Infinity);
        }
        if (latest > end) {
          yielding.add(name);
        }
      }
      if (timed[index] !== true) {
        continue;
      }
      const until = end ?? Infinity;
      for (
        let node = countBelow(starts, layer.start) + 1;
        node <= ends.length;
        node += node & -node
      ) {
        ends[node - 1] = Math.max(ends[node - 1] ?? -Infinity, until);
      }
    }
    return yielding.size === 0 ? undefined : yielding;
  });
}

/** A layer that has an end. */
interface Bounded extends Layer {
  readonly end: number;
}

/** What a track's segments give at every frame alike, at one frame rate. */
interface Layers {
  readonly fps: number;
  /** How many segments the track had; one recorded since makes this stale. */
  readonly count: number;
  /** The segments that move channels, in recorded order. */
  readonly layers: readonly Layer[];
  /** The `replace` layers that end, by end; recorded order where two end together. */
  readonly held: readonly Bounded[];
  /** Per layer, the channels it blends back out on once it has ended. */
  readonly yielding: readonly (ReadonlySet<ChannelName> | undefined)[];
}

/**
 * Keyed on the segments array, which nothing changes once a scene is built: every
 * frame of a track is composed from the same layers, and building them is most of the
 * cost of a frame of a long walk.
 */
const prepared = new WeakMap<readonly TimelineSegment[], Layers>();

function layersOf(segments: readonly TimelineSegment[], fps: number): Layers {
  const known = prepared.get(segments);
  if (known?.fps === fps && known.count === segments.length) {
    return known;
  }
  const layers = segments.flatMap((segment) => layerOf(segment, fps) ?? []);
  const made: Layers = {
    fps,
    count: segments.length,
    layers,
    held: layers
      .filter(
        (layer): layer is Bounded =>
          layer.mode === "replace" && layer.end !== null && !Number.isNaN(layer.end),
      )
      .sort((a, b) => a.end - b.end),
    yielding: yieldingChannels(layers),
  };
  prepared.set(segments, made);
  return made;
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
  return poseAtInstant(timeline, row, track, frame * MICROS_PER_SECOND);
}

/**
 * The actor's pose at `now`, in frame units (`µs × fps`, so frame `n` is `n × 1e6`):
 * what {@link poseAtFrame} composes, at a time that need not be a frame's, such as the
 * moment a held prop is let go.
 */
export function poseAtInstant(
  timeline: Timeline,
  row: number,
  track: TimelineTrack,
  now: number,
): Pose {
  const { fps } = timeline;
  const instant: Instant = {
    now,
    fps,
    random: randomSource({
      seed: timeline.seed,
      row,
      kind: track.kind,
      name: track.name,
      occurrence: track.occurrence,
    }),
  };
  const { layers, held, yielding } = layersOf(track.segments, fps);
  const pose: MutablePose = { ...REST_POSE };

  /** Per channel, the held segment whose value is the base. */
  const holder = new Map<ChannelName, Layer>();
  for (const layer of held) {
    if (layer.end > now) {
      break;
    }
    for (const [name, value] of layer.evaluate(layer.end, pose, instant)) {
      pose[name] = value;
      holder.set(name, layer);
    }
  }
  const holding = new Set(holder.values());

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
    // Whether an earlier-recorded segment was still running on a channel when this one
    // ended: decided at the end, so the fade goes on if that one ends meanwhile.
    const yields = yielding[index];
    // Most ended reaches of a walk neither yield nor hold a channel: solving one moves nothing.
    if (layer.mode === "replace" && yields === undefined && !holding.has(layer)) {
      return;
    }
    for (const [name, value] of layer.evaluate(end, pose, instant)) {
      if (layer.mode === "add") {
        pose[name] += fade * value;
      } else if (yields?.has(name) === true) {
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
