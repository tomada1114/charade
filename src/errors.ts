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

/**
 * The kind of a vocabulary item: what `defineAction` and its siblings make.
 *
 * @public
 */
export type ItemKind = "action" | "expression" | "prop" | "backdrop" | "effect";

/**
 * A definition declared a parameter whose name the call's options already use.
 *
 * @remarks
 * Options and timing share one bag with the parameters, so a parameter may not be
 * named `at`, `duration`, `mood`, `blend` or `mode`. `path` is the parameter's dotted
 * path in the definition, such as `params.at`.
 *
 * @example
 * ```ts
 * const error = new ReservedParameterError("action", "params.at");
 * console.log(error.code, error.kind, error.path);
 * // => "ERR_DEFINE_RESERVED_PARAMETER" "action" "params.at"
 * ```
 *
 * @public
 */
export class ReservedParameterError extends CharadeError {
  /** Stable discriminator, unchanged across non-breaking releases. */
  readonly code = "ERR_DEFINE_RESERVED_PARAMETER" as const;

  /** The kind of item being defined. */
  readonly kind: ItemKind;

  /** The dotted path of the parameter, such as `params.at`. */
  readonly path: string;

  /**
   * @param kind - The kind of item being defined.
   * @param path - The dotted path of the parameter.
   * @param options - Standard `Error` options, such as the `cause`.
   */
  constructor(kind: ItemKind, path: string, options?: ErrorOptions) {
    super(
      `The ${kind} declares ${path}, a name its options use; at, duration, mood, blend and mode are taken.`,
      options,
    );
    this.kind = kind;
    this.path = path;
  }
}

/**
 * A parameter's `default` is not a value the parameter allows.
 *
 * @remarks
 * A number's default lies outside its `min` and `max`, an enum's is not one of its
 * `values`, a default has the wrong type, or a `prop` parameter has one at all.
 * `path` names the default, such as `params.speed.default`; the value is not carried.
 *
 * @example
 * ```ts
 * const error = new InvalidDefaultError("action", "params.speed.default");
 * console.log(error.code, error.path);
 * // => "ERR_DEFINE_INVALID_DEFAULT" "params.speed.default"
 * ```
 *
 * @public
 */
export class InvalidDefaultError extends CharadeError {
  /** Stable discriminator, unchanged across non-breaking releases. */
  readonly code = "ERR_DEFINE_INVALID_DEFAULT" as const;

  /** The kind of item being defined. */
  readonly kind: ItemKind;

  /** The dotted path of the default, such as `params.speed.default`. */
  readonly path: string;

  /**
   * @param kind - The kind of item being defined.
   * @param path - The dotted path of the default.
   * @param options - Standard `Error` options, such as the `cause`.
   */
  constructor(kind: ItemKind, path: string, options?: ErrorOptions) {
    super(`The ${kind}'s ${path} is not a value the parameter allows.`, options);
    this.kind = kind;
    this.path = path;
  }
}

/**
 * A definition is missing a member or has one of the wrong shape.
 *
 * @remarks
 * Types are erased before a scene runs, so `defineAction` and its siblings check the
 * shape when they run: a non-empty `name`, a `description`, a parameter specification
 * whose every key has a known `type` and a `doc` line, and a `build` or `draw`
 * function. `path` names the member, such as `name` or `params.speed.type`.
 *
 * @example
 * ```ts
 * const error = new InvalidDefinitionError("prop", "draw");
 * console.log(error.code, error.kind, error.path);
 * // => "ERR_DEFINE_INVALID_DEFINITION" "prop" "draw"
 * ```
 *
 * @public
 */
export class InvalidDefinitionError extends CharadeError {
  /** Stable discriminator, unchanged across non-breaking releases. */
  readonly code = "ERR_DEFINE_INVALID_DEFINITION" as const;

  /** The kind of item being defined. */
  readonly kind: ItemKind;

  /** The dotted path of the member, such as `params.speed.type`. */
  readonly path: string;

  /**
   * @param kind - The kind of item being defined.
   * @param path - The dotted path of the member.
   * @param options - Standard `Error` options, such as the `cause`.
   */
  constructor(kind: ItemKind, path: string, options?: ErrorOptions) {
    super(`The ${kind}'s ${path} is missing or has the wrong shape.`, options);
    this.kind = kind;
    this.path = path;
  }
}

/**
 * A string given to {@link svgPath} is not valid SVG path data.
 *
 * @remarks
 * `offset` is the zero-based character offset in the `d` string where parsing failed:
 * the first character that is not part of a valid command, or the string's length when
 * a command ends before all its numbers are given. The string itself is not carried.
 * It is thrown before any path call is issued, so a malformed shape draws nothing.
 * Thrown while a frame is drawn, it reaches a check as the cause of an
 * `ERR_SCENE_DRAWING_FAILED` finding.
 *
 * @example
 * ```ts
 * const error = new InvalidPathDataError(8);
 * console.log(error.code, error.offset);
 * // => "ERR_SCENE_INVALID_PATH_DATA" 8
 * ```
 *
 * @public
 */
export class InvalidPathDataError extends CharadeError {
  /** Stable discriminator, unchanged across non-breaking releases. */
  readonly code = "ERR_SCENE_INVALID_PATH_DATA" as const;

  /** The zero-based character offset in the `d` string where parsing failed. */
  readonly offset: number;

  /**
   * @param offset - The zero-based character offset where parsing failed.
   * @param options - Standard `Error` options, such as the `cause`.
   */
  constructor(offset: number, options?: ErrorOptions) {
    super(`The SVG path data is malformed at offset ${String(offset)}.`, options);
    this.offset = offset;
  }
}
