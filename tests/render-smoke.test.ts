import consoleModule from "node:console";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { main, readProbe, spawnTool } from "../scripts/render-smoke.mjs";

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | undefined;
}

type Spawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => SpawnResult;

const ok = (stdout = ""): SpawnResult => ({
  status: 0,
  stdout,
  stderr: "",
  error: undefined,
});

function startFailure(code: string): SpawnResult {
  const error: NodeJS.ErrnoException = new Error(`spawn ${code}`);
  error.code = code;
  return { status: null, stdout: "", stderr: "", error };
}

interface Stream {
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  nb_read_frames?: string;
}

/** What real ffprobe prints for the 2 s, 1080×1080, 30 fps sample. */
const GOOD_STREAM: Stream = {
  codec_name: "h264",
  pix_fmt: "yuv420p",
  width: 1080,
  height: 1080,
  nb_read_frames: "61",
};

function probeOutput(stream: Stream): string {
  return JSON.stringify({ programs: [], stream_groups: [], streams: [stream] });
}

/** A fake subprocess boundary: tools present, render succeeds, ffprobe prints `probe`. */
function fakeSpawn(
  overrides: { ffmpeg?: SpawnResult; ffprobeVersion?: SpawnResult } & {
    render?: SpawnResult;
    probe?: SpawnResult;
  } = {},
) {
  const scenes: string[] = [];
  const directories: string[] = [];
  const spawn = vi.fn<Spawn>((command, args, options) => {
    if (args.includes("-version")) {
      return (
        (command === "ffmpeg" ? overrides.ffmpeg : overrides.ffprobeVersion) ?? ok()
      );
    }
    if (command === "ffprobe") {
      return overrides.probe ?? ok(probeOutput(GOOD_STREAM));
    }
    directories.push(options.cwd);
    scenes.push(readFileSync(path.join(options.cwd, "sample.ts"), "utf8"));
    return overrides.render ?? ok("wrote sample.mp4\n0 errors, 0 warnings\n");
  });
  return { spawn, scenes, directories };
}

let cliDir: string;
let cli: string;
let errorSpy: MockInstance<typeof consoleModule.error>;

beforeEach(() => {
  cliDir = mkdtempSync(path.join(tmpdir(), "render-smoke-test-"));
  cli = path.join(cliDir, "cli.js");
  writeFileSync(cli, "");
  errorSpy = vi.spyOn(consoleModule, "error").mockImplementation(() => undefined);
  vi.spyOn(consoleModule, "log").mockImplementation(() => undefined);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  rmSync(cliDir, { recursive: true, force: true });
});

/** Every `ERR_…` code at the start of a line of what was printed on stderr. */
function stderrCodes(): string[] {
  const text = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
  return [...text.matchAll(/^(ERR_[A-Z_]+):/gm)].flatMap((match) => match[1] ?? []);
}

describe("render-smoke arguments", () => {
  it("rejects an option with exit 2 before spawning anything", () => {
    const { spawn } = fakeSpawn();

    expect(main(["--fps", "24"], spawn, cli)).toBe(2);
    expect(stderrCodes()).toEqual(["ERR_SMOKE_ARGUMENT"]);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("accepts the bare -- pnpm forwards", () => {
    const { spawn } = fakeSpawn();

    expect(main(["--"], spawn, cli)).toBe(0);
  });
});

describe("render-smoke without the tools", () => {
  it("fails with ERR_SMOKE_FFMPEG_MISSING and writes nothing when ffmpeg is absent", () => {
    const { spawn, directories } = fakeSpawn({ ffmpeg: startFailure("ENOENT") });

    expect(main([], spawn, cli)).toBe(1);
    expect(stderrCodes()).toEqual(["ERR_SMOKE_FFMPEG_MISSING"]);
    expect(spawn.mock.calls.map(([command]) => command)).toEqual(["ffmpeg"]);
    expect(directories).toEqual([]);
  });

  it("fails with ERR_SMOKE_FFPROBE_MISSING and writes nothing when ffprobe is absent", () => {
    const { spawn, directories } = fakeSpawn({
      ffprobeVersion: startFailure("ENOENT"),
    });

    expect(main([], spawn, cli)).toBe(1);
    expect(stderrCodes()).toEqual(["ERR_SMOKE_FFPROBE_MISSING"]);
    expect(spawn.mock.calls.map(([command]) => command)).toEqual(["ffmpeg", "ffprobe"]);
    expect(directories).toEqual([]);
  });

  it.each([
    ["a start failure other than ENOENT", startFailure("EACCES")],
    ["a non-zero exit", { status: 1, stdout: "", stderr: "broken", error: undefined }],
    ["no exit status", { status: null, stdout: "", stderr: "", error: undefined }],
  ])("reports ERR_SMOKE_TOOL_UNUSABLE on %s", (_label, result) => {
    const { spawn } = fakeSpawn({ ffmpeg: result });

    expect(main([], spawn, cli)).toBe(1);
    expect(stderrCodes()).toEqual(["ERR_SMOKE_TOOL_UNUSABLE"]);
  });

  it("fails with ERR_SMOKE_CLI_NOT_BUILT when dist/cli.js is missing", () => {
    const { spawn, directories } = fakeSpawn();

    expect(main([], spawn, path.join(cliDir, "absent.js"))).toBe(1);
    expect(stderrCodes()).toEqual(["ERR_SMOKE_CLI_NOT_BUILT"]);
    expect(directories).toEqual([]);
  });
});

describe("render-smoke against the probed video", () => {
  it("passes on h264, yuv420p, 1080x1080 and 61 frames for the 2 s 30 fps sample", () => {
    const { spawn, scenes } = fakeSpawn();

    expect(main([], spawn, cli)).toBe(0);
    expect(stderrCodes()).toEqual([]);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toContain('import { scene } from "charade";');
    expect(scenes[0]).toContain('{"width":1080,"height":1080,"fps":30,"duration":2}');
  });

  it("renders with the built CLI by Node, without NODE_OPTIONS, then counts frames", () => {
    vi.stubEnv("NODE_OPTIONS", "--import=./loader.mjs");
    const { spawn } = fakeSpawn();

    main([], spawn, cli);

    const render = spawn.mock.calls.find(([command]) => command === process.execPath);
    expect(render?.[1]).toEqual([cli, "render", "sample.ts", "--out", "sample.mp4"]);
    expect(render?.[2].env["NODE_OPTIONS"]).toBeUndefined();
    const probe = spawn.mock.calls.find(
      ([command, args]) => command === "ffprobe" && !args.includes("-version"),
    );
    expect(probe?.[1]).toContain("-count_frames");
    expect(probe?.[1].at(-1)).toBe(path.join(render?.[2].cwd ?? "", "sample.mp4"));
  });

  it("removes its folder afterwards", () => {
    const { spawn, directories } = fakeSpawn();

    main([], spawn, cli);

    expect(directories).toHaveLength(1);
    expect(existsSync(directories[0] ?? "")).toBe(false);
  });

  it.each([
    ["one frame fewer", "60"],
    ["one frame more", "62"],
    ["no frame count", undefined],
    ["a count that is not a whole number", "61.5"],
  ])("fails with ERR_SMOKE_VIDEO_FRAME_COUNT on %s", (_label, frames) => {
    const stream: Stream = { ...GOOD_STREAM };
    delete stream.nb_read_frames;
    if (frames !== undefined) {
      stream.nb_read_frames = frames;
    }
    const { spawn } = fakeSpawn({ probe: ok(probeOutput(stream)) });

    expect(main([], spawn, cli)).toBe(1);
    expect(stderrCodes()).toEqual(["ERR_SMOKE_VIDEO_FRAME_COUNT"]);
  });

  it.each([
    ["another codec", { codec_name: "hevc" }, "ERR_SMOKE_VIDEO_CODEC"],
    ["another pixel format", { pix_fmt: "yuv444p" }, "ERR_SMOKE_VIDEO_PIXEL_FORMAT"],
    ["another width", { width: 1078 }, "ERR_SMOKE_VIDEO_SIZE"],
    ["another height", { height: 1920 }, "ERR_SMOKE_VIDEO_SIZE"],
  ] as const)("fails on %s", (_label, change, code) => {
    const { spawn } = fakeSpawn({
      probe: ok(probeOutput({ ...GOOD_STREAM, ...change })),
    });

    expect(main([], spawn, cli)).toBe(1);
    expect(stderrCodes()).toEqual([code]);
  });

  it("reports every property that differs, not only the first", () => {
    const { spawn } = fakeSpawn({ probe: ok(probeOutput({})) });

    expect(main([], spawn, cli)).toBe(1);
    expect(stderrCodes()).toEqual([
      "ERR_SMOKE_VIDEO_CODEC",
      "ERR_SMOKE_VIDEO_PIXEL_FORMAT",
      "ERR_SMOKE_VIDEO_SIZE",
      "ERR_SMOKE_VIDEO_FRAME_COUNT",
    ]);
  });
});

describe("render-smoke when a step fails", () => {
  it.each([
    [
      "exits non-zero",
      { status: 2, stdout: "", stderr: "error ERR_X", error: undefined },
    ],
    [
      "prints only on stdout",
      { status: 1, stdout: "error", stderr: "", error: undefined },
    ],
    ["cannot start", startFailure("EACCES")],
  ])("reports ERR_SMOKE_RENDER_FAILED when the render %s", (_label, render) => {
    const { spawn } = fakeSpawn({ render });

    expect(main([], spawn, cli)).toBe(1);
    expect(stderrCodes()).toEqual(["ERR_SMOKE_RENDER_FAILED"]);
    expect(spawn.mock.calls.filter(([command]) => command === "ffprobe")).toHaveLength(
      1,
    );
  });

  it("keeps the error at the end of a long render stderr, not the progress before it", () => {
    const progress = Array.from(
      { length: 20 },
      (_, index) => `render: ${String(index * 3)}/61 frames`,
    );
    const stderr = [
      ...progress,
      "error ERR_RENDER_ENCODER_FAILED: boom",
      "fix: x",
    ].join("\n");
    const { spawn } = fakeSpawn({
      render: { status: 2, stdout: "", stderr, error: undefined },
    });

    expect(main([], spawn, cli)).toBe(1);
    const printed = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("ERR_RENDER_ENCODER_FAILED");
    expect(printed).not.toContain("render: 0/61 frames");
  });

  it.each([
    [
      "exits non-zero",
      { status: 1, stdout: "", stderr: "No such file", error: undefined },
    ],
    ["cannot start", startFailure("EACCES")],
  ])("reports ERR_SMOKE_PROBE_FAILED when ffprobe %s", (_label, probe) => {
    const { spawn } = fakeSpawn({ probe });

    expect(main([], spawn, cli)).toBe(1);
    expect(stderrCodes()).toEqual(["ERR_SMOKE_PROBE_FAILED"]);
  });

  it.each([
    ["text that is not JSON", "not json"],
    ["no streams", JSON.stringify({ streams: [] })],
    ["streams that are not a list", JSON.stringify({ streams: {} })],
    ["nothing", ""],
  ])("reports ERR_SMOKE_PROBE_UNREADABLE when ffprobe prints %s", (_label, stdout) => {
    const { spawn } = fakeSpawn({ probe: ok(stdout) });

    expect(main([], spawn, cli)).toBe(1);
    expect(stderrCodes()).toEqual(["ERR_SMOKE_PROBE_UNREADABLE"]);
  });

  it("reports ERR_SMOKE_UNEXPECTED when the boundary throws", () => {
    const spawn = vi.fn<Spawn>(() => {
      throw new Error("boom");
    });

    expect(main([], spawn, cli)).toBe(1);
    expect(stderrCodes()).toEqual(["ERR_SMOKE_UNEXPECTED"]);
  });
});

describe("readProbe", () => {
  it("reads the fields of ffprobe's first stream", () => {
    expect(readProbe(probeOutput(GOOD_STREAM))).toEqual({
      codec: "h264",
      pixelFormat: "yuv420p",
      width: 1080,
      height: 1080,
      frames: 61,
    });
  });

  it("treats a size written as a string as absent", () => {
    const text = JSON.stringify({ streams: [{ ...GOOD_STREAM, width: "1080" }] });

    expect(readProbe(text).width).toBeUndefined();
  });
});

describe("spawnTool", () => {
  it("captures a program's status and output without a shell", () => {
    const result = spawnTool(
      process.execPath,
      ["-e", "process.stdout.write('out'); process.exitCode = 3"],
      { cwd: cliDir, env: process.env },
    );

    expect(result).toMatchObject({ status: 3, stdout: "out", error: undefined });
  });

  it("reports a program that is not on PATH as ENOENT", () => {
    const result = spawnTool("charade-no-such-program", [], {
      cwd: cliDir,
      env: process.env,
    });

    expect(result.error?.code).toBe("ENOENT");
  });
});
