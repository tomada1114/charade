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

/**
 * A prefix-maximum tree over ascending `keys`: each value is put in at its key, and the
 * highest value among the keys below a bound is read back, either in a logarithm.
 */
interface Highest {
  /** Ascending once every key is in. */
  readonly keys: number[];
  tree: number[];
}

function seal(highest: Highest): void {
  highest.keys.sort((a, b) => a - b);
  highest.tree = highest.keys.map(() => -Infinity);
}

/** Puts `value` in at `key`, which is one of the keys. */
function raise({ keys, tree }: Highest, key: number, value: number): void {
  for (
    let node = countBelow(keys, key) + 1;
    node <= tree.length;
    node += node & -node
  ) {
    tree[node - 1] = Math.max(tree[node - 1] ?? -Infinity, value);
  }
}

/** The highest value put in at a key below `bound`. */
function highestBelow({ keys, tree }: Highest, bound: number): number {
  let highest = -Infinity;
  for (let node = countBelow(keys, bound); node > 0; node -= node & -node) {
    highest = Math.max(highest, tree[node - 1] ?? -Infinity);
  }
  return highest;
}

/**
 * Per layer, the channels on which an earlier-recorded segment was still running when
 * the layer ended; `undefined` where there is none, and for a layer that is never held.
 * Only the earlier layers `counts` accepts are counted; an open-ended `replace` layer
 * is a base and never is: nothing yields to it.
 * It is one pass in recorded order with a logarithm per channel a layer names: asking
 * each layer about every earlier one grows with the square of a walk's steps.
 */
function yieldingChannels(
  layers: readonly Layer[],
  counts: (layer: Layer) => boolean,
): readonly (ReadonlySet<ChannelName> | undefined)[] {
  // A hand-built time that is not a number is never compared as earlier or later; kept
  // in the tree it would unsort the keys and turn every maximum it meets into NaN.
  const entered = layers.map(
    (layer) =>
      !Number.isNaN(layer.start) &&
      !Number.isNaN(layer.end ?? 0) &&
      (layer.end !== null || layer.mode === "add") &&
      counts(layer),
  );
  // Per channel, the ends of the segments recorded so far, keyed by their starts.
  const channels = new Map<ChannelName, Highest>();
  const named = layers.map((layer, index) =>
    layer.names.map((name): [ChannelName, Highest] => {
      const running = channels.get(name) ?? { keys: [], tree: [] };
      channels.set(name, running);
      if (entered[index] === true) {
        running.keys.push(layer.start);
      }
      return [name, running];
    }),
  );
  for (const running of channels.values()) {
    seal(running);
  }
  return layers.map((layer, index) => {
    const { end } = layer;
    const yielding = new Set<ChannelName>();
    for (const [name, running] of named[index] ?? []) {
      if (
        end !== null &&
        layer.mode === "replace" &&
        highestBelow(running, end) > end
      ) {
        yielding.add(name);
      }
      if (entered[index] === true) {
        raise(running, layer.start, end ?? Infinity);
      }
    }
    return yielding.size === 0 ? undefined : yielding;
  });
}

/**
 * Per open-ended `replace` layer, when it loses each channel for good: the earliest
 * end, after its start, of a later-recorded bounded `replace` layer that names the
 * channel and does not yield on it to a bounded one: yielding to an open-ended `add`
 * only fades it in over the sway, which still runs on. `undefined` for a layer that
 * loses none. It is one pass in reverse recorded order, with a logarithm per channel a
 * layer names.
 */
function lostChannels(
  layers: readonly Layer[],
  yieldingToBounded: readonly (ReadonlySet<ChannelName> | undefined)[],
): readonly (ReadonlyMap<ChannelName, number> | undefined)[] {
  const takes = (layer: Layer, index: number, name: ChannelName): boolean =>
    layer.mode === "replace" &&
    layer.end !== null &&
    !Number.isNaN(layer.end) &&
    yieldingToBounded[index]?.has(name) !== true;
  // Per channel, the ends of the layers that take it, negated as key and as value: the
  // highest below a negated start is then the earliest end after that start.
  const channels = new Map<ChannelName, Highest>();
  const named = layers.map((layer, index) =>
    layer.names.map((name): [ChannelName, Highest] => {
      const ending = channels.get(name) ?? { keys: [], tree: [] };
      channels.set(name, ending);
      if (takes(layer, index, name)) {
        ending.keys.push(-(layer.end ?? 0));
      }
      return [name, ending];
    }),
  );
  for (const ending of channels.values()) {
    seal(ending);
  }
  const lost: (ReadonlyMap<ChannelName, number> | undefined)[] = layers.map(
    () => undefined,
  );
  for (const [index, layer] of [...layers.entries()].reverse()) {
    const open =
      layer.mode === "replace" && layer.end === null && !Number.isNaN(layer.start);
    const gone = new Map<ChannelName, number>();
    for (const [name, ending] of named[index] ?? []) {
      if (open) {
        const earliest = -highestBelow(ending, -layer.start);
        if (earliest !== Infinity) {
          gone.set(name, earliest);
        }
      } else if (takes(layer, index, name)) {
        raise(ending, -(layer.end ?? 0), -(layer.end ?? 0));
      }
    }
    if (gone.size > 0) {
      lost[index] = gone;
    }
  }
  return lost;
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
  /** Per open-ended `replace` layer, when it stops moving each channel it has lost. */
  readonly lost: readonly (ReadonlyMap<ChannelName, number> | undefined)[];
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
  const yielding = yieldingChannels(layers, () => true);
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
    yielding,
    lost: lostChannels(
      layers,
      yieldingChannels(layers, (layer) => layer.end !== null),
    ),
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
 * A segment that ends while an earlier-recorded bounded one is still running on a
 * channel fades back to it over its own blend time; an `add` segment always fades.
 * An open-ended `replace` segment is not faded back to: a later-recorded one that ends
 * while it runs is held over it, and it stops moving that channel from that end on.
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
  const { layers, held, yielding, lost } = layersOf(track.segments, fps);
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
      const gone = lost[index];
      for (const [name, value] of layer.evaluate(now, pose, instant)) {
        // The segment held from that end on is the base; this one no longer moves it.
        if (gone !== undefined && now >= (gone.get(name) ?? Infinity)) {
          continue;
        }
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
    // Whether an earlier-recorded bounded segment was still running on a channel when this one
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
