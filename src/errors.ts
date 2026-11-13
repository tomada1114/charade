/**
 * The base of every error charade throws.
 *
 * @remarks
 * `code` is part of the published contract and is safe to branch on; each
 * subclass narrows it to its own `ERR_…` literal. `message` is written for
 * humans and may be reworded in a patch release, so do not match on it.
 *
 * `name` is set to the concrete subclass's name, so a stack trace says which
 * failure it is rather than `Error`.
 *
 * @example
 * ```ts
 * function describe(error: unknown): string {
 *   return error instanceof CharadeError ? error.code : "unknown";
 * }
 * ```
 *
 * @public
 */
export abstract class CharadeError extends Error {
  /** Stable discriminator, unchanged across non-breaking releases. */
  abstract readonly code: string;

  /**
   * @param message - Human-readable explanation of the failure.
   * @param options - Standard `Error` options, such as the `cause`.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * A command was given a flag it does not have.
 *
 * @remarks
 * `path` names the flag as it was given, never the value that was passed
 * with it. The command exits with code 2: it could not run.
 *
 * @example
 * ```ts
 * const error = new UnknownFlagError("check.strct");
 * console.log(error.code, error.path);
 * // => "ERR_CLI_UNKNOWN_FLAG" "check.strct"
 * ```
 *
 * @public
 */
export class UnknownFlagError extends CharadeError {
  /** Stable discriminator, unchanged across non-breaking releases. */
  readonly code = "ERR_CLI_UNKNOWN_FLAG" as const;

  /** The dotted path of the rejected flag, such as `check.strict`. */
  readonly path: string;

  /**
   * @param path - The dotted path of the rejected flag.
   * @param options - Standard `Error` options, such as the `cause`.
   */
  constructor(path: string, options?: ErrorOptions) {
    super(`Unknown flag ${path}.`, options);
    this.path = path;
  }
}

/**
 * A scene's `build` callback returned a promise.
 *
 * @remarks
 * `build` runs once, synchronously, inside `scene()`: the scene is data by the
 * time `scene()` returns, so nothing an `await` resumes could still be
 * recorded. Do the asynchronous work before calling `scene()`.
 *
 * @example
 * ```ts
 * const error = new AsyncBuildError();
 * console.log(error.code);
 * // => "ERR_SCENE_ASYNC_BUILD"
 * ```
 *
 * @public
 */
export class AsyncBuildError extends CharadeError {
  /** Stable discriminator, unchanged across non-breaking releases. */
  readonly code = "ERR_SCENE_ASYNC_BUILD" as const;

  /**
   * @param options - Standard `Error` options, such as the `cause`.
   */
  constructor(options?: ErrorOptions) {
    super(
      "The scene's build callback returned a promise; it must record every call synchronously.",
      options,
    );
  }
}

/**
 * `stage.row(i)` named a row the scene does not have.
 *
 * @remarks
 * `rows` is the scene's row count, so the valid indexes are `0` to
 * `rows - 1`; the rejected index is not carried. Set the `rows` option of
 * `scene()` to add a row.
 *
 * @example
 * ```ts
 * const error = new UnknownRowError(4);
 * console.log(error.code, error.rows);
 * // => "ERR_SCENE_UNKNOWN_ROW" 4
 * ```
 *
 * @public
 */
export class UnknownRowError extends CharadeError {
  /** Stable discriminator, unchanged across non-breaking releases. */
  readonly code = "ERR_SCENE_UNKNOWN_ROW" as const;

  /** How many rows the scene has. */
  readonly rows: number;

  /**
   * @param rows - How many rows the scene has.
   * @param options - Standard `Error` options, such as the `cause`.
   */
  constructor(rows: number, options?: ErrorOptions) {
    super(
      `The scene has ${String(rows)} row(s); stage.row(i) takes a whole number from 0 to ${String(rows - 1)}.`,
      options,
    );
    this.rows = rows;
  }
}

/**
 * A stage, row or actor was used after `scene()` had returned.
 *
 * @remarks
 * A scene is frozen data once `scene()` returns, so a later call has nothing
 * to record into. Make every call inside the `build` callback, before it
 * returns.
 *
 * @example
 * ```ts
 * const error = new SceneClosedError();
 * console.log(error.code);
 * // => "ERR_SCENE_CLOSED"
 * ```
 *
 * @public
 */
export class SceneClosedError extends CharadeError {
  /** Stable discriminator, unchanged across non-breaking releases. */
  readonly code = "ERR_SCENE_CLOSED" as const;

  /**
   * @param options - Standard `Error` options, such as the `cause`.
   */
  constructor(options?: ErrorOptions) {
    super(
      "The scene is already built; make every call inside the build callback.",
      options,
    );
  }
}
