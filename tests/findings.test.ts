import { describe, expect, it } from "vitest";

import * as api from "../src/index.js";
import {
  AsyncBuildError,
  CharadeError,
  checkReport,
  COULD_NOT_RUN,
  exitCodeFor,
  FINDING_CAP,
  type Finding,
  FindingCollector,
  SceneClosedError,
  UnknownFlagError,
  UnknownRowError,
} from "../src/index.js";

/** The namespaces `.claude/rules/checks.md` fixes, copied from issue #6. */
const NAMESPACED_CODE = /^ERR_(CLI|LOAD|SCENE|DEFINE|CHECK|RENDER|ENV)_[A-Z0-9_]+$/;

const kneeError: Finding = {
  code: "ERR_CHECK_JOINT_LIMIT",
  severity: "error",
  message: "kneeR bends past its limit",
  fix: "Reduce the bend",
  row: 0,
  joint: "kneeR",
  time: [1.2, 1.5],
  frames: [36, 45],
};

const offFrame: Finding = {
  code: "ERR_CHECK_OFF_FRAME",
  severity: "warning",
  message: "hero leaves the frame",
  fix: "Ignore it if the exit is meant",
};

function numbered(index: number): Finding {
  return { ...offFrame, message: `finding ${String(index)}` };
}

describe("Finding", () => {
  it("carries every location field, measured values and nearest names", () => {
    const finding: Finding = {
      ...kneeError,
      target: "hero",
      source: { file: "scene.ts", line: 12, column: 5 },
      measured: { angle: 172, limit: 160 },
      nearest: ["kneeL", "knee"],
    };
    expect(finding.source).toEqual({ file: "scene.ts", line: 12, column: 5 });
    expect(finding.measured).toEqual({ angle: 172, limit: 160 });
    expect(finding.nearest).toEqual(["kneeL", "knee"]);
  });

  it("needs no location at all", () => {
    expect(Object.keys(offFrame).sort()).toEqual([
      "code",
      "fix",
      "message",
      "severity",
    ]);
  });
});

describe("the code namespace", () => {
  const errorCodes = Object.values(api)
    .filter(
      (value): value is typeof UnknownFlagError =>
        typeof value === "function" &&
        Object.prototype.isPrototypeOf.call(CharadeError, value),
    )
    .map((value) => value.name);

  it("has a representative code for every concrete error class", () => {
    expect(errorCodes.sort()).toEqual([
      "AsyncBuildError",
      "SceneClosedError",
      "UnknownFlagError",
      "UnknownRowError",
    ]);
  });

  it.each([
    ["AsyncBuildError", new AsyncBuildError().code],
    ["SceneClosedError", new SceneClosedError().code],
    ["UnknownFlagError", new UnknownFlagError("check.strict").code],
    ["UnknownRowError", new UnknownRowError(4).code],
  ])("%s's code is in a namespace", (_name, code) => {
    expect(code).toMatch(NAMESPACED_CODE);
  });

  it.each([
    ["no area", "ERR_STRICT"],
    ["an unknown area", "ERR_SMOKE_FAILED"],
    ["an empty failure", "ERR_CLI_"],
    ["lower case", "ERR_cli_unknown"],
  ])("rejects a code with %s", (_label, code) => {
    expect(code).not.toMatch(NAMESPACED_CODE);
  });
});

describe("exitCodeFor", () => {
  it("maps an error finding to 1", () => {
    expect(exitCodeFor([kneeError])).toBe(1);
  });

  it("maps errors mixed with warnings to 1", () => {
    expect(exitCodeFor([offFrame, kneeError])).toBe(1);
  });

  it("maps only warnings to 0", () => {
    expect(exitCodeFor([offFrame, offFrame])).toBe(0);
  });

  it("maps only warnings to 1 under strict", () => {
    expect(exitCodeFor([offFrame], { strict: true })).toBe(1);
  });

  it.each([
    ["absent", {}],
    ["explicit false", { strict: false }],
  ])("treats strict %s as off", (_label, options) => {
    expect(exitCodeFor([offFrame], options)).toBe(0);
  });

  it.each([
    ["off", false],
    ["on", true],
  ])("maps an empty list to 0 with strict %s", (_label, strict) => {
    expect(exitCodeFor([], { strict })).toBe(0);
  });

  it("gives could-not-run its own code", () => {
    expect(COULD_NOT_RUN).toBe(2);
  });
});

describe("FindingCollector", () => {
  it("caps at twenty findings", () => {
    expect(FINDING_CAP).toBe(20);
  });

  it("starts empty", () => {
    const collector = new FindingCollector();
    expect(collector.findings).toEqual([]);
    expect(collector.truncated).toBe(false);
  });

  it.each([
    ["one under the cap", 19, 19, false],
    ["exactly the cap", 20, 20, false],
    ["one past the cap", 21, 20, true],
    ["far past the cap", 50, 20, true],
  ])("with %s, keeps the first findings", (_label, added, kept, truncated) => {
    const collector = new FindingCollector();
    for (let index = 0; index < added; index += 1) {
      collector.add(numbered(index));
    }
    expect(collector.findings).toHaveLength(kept);
    expect(collector.findings[0]?.message).toBe("finding 0");
    expect(collector.findings.at(-1)?.message).toBe(`finding ${String(kept - 1)}`);
    expect(collector.truncated).toBe(truncated);
  });

  it("reports whether each finding was recorded", () => {
    const collector = new FindingCollector();
    const recorded = Array.from({ length: 21 }, (_, index) =>
      collector.add(numbered(index)),
    );
    expect(recorded.filter(Boolean)).toHaveLength(20);
    expect(recorded.at(-1)).toBe(false);
  });

  it("records duplicates as separate findings", () => {
    const collector = new FindingCollector();
    collector.add(kneeError);
    collector.add(kneeError);
    expect(collector.findings).toEqual([kneeError, kneeError]);
  });
});

describe("checkReport", () => {
  it("reports an empty run as ok", () => {
    expect(checkReport([])).toEqual({
      version: 1,
      ok: true,
      findings: [],
      summary: { errors: 0, warnings: 0, truncated: false },
    });
  });

  it("reports an error finding as not ok", () => {
    expect(checkReport([kneeError, offFrame])).toEqual({
      version: 1,
      ok: false,
      findings: [kneeError, offFrame],
      summary: { errors: 1, warnings: 1, truncated: false },
    });
  });

  it.each([
    ["off", false, true],
    ["on", true, false],
  ])("agrees with the exit code for warnings, strict %s", (_label, strict, ok) => {
    expect(checkReport([offFrame], { strict }).ok).toBe(ok);
  });

  it("says when findings were dropped", () => {
    expect(checkReport([offFrame], { truncated: true }).summary.truncated).toBe(true);
  });
});

describe("UnknownFlagError", () => {
  it("carries the flag's dotted path", () => {
    const error = new UnknownFlagError("check.strict");
    expect(error).toBeInstanceOf(CharadeError);
    expect(error.code).toBe("ERR_CLI_UNKNOWN_FLAG");
    expect(error.path).toBe("check.strict");
  });

  it("holds no own field beyond its name, code and path", () => {
    const error = new UnknownFlagError("check.strict");
    expect(Object.keys(error).sort()).toEqual(["code", "name", "path"]);
  });

  it("forwards the cause", () => {
    const cause = new Error("parse failed");
    expect(new UnknownFlagError("check.strict", { cause }).cause).toBe(cause);
  });
});
