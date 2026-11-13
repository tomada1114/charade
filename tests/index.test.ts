import { describe, expect, it } from "vitest";

import * as api from "../src/index.js";
import {
  AsyncBuildError,
  CharadeError,
  SceneClosedError,
  UnknownFlagError,
  UnknownRowError,
} from "../src/index.js";

/** A concrete subclass, written the way every charade error is written. */
class SampleError extends CharadeError {
  readonly code = "ERR_SAMPLE" as const;
}

describe("CharadeError", () => {
  it("is an Error with a captured stack", () => {
    const error = new SampleError("a sample failure");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CharadeError);
    expect(typeof error.stack).toBe("string");
  });

  it("names the error after the concrete subclass", () => {
    expect(new SampleError("a sample failure").name).toBe("SampleError");
  });

  it("exposes the subclass's code", () => {
    expect(new SampleError("a sample failure").code).toBe("ERR_SAMPLE");
  });

  it("forwards the cause", () => {
    const cause = new Error("underlying");
    expect(new SampleError("a sample failure", { cause }).cause).toBe(cause);
  });
});

// --- the error-code convention -----------------------------------------------
//
// "Naming and constants" in AGENTS.md fixes the shape of every published error:
// a `name` a reader recognises in a stack trace, and an `ERR_`-prefixed `code`
// a caller is invited to branch on. Reading the classes off the module's own
// exports is what makes that a rule instead of two assertions about two
// classes — a third error type that forgets either half fails here without
// anyone having remembered to write a test for it.

type ErrorClass = new (...args: never[]) => Error;

function isErrorClass(value: unknown): value is ErrorClass {
  return (
    typeof value === "function" && Object.prototype.isPrototypeOf.call(Error, value)
  );
}

const exportedErrorNames = Object.entries(api)
  .filter(([, value]) => isErrorClass(value))
  .map(([name]) => name)
  .sort();

/**
 * One representative instance per exported error class.
 *
 * Constructor signatures differ by design — each error carries the fields that
 * describe what it rejected — so the instances are written out rather than
 * built reflectively. The first test below compares this list against the
 * exports, so a class cannot be added and left uncovered.
 */
const representativeErrors: Record<string, Error> = {
  AsyncBuildError: new AsyncBuildError(),
  SampleError: new SampleError("a sample failure"),
  SceneClosedError: new SceneClosedError(),
  UnknownFlagError: new UnknownFlagError("check.strict"),
  UnknownRowError: new UnknownRowError(4),
};

/**
 * Exported abstract bases. They cannot be instantiated, so the test-defined
 * subclass above stands in for them in the contract checks.
 */
const abstractBases: Record<string, string> = { CharadeError: "SampleError" };

/** The code shape AGENTS.md fixes: `ERR_` plus SCREAMING_SNAKE_CASE. */
const ERROR_CODE = /^ERR_[A-Z0-9_]+$/;

function codeOf(error: Error): unknown {
  return (error as { code?: unknown }).code;
}

describe("the published error contract", () => {
  it("has a representative instance for every exported error class", () => {
    expect(exportedErrorNames).toContain("CharadeError");
    const covered = exportedErrorNames
      .map((name) => abstractBases[name] ?? name)
      .sort();
    expect(Object.keys(representativeErrors).sort()).toEqual(covered);
  });

  it("derives every exported error class from CharadeError", () => {
    for (const name of exportedErrorNames) {
      const value: unknown = api[name as keyof typeof api];
      const derived =
        typeof value === "function" &&
        (value === CharadeError ||
          Object.prototype.isPrototypeOf.call(CharadeError, value));
      expect(derived).toBe(true);
    }
  });

  it.each(Object.entries(representativeErrors))(
    "%s sets its name and a stable ERR_ code",
    (name, error) => {
      expect(error).toBeInstanceOf(Error);
      // The default is the string "Error", which tells a reader nothing about
      // which failure they are looking at.
      expect(error.name).toBe(name);
      expect(codeOf(error)).toBeTypeOf("string");
      expect(codeOf(error)).toMatch(ERROR_CODE);
    },
  );

  it("gives each error class a code of its own", () => {
    // A shared code makes the discriminator undiscriminating: two failures a
    // caller must handle differently would be indistinguishable.
    const codes = Object.values(representativeErrors).map((error) => codeOf(error));

    expect(new Set(codes).size).toBe(codes.length);
  });
});
