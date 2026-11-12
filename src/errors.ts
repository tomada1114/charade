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
