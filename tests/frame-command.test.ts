import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type CliOptions, type CliResult, runCli } from "../src/cli.js";
import { drawFrame } from "../src/draw/frame.js";
import { createRasteriser } from "../src/export/raster.js";
import { type Scene, scene } from "../src/index.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG's width and height, read from its IHDR chunk. */
function sizeOf(png: Buffer): [number, number] {
  expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

// One rasteriser for the file: skia-canvas is loaded once.
const raster = createRasteriser();

function loading(built: Scene): CliOptions {
  return { nodeVersion: "24.22.1", load: () => Promise.resolve(built), raster };
}

interface Document {
  version: number;
  ok: boolean;
  paths: string[];
  states: { frame: number; time: number; rows: { row: number }[] }[];
  summary: { errors: number; warnings: number; truncated: boolean };
  error?: { code: string; fix: string };
}

function document(result: CliResult): Document {
  return JSON.parse(result.stdout) as Document;
}

/** 4 s at 30 fps: 121 frames, 0 to 120. */
const walk = scene({ duration: 4, width: 320, height: 180 }, (stage) => {
  stage
    .actor()
    .drive((t) => ({ pelvisX: 0.4 * t, shoulderR: 0.5 * t }), { duration: 4 });
});

/** The knee bends backwards past its limit from 1.2 s: one error finding. */
const broken = scene({ duration: 2, width: 320, height: 180 }, (stage) => {
  stage
    .actor()
    .pose({ kneeR: -0.4 }, { at: 1.2, duration: 0.3, mode: "add", blend: 0 });
});

const captioned = (text: boolean): Scene =>
  scene({ duration: 1, width: 320, height: 180 }, (stage) => {
    const hero = stage.actor();
    hero.wait(1);
    if (text) {
      stage.label("Before");
      hero.say("こんにちは", { at: 0 });
    }
  });

const twoRows = scene({ duration: 2, width: 400, height: 400, rows: 2 }, (stage) => {
  stage.row(0).actor({ name: "ada" }).pose({ pelvisX: 1 }, { duration: 2 });
  stage.row(1).actor({ name: "bob" }).wait(2);
});

let folder: string;
let sceneFile: string;

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), "charade-frame-"));
  sceneFile = path.join(folder, "sit.ts");
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("text", () => {
  it("draws a label and a bubble with the real rasteriser, the same twice", async () => {
    const pngs: Buffer[] = [];
    for (const built of [captioned(true), captioned(true), captioned(false)]) {
      const out = path.join(folder, `${String(pngs.length)}.png`);
      const result = await runCli(
        ["frame", sceneFile, "--at", "0", "-o", out, "--json"],
        loading(built),
      );
      expect(result.exitCode).toBe(0);
      pngs.push(readFileSync(out));
    }
    expect(pngs[0]?.equals(pngs[1] ?? Buffer.alloc(0))).toBe(true);
    expect(pngs[0]?.equals(pngs[2] ?? Buffer.alloc(0))).toBe(false);
  });

  it("checks a scene with text against the real font metrics", async () => {
    const result = await runCli(
      ["check", sceneFile, "--json"],
      loading(captioned(true)),
    );
    // The font installed here decides whether the fallback warning is among them.
    expect(result.exitCode).toBe(0);
    expect(document(result).summary.errors).toBe(0);
  });
});

describe("frame", () => {
  // R1
  it("draws frame 45 of a 30 fps scene for 1.5, 1.5s and 45f alike", async () => {
    const written: Buffer[] = [];
    for (const at of ["1.5", "1.5s", "45f"]) {
      const out = path.join(folder, `${at}.png`);
      const result = await runCli(
        ["frame", sceneFile, "--at", at, "-o", out, "--json"],
        loading(walk),
      );
      expect(result.exitCode).toBe(0);
      expect(document(result).states.map(({ frame }) => frame)).toEqual([45]);
      written.push(readFileSync(out));
    }
    const [first, second, third] = written;
    expect(first?.equals(second ?? Buffer.alloc(0))).toBe(true);
    expect(first?.equals(third ?? Buffer.alloc(0))).toBe(true);
    const other = await raster.png(walk.width, walk.height, (ctx) => {
      drawFrame(ctx, walk, 44);
    });
    expect(first?.equals(other)).toBe(false);
  });

  it("writes next to the scene, named after it and the frame, at the scene's size", async () => {
    const result = await runCli(["frame", sceneFile, "--at", "1.5"], loading(walk));
    const out = path.join(folder, "sit.frame-45.png");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(sizeOf(readFileSync(out))).toEqual([320, 180]);
  });

  // R3
  it("still writes the PNG and exits 0 for a scene with an error finding", async () => {
    const out = path.join(folder, "broken.png");
    const result = await runCli(
      ["frame", sceneFile, "--at", "1.4", "-o", out, "--json"],
      loading(broken),
    );
    expect(result.exitCode).toBe(0);
    expect(sizeOf(readFileSync(out))).toEqual([320, 180]);
    expect(document(result)).toMatchObject({
      ok: true,
      summary: { errors: 1, warnings: 0, truncated: false },
    });
  });

  it("counts the scene's findings after the description, as text", async () => {
    const result = await runCli(
      ["frame", sceneFile, "--at", "1.4", "-o", path.join(folder, "b.png")],
      loading(broken),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.endsWith("\n\n1 error, 0 warnings\n")).toBe(true);
  });

  // R4
  it("overwrites the file -o names", async () => {
    const out = path.join(folder, "old.png");
    writeFileSync(out, "not a picture, and longer than nothing");
    const result = await runCli(
      ["frame", sceneFile, "--at", "0", "--out", out],
      loading(walk),
    );
    expect(result.exitCode).toBe(0);
    expect(sizeOf(readFileSync(out))).toEqual([320, 180]);
  });

  // R5
  it("prints the path written and the frame's state description", async () => {
    const out = path.join(folder, "sit.frame-45.png");
    const result = await runCli(["frame", sceneFile, "--at", "45f"], loading(walk));
    expect(
      result.stdout.startsWith(`wrote ${out}\nstate at 1.5 s (frame 45)\nrow 0\n`),
    ).toBe(true);
    expect(result.stdout).toContain(
      "  actor row0/actor/actor/0: facing right, pelvis (",
    );
    expect(result.stdout.endsWith("\n\n0 errors, 0 warnings\n")).toBe(true);
  });

  it("prints one JSON document with the path and the description under --json", async () => {
    const result = await runCli(
      ["frame", sceneFile, "--at", "45f", "--json"],
      loading(walk),
    );
    expect(result.stdout.trimEnd().includes("\n")).toBe(false);
    expect(document(result)).toMatchObject({
      version: 1,
      ok: true,
      paths: [path.join(folder, "sit.frame-45.png")],
      states: [{ frame: 45, time: 1.5, rows: [{ row: 0 }] }],
      summary: { errors: 0, warnings: 0, truncated: false },
    });
  });

  // R6
  it("writes frame 45 byte-identical to frame 45 of a loop over frames 0 to 45", async () => {
    const out = path.join(folder, "one.png");
    await runCli(["frame", sceneFile, "--at", "45f", "-o", out], loading(walk));

    let last: Buffer = Buffer.alloc(0);
    for (let frame = 0; frame <= 45; frame += 1) {
      last = await raster.png(walk.width, walk.height, (ctx) => {
        drawFrame(ctx, walk, frame);
      });
    }
    expect(readFileSync(out).equals(last)).toBe(true);
  });

  it.each([["4"], ["120f"]])(
    "accepts %s, the last frame of a 4 s scene",
    async (at) => {
      const result = await runCli(
        ["frame", sceneFile, "--at", at, "--json"],
        loading(walk),
      );
      expect(result.exitCode).toBe(0);
      expect(document(result).paths).toEqual([path.join(folder, "sit.frame-120.png")]);
    },
  );

  it("refuses 121f, a frame the 4 s scene does not have, and writes nothing", async () => {
    const out = path.join(folder, "none.png");
    const result = await runCli(
      ["frame", sceneFile, "--at", "121f", "-o", out, "--json"],
      loading(walk),
    );
    expect(result.exitCode).toBe(2);
    expect(document(result).error?.code).toBe("ERR_CLI_AT_PAST_END");
    expect(() => readFileSync(out)).toThrow();
  });

  it("refuses 1.5x with a usage error naming the three accepted forms", async () => {
    const result = await runCli(["frame", sceneFile, "--at", "1.5x", "--json"], {
      nodeVersion: "24.22.1",
      load: () => Promise.reject(new Error("the loader must not run")),
    });
    expect(result.exitCode).toBe(2);
    const { error } = document(result);
    expect(error?.code).toBe("ERR_CLI_INVALID_AT");
    expect(error?.fix).toContain("1.5 ");
    expect(error?.fix).toContain("1.5s");
    expect(error?.fix).toContain("45f");
  });

  it("refuses a time too large to compare with the timeline", async () => {
    const result = await runCli(
      ["frame", sceneFile, "--at", "9007199254740991", "--json"],
      loading(walk),
    );
    expect(result.exitCode).toBe(2);
    expect(document(result).error?.code).toBe("ERR_CLI_INVALID_AT");
  });

  it("reports a folder that does not exist with a code and a fix", async () => {
    const out = path.join(folder, "missing", "f.png");
    const result = await runCli(
      ["frame", sceneFile, "--at", "0", "-o", out],
      loading(walk),
    );
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^error ERR_RENDER_WRITE_FAILED: .+\n {2}fix: .+\n$/);
  });

  it("reports a missing rasteriser with its code", async () => {
    const result = await runCli(["frame", sceneFile, "--at", "0", "--json"], {
      ...loading(walk),
      raster: createRasteriser(() => Promise.reject(new Error("no binary"))),
    });
    expect(result.exitCode).toBe(2);
    expect(document(result).error?.code).toBe("ERR_ENV_SKIA_UNAVAILABLE");
  });

  it("reports a function that throws at the frame, pointing at check", async () => {
    const failing = scene({ duration: 2 }, (stage) => {
      stage.actor().drive(
        (t) => {
          if (t > 0.5) {
            throw new Error("late");
          }
          return { spine: 0.1 };
        },
        { duration: 2 },
      );
    });
    const result = await runCli(
      ["frame", sceneFile, "--at", "1", "--json"],
      loading(failing),
    );
    expect(result.exitCode).toBe(2);
    const { error } = document(result);
    expect(error?.code).toBe("ERR_SCENE_DRAWING_FAILED");
    expect(error?.fix).toContain(`check ${sceneFile}`);
  });

  it("lets an error that is not this package's own escape", async () => {
    const boom = new Error("disk on fire");
    await expect(
      runCli(["frame", sceneFile, "--at", "0"], {
        ...loading(walk),
        write: () => Promise.reject(boom),
      }),
    ).rejects.toBe(boom);
  });

  it("hands the bytes to an injected writer instead of the file system", async () => {
    const files: [string, [number, number]][] = [];
    const result = await runCli(["frame", "scenes/sit.ts", "--at", "1.5"], {
      ...loading(walk),
      write: (file, bytes) => {
        files.push([file, sizeOf(bytes)]);
        return Promise.resolve();
      },
    });
    expect(result.exitCode).toBe(0);
    expect(files).toEqual([[path.join("scenes", "sit.frame-45.png"), [320, 180]]]);
  });
});

describe("sheet", () => {
  it("draws twelve frames of 121, first and last included, on a sheet 1568 px wide", async () => {
    const result = await runCli(["sheet", sceneFile, "--json"], loading(walk));
    expect(result.exitCode).toBe(0);
    const { paths, states } = document(result);
    expect(paths).toEqual([path.join(folder, "sit.sheet.png")]);
    expect(states.map(({ frame }) => frame)).toEqual([
      0, 11, 22, 33, 44, 55, 65, 76, 87, 98, 109, 120,
    ]);
    // Four cells of 382 × 215 (16:9), three rows of 215 + 24 + 8, one gap above.
    expect(sizeOf(readFileSync(path.join(folder, "sit.sheet.png")))).toEqual([
      1568, 749,
    ]);
  });

  it("prints the path and one description per cell", async () => {
    const out = path.join(folder, "s.png");
    const result = await runCli(["sheet", sceneFile, "-o", out], loading(walk));
    expect(result.stdout.startsWith(`wrote ${out}\nstate at 0 s (frame 0)\n`)).toBe(
      true,
    );
    expect(result.stdout.match(/^state at /gm)).toHaveLength(12);
    expect(result.stdout).toContain("\n\nstate at 4 s (frame 120)\n");
  });

  it("gives the same bytes when run twice", async () => {
    const a = path.join(folder, "a.png");
    const b = path.join(folder, "b.png");
    await runCli(["sheet", sceneFile, "-o", a], loading(walk));
    await runCli(["sheet", sceneFile, "-o", b], loading(walk));
    expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
  });

  it("draws the times --times names, in time order, each once", async () => {
    const result = await runCli(
      ["sheet", sceneFile, "--times", "2,45f,1.5s,0", "--json"],
      loading(walk),
    );
    expect(document(result).states.map(({ frame }) => frame)).toEqual([0, 45, 60]);
    // Three columns of (1568 − 32) / 3 = 512 px.
    expect(sizeOf(readFileSync(path.join(folder, "sit.sheet.png")))).toEqual([
      1568,
      8 + 288 + 24 + 8,
    ]);
  });

  it("spreads twelve frames between --from and --to", async () => {
    const result = await runCli(
      ["sheet", sceneFile, "--from", "1", "--to", "63f", "--json"],
      loading(walk),
    );
    expect(document(result).states.map(({ frame }) => frame)).toEqual([
      30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63,
    ]);
  });

  it("takes --from alone to the last frame and --to alone from the first", async () => {
    const from = await runCli(
      ["sheet", sceneFile, "--from", "118f", "--json"],
      loading(walk),
    );
    expect(document(from).states.map(({ frame }) => frame)).toEqual([118, 119, 120]);
    const to = await runCli(
      ["sheet", sceneFile, "--to", "1f", "--json"],
      loading(walk),
    );
    expect(document(to).states.map(({ frame }) => frame)).toEqual([0, 1]);
  });

  it("draws one row alone with --row and describes that row only", async () => {
    const result = await runCli(
      ["sheet", sceneFile, "--row", "1", "--json"],
      loading(twoRows),
    );
    expect(result.exitCode).toBe(0);
    const { states } = document(result);
    expect(states).toHaveLength(12);
    expect(states.every(({ rows }) => rows.length === 1 && rows[0]?.row === 1)).toBe(
      true,
    );
    // A row of the 400 × 400 scene is 400 × 200: cells of 382 × 191.
    expect(sizeOf(readFileSync(path.join(folder, "sit.sheet.png")))).toEqual([
      1568,
      8 + 3 * (191 + 24 + 8),
    ]);
  });

  it("still writes the sheet and exits 0 for a scene with an error finding", async () => {
    const result = await runCli(["sheet", sceneFile, "--json"], loading(broken));
    expect(result.exitCode).toBe(0);
    expect(document(result).summary.errors).toBe(1);
    expect(sizeOf(readFileSync(path.join(folder, "sit.sheet.png")))[0]).toBe(1568);
  });

  it.each([
    {
      label: "a time past the end",
      flags: ["--times", "0,121f"],
      code: "ERR_CLI_AT_PAST_END",
    },
    {
      label: "a time that is not one",
      flags: ["--times", "0,,1"],
      code: "ERR_CLI_INVALID_AT",
    },
    { label: "--to past the end", flags: ["--to", "5"], code: "ERR_CLI_AT_PAST_END" },
    {
      label: "--from that is not a time",
      flags: ["--from", "-1"],
      code: "ERR_CLI_MISSING_VALUE",
    },
    {
      label: "--from spelled wrong",
      flags: ["--from", "1x"],
      code: "ERR_CLI_INVALID_AT",
    },
    {
      label: "--from after --to",
      flags: ["--from", "2", "--to", "1"],
      code: "ERR_CLI_INVALID_RANGE",
    },
    {
      label: "--times with --from",
      flags: ["--times", "1", "--from", "0"],
      code: "ERR_CLI_CONFLICTING_FLAGS",
    },
    {
      label: "--times with --to",
      flags: ["--times", "1", "--to", "2"],
      code: "ERR_CLI_CONFLICTING_FLAGS",
    },
    {
      label: "--row with --ghost",
      flags: ["--row", "0", "--ghost", "actor"],
      code: "ERR_CLI_CONFLICTING_FLAGS",
    },
    {
      label: "a row the scene lacks",
      flags: ["--row", "1"],
      code: "ERR_CLI_INVALID_ROW",
    },
    { label: "a fractional row", flags: ["--row", "0.5"], code: "ERR_CLI_INVALID_ROW" },
    {
      label: "a row past the safe integers",
      flags: ["--row", "9007199254740993"],
      code: "ERR_CLI_INVALID_ROW",
    },
    {
      label: "an actor the scene lacks",
      flags: ["--ghost", "ada"],
      code: "ERR_CLI_UNKNOWN_ACTOR",
    },
    {
      label: "more times than one image shows",
      flags: [
        "--times",
        Array.from({ length: 49 }, (_, i) => `${String(i)}f`).join(","),
      ],
      code: "ERR_CLI_TOO_MANY_TIMES",
    },
  ])("refuses $label with $code and writes nothing", async ({ flags, code }) => {
    const result = await runCli(
      ["sheet", sceneFile, ...flags, "--json"],
      loading(walk),
    );
    expect(result.exitCode).toBe(2);
    expect(document(result).error?.code).toBe(code);
    expect(() => readFileSync(path.join(folder, "sit.sheet.png"))).toThrow();
  });

  it("takes forty-eight times", async () => {
    const times = Array.from({ length: 48 }, (_, i) => `${String(i)}f`).join(",");
    const result = await runCli(
      ["sheet", sceneFile, "--times", times, "--json"],
      loading(walk),
    );
    expect(result.exitCode).toBe(0);
    expect(document(result).states).toHaveLength(48);
  });

  it("says there is no actor to choose when the scene has none", async () => {
    const empty = scene({ duration: 1 }, () => undefined);
    const result = await runCli(
      ["sheet", sceneFile, "--ghost", "a", "--json"],
      loading(empty),
    );
    expect(document(result).error?.code).toBe("ERR_CLI_UNKNOWN_ACTOR");
  });

  describe("of a scene with no length", () => {
    const endless = scene({ width: 320, height: 180 }, (stage) => {
      stage.actor().drive(() => ({ spine: 0.1 }));
    });

    it("has no frames to spread, and says to name them", async () => {
      const result = await runCli(["sheet", sceneFile, "--json"], loading(endless));
      expect(result.exitCode).toBe(2);
      expect(document(result).error?.code).toBe("ERR_CLI_NO_LENGTH");
    });

    it("draws the frames --times names", async () => {
      const result = await runCli(
        ["sheet", sceneFile, "--times", "0,500f", "--json"],
        loading(endless),
      );
      expect(result.exitCode).toBe(0);
      expect(document(result).states.map(({ frame }) => frame)).toEqual([0, 500]);
    });

    it("draws any frame with frame", async () => {
      const result = await runCli(
        ["frame", sceneFile, "--at", "500f", "--json"],
        loading(endless),
      );
      expect(result.exitCode).toBe(0);
      expect(document(result).paths).toEqual([path.join(folder, "sit.frame-500.png")]);
    });
  });
});

describe("sheet --ghost", () => {
  it("overlays eight ghosts of the actor on one image of its row", async () => {
    const result = await runCli(
      ["sheet", sceneFile, "--ghost", "ada", "--json"],
      loading(twoRows),
    );
    expect(result.exitCode).toBe(0);
    const { paths, states } = document(result);
    expect(paths).toEqual([path.join(folder, "sit.ghost.png")]);
    // 61 frames, 0 to 60: i × 60 / 7 to the nearest frame.
    expect(states.map(({ frame }) => frame)).toEqual([0, 9, 17, 26, 34, 43, 51, 60]);
    expect(states.every(({ rows }) => rows.length === 1 && rows[0]?.row === 0)).toBe(
      true,
    );
    // The row is 400 × 200: 1568 × 784, and 24 px of legend.
    expect(sizeOf(readFileSync(path.join(folder, "sit.ghost.png")))).toEqual([
      1568, 808,
    ]);
  });

  it("takes the actor's id, the times to draw and -o", async () => {
    const out = path.join(folder, "bob.png");
    const result = await runCli(
      ["sheet", sceneFile, "--ghost", "row1/actor/bob/0", "--times", "0,1", "-o", out],
      loading(twoRows),
    );
    expect(result.exitCode).toBe(0);
    expect(
      result.stdout.startsWith(`wrote ${out}\nstate at 0 s (frame 0)\nrow 1\n`),
    ).toBe(true);
    expect(sizeOf(readFileSync(out))).toEqual([1568, 808]);
  });
});
