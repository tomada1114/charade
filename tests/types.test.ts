import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CharadeError,
  type CheckReport,
  checkReport,
  COULD_NOT_RUN,
  type ExitCode,
  exitCodeFor,
  type Finding,
  type FindingCollector,
  type Severity,
  type SourceLocation,
  UnknownFlagError,
} from "../src/index.js";

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

describe("finding types", () => {
  it("types severity as error or warning", () => {
    expectTypeOf<Severity>().toEqualTypeOf<"error" | "warning">();
  });

  it("requires code, severity, message and fix", () => {
    expectTypeOf<
      Pick<Finding, "code" | "severity" | "message" | "fix">
    >().toEqualTypeOf<{
      readonly code: string;
      readonly severity: Severity;
      readonly message: string;
      readonly fix: string;
    }>();
  });

  it("makes every location field optional", () => {
    expectTypeOf<Finding["row"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Finding["target"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Finding["joint"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Finding["time"]>().toEqualTypeOf<
      readonly [start: number, end: number] | undefined
    >();
    expectTypeOf<Finding["frames"]>().toEqualTypeOf<
      readonly [first: number, last: number] | undefined
    >();
    expectTypeOf<Finding["source"]>().toEqualTypeOf<SourceLocation | undefined>();
    expectTypeOf<{
      code: "ERR_CHECK_X";
      severity: "error";
      message: string;
      fix: string;
    }>().toExtend<Finding>();
  });

  it("allows measured values and nearest names", () => {
    expectTypeOf<Finding["measured"]>().toEqualTypeOf<
      Readonly<Record<string, number>> | undefined
    >();
    expectTypeOf<Finding["nearest"]>().toEqualTypeOf<readonly string[] | undefined>();
  });

  it("rejects a severity outside the two", () => {
    const rejected = (): Finding => ({
      code: "ERR_CHECK_X",
      // @ts-expect-error severity is error or warning
      severity: "info",
      message: "m",
      fix: "f",
    });
    expect(rejected).toBeTypeOf("function");
  });

  it("maps findings to 0 or 1, and could-not-run to 2", () => {
    expectTypeOf(exitCodeFor).returns.toEqualTypeOf<0 | 1>();
    expectTypeOf(exitCodeFor).returns.toExtend<ExitCode>();
    expectTypeOf(COULD_NOT_RUN).toEqualTypeOf<2>();
    expectTypeOf<ExitCode>().toEqualTypeOf<0 | 1 | 2>();
  });

  it("types the report as version, ok, findings and summary", () => {
    expectTypeOf(checkReport).returns.toEqualTypeOf<CheckReport>();
    expectTypeOf<keyof CheckReport>().toEqualTypeOf<
      "version" | "ok" | "findings" | "summary"
    >();
    expectTypeOf<CheckReport["version"]>().toEqualTypeOf<1>();
  });

  it("exposes the collected findings read-only", () => {
    expectTypeOf<FindingCollector["findings"]>().toEqualTypeOf<readonly Finding[]>();
    expectTypeOf<FindingCollector["add"]>().returns.toEqualTypeOf<boolean>();
  });
});

describe("thrown error types", () => {
  it("keeps UnknownFlagError's code as its literal", () => {
    expectTypeOf<UnknownFlagError["code"]>().toEqualTypeOf<"ERR_CLI_UNKNOWN_FLAG">();
  });

  it("holds the flag's path and no rejected value", () => {
    expectTypeOf<Exclude<keyof UnknownFlagError, keyof Error>>().toEqualTypeOf<
      "code" | "path"
    >();
    expectTypeOf<UnknownFlagError["path"]>().toEqualTypeOf<string>();
  });

  it("is constructed from the path alone", () => {
    expectTypeOf(UnknownFlagError).toBeConstructibleWith("check.strict");
    expectTypeOf(UnknownFlagError).toBeConstructibleWith("check.strict", {
      cause: new Error(),
    });
    const rejected = (): UnknownFlagError =>
      // @ts-expect-error the constructor takes no value argument
      new UnknownFlagError("check.strict", "--strict=maybe");
    expect(rejected).toBeTypeOf("function");
  });
});
