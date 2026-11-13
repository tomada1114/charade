import type { Row, Segment, Timeline, TimelineObject, Track } from "./timeline.js";
import { TimelineRangeError } from "./time.js";

export const TIMELINE_JSON_VERSION = 1;

/** What a depth 3 or 4 function is written as. Its document is marked lossy. */
export const FUNCTION_PLACEHOLDER: TimelineObject = Object.freeze({
  $omitted: "function",
});

/**
 * A serialised timeline. `lossy` is `true` when a function was replaced by
 * {@link FUNCTION_PLACEHOLDER}; a parsed document holds the placeholder as data.
 */
export interface TimelineDocument {
  readonly version: typeof TIMELINE_JSON_VERSION;
  readonly lossy: boolean;
  readonly timeline: Timeline;
}

/** The outcome of reading a serialised timeline. */
export type ParseTimelineResult =
  | { readonly ok: true; readonly document: TimelineDocument }
  | {
      readonly ok: false;
      readonly reason: "invalid-json" | "unsupported-version" | "invalid-shape";
    };

/** Serialises a timeline as a version 1 document. */
export function serializeTimeline(timeline: Timeline): string {
  return serializeDocument({ version: TIMELINE_JSON_VERSION, lossy: false, timeline });
}

/**
 * Serialises a document in canonical form: no whitespace, the envelope keys in the order
 * `version`, `lossy`, `timeline`, and every other object's keys sorted by UTF-16 code
 * unit. The document is lossy if it already was or if a function is met.
 */
export function serializeDocument(document: TimelineDocument): string {
  const state = { lossy: document.lossy };
  const timeline = write(document.timeline, state, "timeline");
  return `{"version":${String(TIMELINE_JSON_VERSION)},"lossy":${String(state.lossy)},"timeline":${timeline}}`;
}

/** Reads a serialised timeline, narrowing every field. */
export function parseTimeline(text: string): ParseTimelineResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: "invalid-shape" };
  }
  // Checked before the envelope's keys, which another version may change.
  if (parsed["version"] !== TIMELINE_JSON_VERSION) {
    return { ok: false, reason: "unsupported-version" };
  }
  if (!hasExactKeys(parsed, ["lossy", "timeline", "version"])) {
    return { ok: false, reason: "invalid-shape" };
  }
  const lossy = parsed["lossy"];
  const timeline = parsed["timeline"];
  if (typeof lossy !== "boolean" || !isTimeline(timeline)) {
    return { ok: false, reason: "invalid-shape" };
  }
  return { ok: true, document: { version: TIMELINE_JSON_VERSION, lossy, timeline } };
}

function write(value: unknown, state: { lossy: boolean }, path: string): string {
  if (typeof value === "function") {
    state.lossy = true;
    return write(FUNCTION_PLACEHOLDER, state, path);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    // Array.from visits holes as undefined, which is rejected; map would skip them and
    // join would write `[1,,2]`.
    const written = Array.from(items, (item, index) =>
      write(item, state, `${path}[${String(index)}]`),
    );
    return `[${written.join(",")}]`;
  }
  if (!isPlainObject(value)) {
    // NaN, an infinity, undefined, a bigint, a symbol, or an object such as a Map, a
    // Date or a typed array: JSON would drop or change it.
    throw new TimelineRangeError(path);
  }
  // Written by hand rather than by JSON.stringify: an engine puts integer-like keys
  // ("10", "9") first in numeric order, whatever order they were inserted in.
  const members = Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${write(value[key], state, `${path}.${key}`)}`,
    );
  return `{${members.join(",")}}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Whether a parsed value holds only finite numbers: JSON.parse reads `1e400` as Infinity. */
function isFiniteData(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.every(isFiniteData);
  }
  return isRecord(value) ? Object.values(value).every(isFiniteData) : true;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, index) => key === keys[index])
  );
}

function isMicros(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTimeline(value: unknown): value is Timeline {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["duration", "fps", "rows", "seed"]) &&
    isMicros(value["fps"]) &&
    value["fps"] > 0 &&
    Number.isSafeInteger(value["seed"]) &&
    (value["duration"] === null || isMicros(value["duration"])) &&
    Array.isArray(value["rows"]) &&
    value["rows"].every(isRow)
  );
}

function isRow(value: unknown): value is Row {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["tracks"]) &&
    Array.isArray(value["tracks"]) &&
    value["tracks"].every(isTrack)
  );
}

function isTrack(value: unknown): value is Track {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["kind", "name", "occurrence", "segments"]) &&
    typeof value["kind"] === "string" &&
    typeof value["name"] === "string" &&
    isMicros(value["occurrence"]) &&
    Array.isArray(value["segments"]) &&
    value["segments"].every(isSegment)
  );
}

function isSegment(value: unknown): value is Segment {
  // `data` came out of JSON.parse, so it is already a JSON value, though possibly
  // with an overflowed number.
  if (!isRecord(value) || !hasExactKeys(value, ["data", "end", "start"])) {
    return false;
  }
  const start = value["start"];
  const end = value["end"];
  return (
    isMicros(start) &&
    (end === null || (isMicros(end) && end >= start)) &&
    isFiniteData(value["data"])
  );
}
