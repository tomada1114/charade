import { describe, expect, it } from "vitest";

import { frameAt, parseAt } from "../src/cli.js";

describe("--at as a frame (R1)", () => {
  it.each([["1.5"], ["1.5s"], ["45f"]])("reads %s as frame 45 at 30 fps", (text) => {
    expect(frameAt(parseAt(text, "frame.at"), 30)).toBe(45);
  });

  it.each([
    { text: "4", frame: 120 },
    { text: "120f", frame: 120 },
    { text: "121f", frame: 121 },
    { text: "0", frame: 0 },
    { text: "0.99", frame: 29 },
  ])("reads $text as frame $frame at 30 fps", ({ text, frame }) => {
    expect(frameAt(parseAt(text, "frame.at"), 30)).toBe(frame);
  });

  it("rejects 1.5x with a fix line that lists the three accepted forms", () => {
    let thrown: unknown;
    try {
      parseAt("1.5x", "frame.at");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "ERR_CLI_INVALID_AT", path: "frame.at" });
    const { fix } = thrown as { fix: string };
    expect(fix).toContain("1.5 ");
    expect(fix).toContain("1.5s");
    expect(fix).toContain("45f");
  });
});
