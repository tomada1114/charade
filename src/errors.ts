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
 * `path` names the flag as the command defines it, never the value that was
 * passed with it. The command exits with code 2: it could not run.
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
