import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sampleImageName, selectItems } from "../src/check/catalog.js";
import { type CliOptions, type CliResult, runCli } from "../src/cli.js";
import { definitionsFrom } from "../src/export/loader.js";
import { createRasteriser } from "../src/export/raster.js";
import {
  type ActionDefinition,
  builtinActions,
  builtinBackdrops,
  builtinEffects,
  builtinExpressions,
  builtinProps,
  defineAction,
  defineBackdrop,
  defineExpression,
  defineProp,
  type Definition,
  type PropDefinition,
} from "../src/index.js";

interface Item {
  kind: string;
  name: string;
  description: string;
  params: Record<string, Record<string, unknown>>;
  marks: string[];
  moods: string[];
  sample: boolean;
}

interface Document {
  version: number;
  ok: boolean;
  items: Item[];
  rig?: {
    joints: { name: string; parent: string | null; min: number | null; max: number }[];
    root: string[];
    effectors: { name: string; chain: string[] }[];
    face: { name: string; min: number; max: number; rest: number }[];
    segments: Record<string, number>;
    conventions: Record<string, string>;
  };
  images?: { kind: string; name: string; path: string }[];
  error?: { code: string; fix: string; nearest?: string[] };
}

interface SamplesReport {
  ok: boolean;
  items: {
    kind: string;
    name: string;
    ok: boolean;
    findings: { code: string; severity: string }[];
    summary: { errors: number; warnings: number };
  }[];
  summary: { errors: number; warnings: number; truncated: boolean };
  error?: { code: string };
}

function one(result: CliResult): unknown {
  expect(result.stdout.trimEnd().includes("\n")).toBe(false);
  return JSON.parse(result.stdout);
}

const parsed = (result: CliResult): Document => one(result) as Document;

const samples = (result: CliResult): SamplesReport => one(result) as SamplesReport;

/** No loader, no rasteriser and no file system: a listing needs none of them. */
const bare: CliOptions = {
  nodeVersion: "24.22.1",
  load: () => Promise.reject(new Error("no scene is loaded")),
  loadDefinitions: () => Promise.reject(new Error("no module is loaded")),
  write: () => Promise.reject(new Error("nothing is written")),
  mkdir: () => Promise.reject(new Error("no folder is made")),
};

const waveParams = {
  side: {
    type: "enum",
    values: ["near", "far"],
    default: "near",
    doc: "Which arm waves.",
  },
  height: { type: "number", min: 0, doc: "How high the hand goes." },
  at_: { type: "point", default: { x: 0.5, y: 1 }, doc: "Where the hand ends." },
  word: { type: "text", default: "hi", doc: "What it mouths." },
  speed: { type: "number", default: 1, unit: "x", doc: "How fast." },
} as const;

const waveAction: ActionDefinition<typeof waveParams, "top"> = defineAction({
  name: "wave",
  description: "Waves one arm.",
  params: waveParams,
  marks: ["top"],
  build(clip) {
    clip.pose({ shoulderR: 2.5 }, { duration: 0.5 });
    clip.mark("top", 0.5);
  },
  sample(stage) {
    stage.actor().do(waveAction, { height: 1 });
  },
});

/** Its sample bends the knee backwards, past the limit. */
const kneelAction = defineAction({
  name: "kneel",
  description: "Bends a knee the wrong way.",
  build(clip) {
    clip.pose({ kneeR: -0.5 }, { duration: 0.5 });
  },
  sample(stage) {
    stage.actor().do(kneelAction);
  },
});

const pebbleProp: PropDefinition = defineProp({
  name: "pebble",
  description: "A pebble with no sample.",
  draw(ctx) {
    ctx.beginPath();
    ctx.arc(0, 0.02, 0.02, 0, Math.PI * 2);
    ctx.fill();
  },
});

/** A prop that shares its name with the action. */
const waveProp = defineProp({
  name: "wave",
  description: "A wave of water.",
  draw(ctx) {
    ctx.beginPath();
    ctx.arc(0, 0.1, 0.1, 0, Math.PI);
    ctx.stroke();
  },
  sample(stage) {
    stage.prop(waveProp, { duration: 0.5 });
  },
});

const brokenExpression = defineExpression({
  name: "broken",
  description: "Its sample throws.",
  build: () => ({ eyeOpen: 0 }),
  sample() {
    throw new Error("the sample is broken");
  },
});

function withDefinitions(
  definitions: readonly Definition[],
  more: CliOptions = {},
): { options: CliOptions; files: string[] } {
  const files: string[] = [];
  return {
    files,
    options: {
      ...bare,
      loadDefinitions: (file) => {
        files.push(file);
        return Promise.resolve(definitions);
      },
      ...more,
    },
  };
}

describe("catalog --json (R1)", () => {
  it("lists every built-in of the generated index with its kind beside its name", async () => {
    const result = await runCli(["catalog", "--json"], bare);
    expect(result.exitCode).toBe(0);
    const { version, ok, items } = parsed(result);
    expect([version, ok]).toEqual([1, true]);
    const index = [
      ["action", builtinActions],
      ["expression", builtinExpressions],
      ["prop", builtinProps],
      ["backdrop", builtinBackdrops],
      ["effect", builtinEffects],
    ] as const;
    expect(items.map(({ kind, name }) => `${kind} ${name}`)).toEqual(
      index.flatMap(([kind, map]) => Object.keys(map).map((name) => `${kind} ${name}`)),
    );
    expect(items.map(({ kind, name }) => `${kind} ${name}`)).toContain("prop ball");
    for (const item of items) {
      expect(item.description.length).toBeGreaterThan(20);
      expect(item.params).toBeTypeOf("object");
      expect(Array.isArray(item.marks) && Array.isArray(item.moods)).toBe(true);
      expect(item.sample).toBe(true);
    }
  });

  it("gives a parameter's type, default, range, unit and doc from the runtime spec", async () => {
    const { items } = parsed(await runCli(["catalog", "--json"], bare));
    const sitDown = items.find((item) => item.name === "sitDown");
    expect(sitDown?.params["seat"]).toMatchObject({
      type: "number",
      default: 0.26,
      min: 0.2,
      max: 0.4,
      unit: "units",
    });
    expect(sitDown?.params["seat"]?.["doc"]).toBeTypeOf("string");
  });

  it("gives an action's marks and the moods that change its body", async () => {
    const { items } = parsed(await runCli(["catalog", "--json"], bare));
    const thrown = items.find((item) => item.name === "throw");
    expect(thrown?.marks).toEqual(["release"]);
    expect(thrown?.moods).toEqual(["focused", "dejected"]);
    expect(thrown?.params["ball"]).toMatchObject({ type: "prop" });
    expect(thrown?.params["ball"]).not.toHaveProperty("default");
    expect(items.find((item) => item.name === "ball")?.marks).toEqual([]);
  });
});

describe("the rig listing (R2)", () => {
  it("lists the fourteen angles with their limits and parents", async () => {
    const { rig } = parsed(await runCli(["catalog", "--json"], bare));
    expect(rig?.joints.map(({ name, min, max }) => [name, min, max])).toEqual([
      ["pelvis", null, null],
      ["spine", -0.3, 0.9],
      ["chest", -0.3, 0.7],
      ["neck", -0.7, 0.9],
      ["shoulderL", -1, 3.1],
      ["shoulderR", -1, 3.1],
      ["elbowL", 0, 2.6],
      ["elbowR", 0, 2.6],
      ["hipL", -0.5, 2.1],
      ["hipR", -0.5, 2.1],
      ["kneeL", 0, 2.6],
      ["kneeR", 0, 2.6],
      ["ankleL", -0.6, 0.5],
      ["ankleR", -0.6, 0.5],
    ]);
    const parents = Object.fromEntries(
      rig?.joints.map(({ name, parent }) => [name, parent]) ?? [],
    );
    expect(parents).toMatchObject({
      pelvis: null,
      spine: "pelvis",
      shoulderR: "chest",
      elbowR: "shoulderR",
      hipL: "pelvis",
      ankleL: "kneeL",
    });
  });

  it("lists the four effectors with the angles reach sets, and the root offsets", async () => {
    const { rig } = parsed(await runCli(["catalog", "--json"], bare));
    expect(rig?.effectors).toEqual([
      { name: "handL", chain: ["shoulderL", "elbowL"] },
      { name: "handR", chain: ["shoulderR", "elbowR"] },
      { name: "footL", chain: ["hipL", "kneeL"] },
      { name: "footR", chain: ["hipR", "kneeR"] },
    ]);
    expect(rig?.root).toEqual(["pelvisX", "pelvisY"]);
  });

  it("lists the eight face channels with their ranges and rest values", async () => {
    const { rig } = parsed(await runCli(["catalog", "--json"], bare));
    expect(rig?.face.map(({ name, min, max, rest }) => [name, min, max, rest])).toEqual(
      [
        ["eyeOpen", 0, 1.5, 1],
        ["gazeX", -1, 1, 0],
        ["gazeY", -1, 1, 0],
        ["browHeight", -1, 1, 0],
        ["browTilt", -1, 1, 0],
        ["mouthCurve", -1, 1, 0],
        ["mouthOpen", 0, 1, 0],
        ["mouthWidth", 0.5, 1.5, 1],
      ],
    );
  });

  it("states the conventions: R nearer the camera, radians in flexion, y up, 1 unit tall", async () => {
    const { rig } = parsed(await runCli(["catalog", "--json"], bare));
    expect(rig?.conventions["facing"]).toMatch(
      /R is the limb nearer the camera in both facings/,
    );
    expect(rig?.conventions["angles"]).toMatch(/radians, relative to the parent joint/);
    expect(rig?.conventions["angles"]).toMatch(/positive in the direction .* flexes/);
    expect(rig?.conventions["space"]).toMatch(/y is up/);
    expect(rig?.conventions["space"]).toMatch(/standing figure is 1 unit tall/);
    // Ankle to head top: shin, thigh, spine, chest, neck, head.
    const { shin, thigh, spine, chest, neck, head } = rig?.segments ?? {};
    expect(
      (shin ?? 0) +
        (thigh ?? 0) +
        (spine ?? 0) +
        (chest ?? 0) +
        (neck ?? 0) +
        (head ?? 0),
    ).toBeCloseTo(1, 10);
  });

  it("prints the items and then the rig as text, with nothing on stderr", async () => {
    const result = await runCli(["catalog"], bare);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const { stdout } = result;
    expect(stdout).toContain("\naction sitDown — Sits down");
    expect(stdout).toContain("\n  seat: number, default 0.26, 0.2..0.4 units — ");
    expect(stdout).toContain("\n  ball: prop, required — ");
    expect(stdout).toContain("\n  to: point, default (1, 0) — ");
    expect(stdout).toContain('\n  color: color, default "#e4572e" — ');
    expect(stdout).toContain("\n  marks: release\n");
    expect(stdout).toContain("\n  moods that change the body: focused, dejected\n");
    const rig = stdout.indexOf("\nrig\n");
    expect(rig).toBeGreaterThan(stdout.indexOf("\nprop box — "));
    const section = stdout.slice(rig);
    expect(section).toMatch(/\n {4}kneeR +0\.\.2\.6 +hipR\n/);
    expect(section).toMatch(/\n {4}pelvis +no limit +root\n/);
    expect(section).toContain("\n    handR  shoulderR, elbowR\n");
    expect(section).toMatch(/\n {4}mouthWidth +0\.5\.\.1\.5 +rest 1 /);
    expect(section).toContain("R is the limb nearer the camera in both facings");
  });
});

describe("catalog <name>", () => {
  it("shows one item alone, without the rig", async () => {
    const result = await runCli(["catalog", "throw", "--json"], bare);
    const document = parsed(result);
    expect(document.items.map(({ kind, name }) => [kind, name])).toEqual([
      ["action", "throw"],
    ]);
    expect(document).not.toHaveProperty("rig");
    expect(document).not.toHaveProperty("images");
    expect((await runCli(["catalog", "throw"], bare)).stdout).not.toContain("\nrig\n");
  });

  it("takes <kind>.<name> as well", async () => {
    const { items } = parsed(await runCli(["catalog", "prop.ball", "--json"], bare));
    expect(items.map(({ kind, name }) => [kind, name])).toEqual([["prop", "ball"]]);
  });

  it("shows every kind's item for a name two kinds share, and one for <kind>.<name>", async () => {
    const { options } = withDefinitions([waveAction, waveProp, pebbleProp]);
    const both = parsed(
      await runCli(["catalog", "wave", "--defs", "m.ts", "--json"], options),
    );
    expect(both.items.map(({ kind, name }) => [kind, name])).toEqual([
      ["action", "wave"],
      ["prop", "wave"],
    ]);
    const one = parsed(
      await runCli(["catalog", "prop.wave", "--defs", "m.ts", "--json"], options),
    );
    expect(one.items.map(({ kind }) => kind)).toEqual(["prop"]);
  });

  it("reaches an item whose own name starts like a kind", () => {
    const dotted = defineProp({
      name: "prop.wave",
      description: "Named like a selector.",
      draw: () => undefined,
    });
    const selection = selectItems([waveProp, dotted], "prop.wave");
    expect(selection).toEqual({ kind: "found", definitions: [dotted] });
  });

  // R5
  it("exits 2 with an ERR_CLI_ code and the nearest name for a misspelt one", async () => {
    const result = await runCli(["catalog", "sitDwon"], bare);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("error ERR_CLI_UNKNOWN_ITEM: ");
    expect(result.stderr).toContain("sitDown");
  });

  it("carries the nearest names as data under --json", async () => {
    const result = await runCli(["catalog", "sitDwon", "--json"], bare);
    expect(result.exitCode).toBe(2);
    expect(parsed(result)).toMatchObject({
      ok: false,
      error: { code: "ERR_CLI_UNKNOWN_ITEM", nearest: ["action.sitDown"] },
    });
  });

  it.each([
    { label: "an unrelated word", name: "xylophone", nearest: [] },
    {
      label: "a misspelt name under the wrong kind",
      name: "prop.sitDwon",
      nearest: [],
    },
    {
      label: "a misspelt name under its kind",
      name: "prop.bal",
      nearest: ["prop.ball", "prop.box"],
    },
    { label: "different case", name: "SITDOWN", nearest: ["action.sitDown"] },
    { label: "an emoji", name: "🪨", nearest: [] },
  ])("lists $nearest as nearest for $label", async ({ name, nearest }) => {
    const result = await runCli(["catalog", name, "--json"], bare);
    expect(result.exitCode).toBe(2);
    expect(parsed(result).error).toMatchObject({
      code: "ERR_CLI_UNKNOWN_ITEM",
      nearest,
    });
  });

  it("names every kind that has the nearest name", async () => {
    const { options } = withDefinitions([waveAction, waveProp]);
    const result = await runCli(
      ["catalog", "wav", "--defs", "m.ts", "--json"],
      options,
    );
    expect(parsed(result).error?.nearest).toEqual(["action.wave", "prop.wave"]);
    expect(parsed(result).error?.fix).toContain("--defs m.ts");
  });
});

describe("a definitions module (R3)", () => {
  it("lists the module's items in place of the built-ins, without the rig", async () => {
    const { options, files } = withDefinitions([waveAction, pebbleProp]);
    const result = await runCli(["catalog", "--defs", "items.ts", "--json"], options);
    expect(result.exitCode).toBe(0);
    expect(files).toEqual(["items.ts"]);
    const document = parsed(result);
    expect(
      document.items.map(({ kind, name, sample }) => [kind, name, sample]),
    ).toEqual([
      ["action", "wave", true],
      ["prop", "pebble", false],
    ]);
    expect(document.items[0]?.marks).toEqual(["top"]);
    expect(document).not.toHaveProperty("rig");
  });

  it("prints every kind of parameter on one line each", async () => {
    const { options } = withDefinitions([waveAction, pebbleProp]);
    const { stdout } = await runCli(["catalog", "--defs", "items.ts"], options);
    expect(stdout).toContain("action wave — Waves one arm.\n");
    expect(stdout).toContain(
      '  side: enum (near | far), default "near" — Which arm waves.\n',
    );
    expect(stdout).toContain(
      "  height: number, required, 0.. — How high the hand goes.\n",
    );
    expect(stdout).toContain("  at_: point, default (0.5, 1) — Where the hand ends.\n");
    expect(stdout).toContain('  word: text, default "hi" — What it mouths.\n');
    expect(stdout).toContain("  speed: number, default 1, x — How fast.\n");
    expect(stdout).toContain("  marks: top\n  moods that change the body: none\n");
    expect(stdout).toContain("prop pebble — A pebble with no sample.\n\n");
    expect(stdout).toContain("\n  prop: stage.prop(");
    expect(stdout).not.toContain("\n  expression: ");
  });

  it("checks every sample, each under its item, and exits 1 on an error finding", async () => {
    const { options, files } = withDefinitions([waveAction, kneelAction]);
    const result = await runCli(["check", "--defs", "items.ts", "--json"], options);
    expect(files).toEqual(["items.ts"]);
    expect(result.exitCode).toBe(1);
    const report = samples(result);
    expect(report.ok).toBe(false);
    expect(report.items.map(({ kind, name, ok }) => [kind, name, ok])).toEqual([
      ["action", "wave", true],
      ["action", "kneel", false],
    ]);
    expect(report.items[1]?.findings.map(({ code }) => code)).toEqual([
      "ERR_CHECK_JOINT_LIMIT",
    ]);
    expect(report.summary).toEqual({ errors: 1, warnings: 0, truncated: false });
  });

  it("exits 0 when every sample is clean, as text with a total", async () => {
    const { options } = withDefinitions([waveAction, waveProp]);
    const result = await runCli(["check", "--defs", "items.ts"], options);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "action wave\n0 errors, 0 warnings\n\n" +
        "prop wave\n0 errors, 0 warnings\n\n" +
        "total: 0 errors, 0 warnings\n",
    );
  });

  it("warns about an item without a sample, which --strict fails", async () => {
    const { options } = withDefinitions([pebbleProp]);
    const lenient = await runCli(["check", "--defs", "items.ts", "--json"], options);
    expect(lenient.exitCode).toBe(0);
    expect(samples(lenient).items[0]?.findings).toMatchObject([
      { code: "ERR_DEFINE_NO_SAMPLE", severity: "warning" },
    ]);
    const strict = await runCli(
      ["check", "--defs", "items.ts", "--strict", "--json"],
      options,
    );
    expect(strict.exitCode).toBe(1);
    expect(samples(strict).ok).toBe(false);
  });

  it("checks the built-ins' samples through the same path without a finding", async () => {
    const { options } = withDefinitions([
      builtinActions.sitDown,
      builtinActions.slump,
      builtinActions.throw,
      builtinExpressions.dejected,
      builtinProps.box,
    ]);
    const result = await runCli(["check", "--defs", "items.ts", "--json"], options);
    expect(result.exitCode).toBe(0);
    expect(samples(result).summary.errors).toBe(0);
  });

  it("cannot run when a sample throws", async () => {
    const { options } = withDefinitions([brokenExpression]);
    for (const argv of [
      ["check", "--defs", "items.ts", "--json"],
      ["catalog", "--defs", "items.ts", "--images", "out", "--json"],
    ]) {
      const result = await runCli(argv, { ...options, mkdir: () => Promise.resolve() });
      expect(result.exitCode).toBe(2);
      expect(samples(result).error?.code).toBe("ERR_DEFINE_SAMPLE_FAILED");
    }
  });

  it("reports a module that cannot be loaded with the loader's code", async () => {
    const result = await runCli(["catalog", "--defs", "items.ts", "--json"], {
      ...bare,
      loadDefinitions: () => {
        definitionsFrom({});
        return Promise.resolve([]);
      },
    });
    expect(result.exitCode).toBe(2);
    expect(parsed(result).error?.code).toBe("ERR_LOAD_NO_DEFINITIONS");
  });

  it("rethrows what is not this package's error", async () => {
    await expect(runCli(["catalog", "--defs", "items.ts"], bare)).rejects.toThrow(
      "no module is loaded",
    );
  });

  it.each([
    {
      label: "a scene beside --defs",
      argv: ["check", "scene.ts", "--defs", "items.ts"],
      code: "ERR_CLI_UNEXPECTED_ARGUMENT",
    },
    {
      label: "--at with --defs",
      argv: ["check", "--defs", "items.ts", "--at", "1"],
      code: "ERR_CLI_CONFLICTING_FLAGS",
    },
    {
      label: "--defs without a module",
      argv: ["check", "--defs"],
      code: "ERR_CLI_MISSING_VALUE",
    },
    {
      label: "neither a scene nor --defs",
      argv: ["check"],
      code: "ERR_CLI_MISSING_SCENE",
    },
    {
      label: "--defs on a command that has none",
      argv: ["frame", "scene.ts", "--at", "0", "--defs", "items.ts"],
      code: "ERR_CLI_UNKNOWN_FLAG",
    },
  ])("rejects $label with $code", async ({ argv, code }) => {
    const result = await runCli([...argv, "--json"], bare);
    expect(result.exitCode).toBe(2);
    expect(parsed(result).error?.code).toBe(code);
  });
});

describe("definitionsFrom", () => {
  it("takes every export that is a definition, named or default, by kind", () => {
    const module = {
      pebbleProp,
      helper: () => 1,
      list: [waveAction],
      unfrozen: { ...pebbleProp },
      scene: { kind: "charade.scene" },
      nothing: null,
      default: waveAction,
    };
    expect(definitionsFrom(module)).toEqual([waveAction, pebbleProp]);
  });

  it("counts a definition exported twice once", () => {
    expect(definitionsFrom({ default: pebbleProp, pebbleProp })).toEqual([pebbleProp]);
  });

  it("keeps a backdrop and an expression", () => {
    const sky = defineBackdrop({
      name: "sky",
      description: "A sky.",
      draw: () => undefined,
    });
    expect(definitionsFrom({ sky, brokenExpression })).toEqual([brokenExpression, sky]);
  });

  it.each([
    ["an empty module", {}],
    ["a module of other things", { a: 1, b: Object.freeze({ kind: "action" }) }],
    ["not a module", undefined],
  ])("rejects %s with ERR_LOAD_NO_DEFINITIONS", (_label, module) => {
    expect(() => definitionsFrom(module)).toThrow(
      expect.objectContaining({ code: "ERR_LOAD_NO_DEFINITIONS" }),
    );
  });

  it("rejects two items of one kind under one name, carrying both", () => {
    const again = defineProp({
      name: "pebble",
      description: "Another pebble.",
      draw: () => undefined,
    });
    expect(() => definitionsFrom({ pebbleProp, again })).toThrow(
      expect.objectContaining({
        code: "ERR_LOAD_DUPLICATE_DEFINITION",
        kind: "prop",
        item: "pebble",
      }),
    );
  });
});

describe("catalog --images (R4)", () => {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  /** A PNG's width and height, read from its IHDR chunk. */
  function sizeOf(png: Buffer): [number, number] {
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  }

  // One rasteriser for the file: skia-canvas is loaded once.
  const raster = createRasteriser();
  const drawing: CliOptions = { nodeVersion: "24.22.1", raster };

  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), "charade-catalog-"));
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("writes one image per item, named by kind and name, into a folder it makes", async () => {
    const out = path.join(folder, "new", "samples");
    const result = await runCli(["catalog", "--images", out, "--json"], drawing);
    expect(result.exitCode).toBe(0);
    const names = [
      "action.sitDown.png",
      "action.slump.png",
      "action.throw.png",
      "expression.angry.png",
      "expression.dejected.png",
      "expression.focused.png",
      "expression.happy.png",
      "expression.neutral.png",
      "expression.surprised.png",
      "prop.ball.png",
      "prop.box.png",
    ];
    expect(readdirSync(out).sort()).toEqual(names);
    const document = parsed(result);
    expect(document.images?.map((image) => image.path)).toEqual(
      names.map((name) => path.join(out, name)),
    );
    expect(document.items).toHaveLength(11);
    // An action is a contact sheet; an expression is one frame at the sample's size.
    expect(sizeOf(readFileSync(path.join(out, "action.throw.png")))[0]).toBe(1568);
    expect(sizeOf(readFileSync(path.join(out, "expression.dejected.png")))).toEqual([
      1080, 1080,
    ]);
  });

  it("writes only the named item's image", async () => {
    const out = path.join(folder, "out");
    const result = await runCli(["catalog", "throw", "--images", `${out}/`], drawing);
    expect(result.exitCode).toBe(0);
    expect(readdirSync(out)).toEqual(["action.throw.png"]);
    expect(
      result.stdout.endsWith(`\nwrote ${path.join(out, "action.throw.png")}\n`),
    ).toBe(true);
  });

  it("draws an expression where its blend has arrived, not the resting face", async () => {
    const pngs: Buffer[] = [];
    for (const name of ["dejected", "neutral", "dejected"]) {
      const out = path.join(folder, String(pngs.length));
      await runCli(["catalog", `expression.${name}`, "--images", out], drawing);
      pngs.push(readFileSync(path.join(out, `expression.${name}.png`)));
    }
    expect(pngs[0]?.equals(pngs[2] ?? Buffer.alloc(0))).toBe(true);
    expect(pngs[0]?.equals(pngs[1] ?? Buffer.alloc(0))).toBe(false);
  });

  it("writes nothing and makes no folder without the flag", async () => {
    const result = await runCli(["catalog", "throw", "--json"], bare);
    expect(result.exitCode).toBe(0);
    expect(readdirSync(folder)).toEqual([]);
  });

  /** Records what would be written, in place of the file system. */
  function recording(): { options: CliOptions; made: string[]; files: string[] } {
    const made: string[] = [];
    const files: string[] = [];
    return {
      made,
      files,
      options: {
        ...drawing,
        mkdir: (dir) => {
          made.push(dir);
          return Promise.resolve();
        },
        write: (file) => {
          files.push(file);
          return Promise.resolve();
        },
      },
    };
  }

  it.each([
    { label: "alone", argv: ["catalog", "prop.ball", "--images"] },
    {
      label: "before another flag",
      argv: ["catalog", "prop.ball", "--images", "--json"],
    },
  ])("defaults to charade-catalog when --images stands $label", async ({ argv }) => {
    const { options, made, files } = recording();
    const result = await runCli(argv, options);
    expect(result.exitCode).toBe(0);
    expect(made).toEqual(["charade-catalog"]);
    expect(files).toEqual([path.join("charade-catalog", "prop.ball.png")]);
  });

  it("takes the folder inline, and reads what follows the flag as the folder", async () => {
    const { options, made } = recording();
    await runCli(["catalog", "prop.ball", "--images=a"], options);
    // A module without a sample: nothing is drawn, only the folder is made.
    await runCli(["catalog", "--defs", "m.ts", "--images", "pebble", "--json"], {
      ...options,
      loadDefinitions: () => Promise.resolve([pebbleProp]),
    });
    expect(made).toEqual(["a", "pebble"]);
  });

  it("leaves an item without a sample out of the images, not out of the listing", async () => {
    const { options, files } = recording();
    const result = await runCli(
      ["catalog", "--defs", "m.ts", "--images", "o", "--json"],
      {
        ...options,
        loadDefinitions: () => Promise.resolve([waveProp, pebbleProp]),
      },
    );
    const document = parsed(result);
    expect(document.items.map(({ name }) => name)).toEqual(["wave", "pebble"]);
    expect(document.images).toEqual([
      { kind: "prop", name: "wave", path: path.join("o", "prop.wave.png") },
    ]);
    expect(files).toEqual([path.join("o", "prop.wave.png")]);
  });

  it("keeps a name with a path separator inside the folder", () => {
    expect(sampleImageName({ kind: "prop", name: "../a b/石" })).toBe(
      "prop.___a_b__.png",
    );
    expect(sampleImageName({ kind: "action", name: "sit-down_2" })).toBe(
      "action.sit-down_2.png",
    );
  });

  it("cannot run when the folder cannot be made", async () => {
    await runCli(["catalog", "prop.ball", "--images", folder], drawing);
    const under = path.join(folder, "prop.ball.png", "inside");
    const result = await runCli(["catalog", "--images", under, "--json"], drawing);
    expect(result.exitCode).toBe(2);
    expect(parsed(result).error?.code).toBe("ERR_RENDER_WRITE_FAILED");
  });
});
