import path from "node:path";

import { describe, expect, it } from "vitest";

import { RecordingContext } from "../src/check/recorder.js";
import { type CliOptions, type CliResult, runCli } from "../src/cli.js";
import { chooseFont, type FontLookup, hasText } from "../src/export/fonts.js";
import type { Rasteriser } from "../src/export/raster.js";
import { type Finding, type Scene, scene } from "../src/index.js";

/** A font lookup with these families installed; `unreadable` files cannot be used. */
function lookupOf(
  installed: readonly string[],
  unreadable = false,
): FontLookup & { readonly used: [alias: string, file: string][] } {
  const used: [string, string][] = [];
  return {
    used,
    has: (family) => installed.includes(family),
    use: (alias, file) => {
      if (unreadable) {
        throw new Error("not a font");
      }
      used.push([alias, file]);
    },
  };
}

/** A rasteriser that draws on recording contexts and never loads skia-canvas. */
function fakeRaster(lookup: FontLookup): {
  readonly raster: Rasteriser;
  readonly drawn: RecordingContext[];
  readonly lookups: number[];
} {
  const drawn: RecordingContext[] = [];
  const lookups: number[] = [];
  const png: Rasteriser["png"] = (_width, _height, draw) => {
    const ctx = new RecordingContext();
    draw(ctx);
    drawn.push(ctx);
    return Promise.resolve(Buffer.from("png"));
  };
  return {
    drawn,
    lookups,
    raster: {
      png,
      rgba: png,
      composite: () => Promise.resolve(Buffer.from("png")),
      fonts: () => {
        lookups.push(lookups.length);
        return Promise.resolve(lookup);
      },
      measurer: (font) => {
        const ctx = new RecordingContext();
        ctx.font = font;
        return Promise.resolve(ctx);
      },
    },
  };
}

function running(built: Scene, raster: Rasteriser, platform: string): CliOptions {
  return {
    nodeVersion: "24.22.1",
    load: () => Promise.resolve(built),
    raster,
    platform,
    write: () => Promise.resolve(),
  };
}

function findingsOf(result: CliResult): Finding[] {
  return (JSON.parse(result.stdout) as { findings: Finding[] }).findings;
}

const spoken = scene({ width: 250, height: 250 }, (stage) => {
  stage.label("Before");
  stage.actor().say("こんにちは", { duration: 1 });
});

const silent = scene({ width: 250, height: 250 }, (stage) => {
  stage.actor().wait(1);
});

const named = scene({ width: 250, height: 250, font: "fonts/mine.otf" }, (stage) => {
  stage.label("Before", { duration: 1 });
});

describe("the default font", () => {
  it.each([
    ["darwin", "Hiragino Sans"],
    ["win32", "Yu Gothic"],
    ["linux", "Noto Sans CJK JP"],
  ])("on %s is %s when it is installed", (platform, family) => {
    const choice = chooseFont(spoken, "scene.ts", platform, lookupOf([family]));
    expect(choice).toEqual({ family: `"${family}", sans-serif`, findings: [] });
  });

  it("is the first installed family of the list", () => {
    const lookup = lookupOf(["Noto Sans CJK KR", "Noto Sans CJK TC", "Yu Gothic"]);
    expect(chooseFont(spoken, "scene.ts", "linux", lookup).family).toBe(
      '"Noto Sans CJK TC", sans-serif',
    );
  });

  it("uses the Linux list on a platform that has none of its own", () => {
    const lookup = lookupOf(["Noto Sans CJK JP"]);
    expect(chooseFont(spoken, "scene.ts", "freebsd", lookup).findings).toEqual([]);
  });

  // R4
  it("falls back with a warning that names the fix when none is installed", () => {
    const choice = chooseFont(spoken, "scene.ts", "linux", lookupOf(["Yu Gothic"]));
    expect(choice.family).toBe("sans-serif");
    expect(choice.findings).toHaveLength(1);
    expect(choice.findings[0]).toMatchObject({
      code: "ERR_ENV_FONT_MISSING",
      severity: "warning",
    });
    expect(choice.findings[0]?.fix).toContain("Install Noto Sans CJK,");
    expect(choice.findings[0]?.fix).toContain("font option");
  });

  it.each([
    ["darwin", "Hiragino Sans"],
    ["win32", "Yu Gothic"],
  ])("names the font to install on %s", (platform, family) => {
    const [finding] = chooseFont(spoken, "scene.ts", platform, lookupOf([])).findings;
    expect(finding?.fix).toContain(`Install ${family},`);
  });

  it("says nothing about a scene without text", () => {
    expect(hasText(silent.timeline)).toBe(false);
    expect(chooseFont(silent, "scene.ts", "linux", lookupOf([]))).toEqual({
      family: "sans-serif",
      findings: [],
    });
  });
});

describe("a named font file", () => {
  // R5
  it("is used whatever the list has installed", () => {
    const lookup = lookupOf(["Hiragino Sans"]);
    const choice = chooseFont(named, "/work/scenes/talk.ts", "darwin", lookup);
    // Relative to the scene file's folder, not to where the command ran.
    expect(lookup.used).toEqual([
      ["charade scene font", path.resolve("/work/scenes", "fonts", "mine.otf")],
    ]);
    expect(choice).toEqual({
      family: '"charade scene font", sans-serif',
      findings: [],
    });
  });

  it("is used when no listed font is installed, without a finding", () => {
    const choice = chooseFont(named, "/work/talk.ts", "linux", lookupOf([]));
    expect(choice.family).toBe('"charade scene font", sans-serif');
    expect(choice.findings).toEqual([]);
  });

  it("is an error when it cannot be read, and the list is used instead", () => {
    const lookup = lookupOf(["Yu Gothic"], true);
    const choice = chooseFont(named, "/work/talk.ts", "win32", lookup);
    expect(choice.family).toBe('"Yu Gothic", sans-serif');
    expect(choice.findings.map(({ code, severity }) => [code, severity])).toEqual([
      ["ERR_ENV_FONT_UNREADABLE", "error"],
    ]);
  });

  it("reports only the unreadable file when the list has nothing either", () => {
    const choice = chooseFont(named, "/work/talk.ts", "linux", lookupOf([], true));
    expect(choice.family).toBe("sans-serif");
    expect(choice.findings.map((finding) => finding.code)).toEqual([
      "ERR_ENV_FONT_UNREADABLE",
    ]);
  });
});

describe("check", () => {
  // R4
  it("reports the missing font as a warning and exits 0", async () => {
    const { raster } = fakeRaster(lookupOf([]));
    const result = await runCli(
      ["check", "talk.ts", "--json"],
      running(spoken, raster, "linux"),
    );
    expect(result.exitCode).toBe(0);
    expect(findingsOf(result).map(({ code, severity }) => [code, severity])).toEqual([
      ["ERR_ENV_FONT_MISSING", "warning"],
    ]);
  });

  it("prints the fix as text", async () => {
    const { raster } = fakeRaster(lookupOf([]));
    const result = await runCli(["check", "talk.ts"], running(spoken, raster, "linux"));
    expect(result.stdout).toContain("warning ERR_ENV_FONT_MISSING:");
    expect(result.stdout).toContain("0 errors, 1 warning");
  });

  it("fails on the missing font under --strict", async () => {
    const { raster } = fakeRaster(lookupOf([]));
    const result = await runCli(
      ["check", "talk.ts", "--strict", "--json"],
      running(spoken, raster, "linux"),
    );
    expect(result.exitCode).toBe(1);
  });

  it("is clean when the listed font is installed", async () => {
    const { raster } = fakeRaster(lookupOf(["Hiragino Sans"]));
    const result = await runCli(
      ["check", "talk.ts", "--json"],
      running(spoken, raster, "darwin"),
    );
    expect(findingsOf(result)).toEqual([]);
  });

  it("exits 1 for a font file that cannot be read", async () => {
    const { raster } = fakeRaster(lookupOf([], true));
    const result = await runCli(
      ["check", "talk.ts", "--json"],
      running(named, raster, "linux"),
    );
    expect(result.exitCode).toBe(1);
    expect(findingsOf(result).map((finding) => finding.code)).toEqual([
      "ERR_ENV_FONT_UNREADABLE",
    ]);
  });

  it("loads no rasteriser for a scene without text", async () => {
    const { raster, lookups } = fakeRaster(lookupOf([]));
    const result = await runCli(
      ["check", "talk.ts", "--json"],
      running(silent, raster, "linux"),
    );
    expect(findingsOf(result)).toEqual([]);
    expect(lookups).toEqual([]);
  });
});

describe("frame", () => {
  // R4: drawing continues.
  it("draws the text in the fallback font and counts the warning", async () => {
    const { raster, drawn } = fakeRaster(lookupOf([]));
    const result = await runCli(
      ["frame", "talk.ts", "--at", "0", "--json"],
      running(spoken, raster, "linux"),
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      summary: { errors: 0, warnings: 1 },
    });
    const log = drawn[0]?.log ?? [];
    expect(log.filter((entry) => entry.call === "font")).toEqual([
      { call: "font", args: ["100px sans-serif"] },
    ]);
    expect(
      log.filter((entry) => entry.call === "fillText").map((entry) => entry.args[0]),
    ).toEqual(["Before", "こんにちは"]);
  });

  // R5
  it("draws in the scene's font file on a machine that has the listed font", async () => {
    const lookup = lookupOf(["Hiragino Sans"]);
    const { raster, drawn } = fakeRaster(lookup);
    await runCli(
      ["frame", "scenes/talk.ts", "--at", "0", "--json"],
      running(named, raster, "darwin"),
    );
    expect(lookup.used.map(([alias]) => alias)).toEqual(["charade scene font"]);
    expect(lookup.used[0]?.[1]).toBe(path.resolve("scenes", "fonts", "mine.otf"));
    expect(drawn[0]?.log.find((entry) => entry.call === "font")?.args).toEqual([
      '100px "charade scene font", sans-serif',
    ]);
  });

  it("gives text in a drawing the font even when the scene has no label", async () => {
    const { raster, drawn } = fakeRaster(lookupOf(["Yu Gothic"]));
    const result = await runCli(
      ["frame", "talk.ts", "--at", "0", "--json"],
      running(silent, raster, "win32"),
    );
    expect(JSON.parse(result.stdout)).toMatchObject({ summary: { warnings: 0 } });
    expect(drawn[0]?.log.find((entry) => entry.call === "font")?.args).toEqual([
      '100px "Yu Gothic", sans-serif',
    ]);
  });
});

describe("sheet", () => {
  it("draws every cell in the chosen font", async () => {
    const parts: RecordingContext[] = [];
    const { raster } = fakeRaster(lookupOf(["Yu Gothic"]));
    const composite: Rasteriser["composite"] = (_width, _height, cells) => {
      for (const cell of cells) {
        const ctx = new RecordingContext();
        cell.draw(ctx);
        parts.push(ctx);
      }
      return Promise.resolve(Buffer.from("png"));
    };
    for (const flags of [[], ["--row", "0"]]) {
      await runCli(
        ["sheet", "talk.ts", "--times", "0", ...flags, "--json"],
        running(spoken, { ...raster, composite }, "win32"),
      );
    }
    expect(
      parts.map((ctx) => ctx.log.find((entry) => entry.call === "font")?.args[0]),
    ).toEqual(['100px "Yu Gothic", sans-serif', '100px "Yu Gothic", sans-serif']);
  });
});
