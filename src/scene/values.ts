import { type Micros, toMicros } from "../timeline/time.js";

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value` as quantised seconds, or `undefined` when it is not a time the timeline can store. */
export function microsOf(value: unknown): Micros | undefined {
  if (typeof value !== "number") {
    return undefined;
  }
  try {
    return toMicros(value);
  } catch {
    return undefined;
  }
}

/** Freezes plain objects and arrays all the way down; functions are left as they are. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const member of Object.values(value)) {
      deepFreeze(member);
    }
  }
  return value;
}
