import { describe, expect, expectTypeOf, it } from "vitest";

import { CharadeError } from "../src/index.js";

class FirstError extends CharadeError {
  readonly code = "ERR_FIRST" as const;
}

class SecondError extends CharadeError {
  readonly code = "ERR_SECOND" as const;
  readonly limit = 1;
}

// These are compile-time assertions about the public surface. They run under
// Vitest so a broken type contract fails the same gate as a broken behavior,
// while tests/package.test.ts checks the *published declarations* from a
// consumer's point of view.
describe("public API types", () => {
  it("types CharadeError's code as a string", () => {
    expectTypeOf<CharadeError["code"]>().toEqualTypeOf<string>();
  });

  it("keeps a subclass's code as its literal type", () => {
    expectTypeOf<FirstError["code"]>().toEqualTypeOf<"ERR_FIRST">();
  });

  it("narrows a union of subclasses by code", () => {
    // Taken as a parameter so the union is not narrowed by an initializer.
    const classify = (error: FirstError | SecondError): void => {
      if (error.code === "ERR_SECOND") {
        expectTypeOf(error).toEqualTypeOf<SecondError>();
        expectTypeOf(error.limit).toEqualTypeOf<number>();
      } else {
        expectTypeOf(error).toEqualTypeOf<FirstError>();
      }
    };
    classify(new FirstError("first"));
    classify(new SecondError("second"));
  });

  it("accepts a message and standard error options", () => {
    expectTypeOf(FirstError).toBeConstructibleWith("message");
    expectTypeOf(FirstError).toBeConstructibleWith("message", { cause: new Error() });
  });

  it("is abstract, so only a subclass is constructible", () => {
    expectTypeOf<typeof CharadeError>().not.toExtend<
      new (message: string) => CharadeError
    >();
    expectTypeOf<typeof FirstError>().toExtend<new (message: string) => CharadeError>();
  });

  it("refuses a subclass that declares no code", () => {
    // Declared but never invoked: the assertion is that this body fails to
    // compile without the `@ts-expect-error` comment.
    const rejected = (): void => {
      // @ts-expect-error a subclass must declare its code
      class Uncoded extends CharadeError {}
      expectTypeOf(Uncoded).toBeObject();
    };
    expect(rejected).toBeTypeOf("function");
  });
});
