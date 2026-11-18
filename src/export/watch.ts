import type { GlobalRead, ReadWatch } from "../check/reads.js";

/** The reads of each watch now running, innermost last. */
const running: Set<GlobalRead>[] = [];

function note(read: GlobalRead): void {
  running.at(-1)?.add(read);
}

/** Puts `value` at `object[key]` and returns what puts the original back. */
function replace(object: object, key: string, value: unknown): () => void {
  const own = Object.getOwnPropertyDescriptor(object, key);
  Object.defineProperty(object, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: own?.enumerable ?? false,
  });
  return () => {
    if (own === undefined) {
      // `performance.now` is inherited, so the replacement was the only own property.
      Reflect.deleteProperty(object, key);
    } else {
      Object.defineProperty(object, key, own);
    }
  };
}

/**
 * Replaces `Date`, `performance.now` and `Math.random` with versions that note the
 * read and then answer as the real ones do, so the scene still runs and one check
 * reports every read. Only a read of the current time counts: `new Date(2020, 0, 1)`
 * and `Date.UTC` are not one.
 */
function replaceAll(): () => void {
  const RealDate = Date;
  const realRandom = Math.random;
  const realNow = performance.now.bind(performance);
  const watchedNow = (): number => {
    note("Date");
    return RealDate.now();
  };
  const watchedDate = new Proxy(RealDate, {
    construct(target, args: unknown[], newTarget): object {
      if (args.length === 0) {
        note("Date");
      }
      return Reflect.construct(target, args, newTarget) as object;
    },
    apply(target, thisArg, args: unknown[]): unknown {
      note("Date");
      return Reflect.apply(target, thisArg, args);
    },
    get(target, key, receiver): unknown {
      if (key === "now") {
        return watchedNow;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const restores = [
    replace(globalThis, "Date", watchedDate),
    replace(performance, "now", (): number => {
      note("performance.now");
      return realNow();
    }),
    replace(Math, "random", (): number => {
      note("Math.random");
      return realRandom();
    }),
  ];
  return () => {
    for (const restore of restores) {
      restore();
    }
  };
}

let restore: (() => void) | undefined;

/**
 * The watch the CLI installs: the globals are replaced while the outermost watched
 * function runs and put back when it returns or throws.
 */
export const watchGlobals: ReadWatch = (run) => {
  const reads = new Set<GlobalRead>();
  if (running.length === 0) {
    restore = replaceAll();
  }
  running.push(reads);
  try {
    return { value: run(), reads: [...reads] };
  } finally {
    running.pop();
    if (running.length === 0) {
      restore?.();
      restore = undefined;
    }
  }
};
