import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { PassThrough, Writable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type CliOptions, type CliResult, runCli } from "../src/cli.js";
import {
  createRasteriser,
  InvalidCanvasSizeError,
  type Rasteriser,
} from "../src/export/raster.js";
import {
  type EncoderProcess,
  FfmpegMissingError,
  findEncoder,
  processInterrupts,
  type Spawn,
  spawnProcess,
} from "../src/export/video.js";
import { type Scene, scene } from "../src/index.js";

const WITH_X264 = [
  "Encoders:",
  " V..... = Video",
  " ------",
  " V....D libopenh264          OpenH264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)",
  " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)",
  " A....D aac                  AAC (Advanced Audio Coding)",
  "",
].join("\n");

const WITHOUT_X264 = [
  "Encoders:",
  " ------",
  " V....D libopenh264          OpenH264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)",
  " V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)",
  "",
].join("\n");

/** How the fake ffmpeg behaves when it encodes. */
interface EncodeBehaviour {
  /** Frames to leave out of the count it reports. */
  readonly drop?: number;
  /** Fail stdin with `EPIPE` once this many whole frames have arrived, then exit. */
  readonly closeAfter?: number;
  /** Its exit code once stdin ends. */
  readonly exitCode?: number;
  /** Whether it writes `-progress` lines at all. */
  readonly progress?: boolean;
  /** A line on stderr. */
  readonly stderr?: string;
  /** Called with the number of whole frames received so far. */
  readonly onFrame?: (received: number) => void;
}

interface FakeBehaviour {
  readonly missing?: boolean;
  readonly listing?: string;
  readonly probeExit?: number;
  readonly encode?: EncodeBehaviour;
}

/** An in-process ffmpeg: the one boundary a test replaces with a fake. */
class FakeChild extends EventEmitter implements EncoderProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  readonly signals: string[] = [];
  bytes = 0;
  private closed = false;

  constructor(stdin: (child: FakeChild) => Writable) {
    super();
    this.stdin = stdin(this);
  }

  /** Ends both output streams, then emits `close` once they have been read. */
  exit(code: number | null, signal: string | null = null): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    let open = 2;
    const ended = (): void => {
      open -= 1;
      if (open === 0) {
        this.emit("close", code, signal);
      }
    };
    this.stdout.on("end", ended);
    this.stderr.on("end", ended);
    this.stdout.end();
    this.stderr.end();
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    this.stdin.destroy();
    this.exit(null, signal);
    return true;
  }
}

interface Fake {
  readonly spawn: Spawn;
  readonly calls: (readonly string[])[];
  readonly children: FakeChild[];
}

function fakeFfmpeg(behaviour: FakeBehaviour = {}): Fake {
  const calls: (readonly string[])[] = [];
  const children: FakeChild[] = [];
  const spawn: Spawn = (command, args) => {
    expect(command).toBe("ffmpeg");
    calls.push(args);
    if (args.includes("-encoders")) {
      const child = new FakeChild(() => new PassThrough());
      children.push(child);
      setImmediate(() => {
        if (behaviour.missing === true) {
          const error = Object.assign(new Error("spawn ffmpeg ENOENT"), {
            code: "ENOENT",
          });
          child.emit("error", error);
          return;
        }
        child.stdout.write(behaviour.listing ?? WITH_X264);
        child.exit(behaviour.probeExit ?? 0);
      });
      return child;
    }
    const encode = behaviour.encode ?? {};
    const size = args[args.indexOf("-video_size") + 1] ?? "";
    const [width, height] = size.split("x").map(Number);
    const frameBytes = (width ?? 0) * (height ?? 0) * 4;
    const out = args.at(-1) ?? "";
    const child = new FakeChild(
      (self) =>
        new Writable({
          // Small, so the encoder has to wait for `drain`.
          highWaterMark: 1024,
          write(chunk: Buffer, _encoding, callback) {
            self.bytes += chunk.length;
            const received = Math.floor(self.bytes / frameBytes);
            encode.onFrame?.(received);
            if (encode.closeAfter !== undefined && received >= encode.closeAfter) {
              callback(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
              setImmediate(() => {
                self.exit(encode.exitCode ?? 0);
              });
              return;
            }
            setImmediate(callback);
          },
          final(callback) {
            const received = Math.floor(self.bytes / frameBytes);
            void writeFile(out, "fake mp4").then(() => {
              if (encode.stderr !== undefined) {
                self.stderr.write(`${encode.stderr}\n`);
              }
              if (encode.progress !== false) {
                const reported = received - (encode.drop ?? 0);
                self.stdout.write(`frame=0\nfps=0.0\nprogress=continue\n`);
                self.stdout.write(`frame=${String(reported)}\nprogress=end\n`);
              }
              callback();
              self.exit(encode.exitCode ?? 0);
            });
          },
        }),
    );
    children.push(child);
    return child;
  };
  return { spawn, calls, children };
}

const encodings = (fake: Fake): (readonly string[])[] =>
  fake.calls.filter((args) => !args.includes("-encoders"));

// One rasteriser for the file: skia-canvas is loaded once.
const raster = createRasteriser();

/** 1 s at 10 fps: 11 frames. */
const small = (options: { width?: number; height?: number } = {}): Scene =>
  scene({ duration: 1, fps: 10, width: 64, height: 36, ...options }, (stage) => {
    stage.actor().pose({ pelvisX: 0.2 }, { duration: 1 });
  });

/** The knee bends backwards past its limit: one error finding. */
const broken = scene({ duration: 1, fps: 10, width: 64, height: 36 }, (stage) => {
  stage
    .actor()
    .pose({ kneeR: -0.4 }, { at: 0.2, duration: 0.3, mode: "add", blend: 0 });
});

/** Walks out of the frame: a warning only. */
const leaving = scene({ duration: 1, fps: 10, width: 64, height: 36 }, (stage) => {
  stage.actor().pose({ pelvisX: 3 }, { at: 0.5, duration: 0.5 });
});

interface Document {
  version: number;
  ok: boolean;
  paths?: string[];
  findings?: { code: string; severity: string }[];
  summary?: { errors: number; warnings: number; truncated: boolean };
  error?: { code: string; message: string; fix: string };
}

function document(result: CliResult): Document {
  expect(result.stdout.trimEnd().includes("\n")).toBe(false);
  return JSON.parse(result.stdout) as Document;
}

let folder: string;
let sceneFile: string;

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), "charade-render-"));
  sceneFile = path.join(folder, "scene.ts");
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

interface Interrupt {
  readonly interrupts: NonNullable<CliOptions["interrupts"]>;
  fire(): void;
  listening(): boolean;
}

function fakeInterrupts(): Interrupt {
  let listener: (() => void) | undefined;
  return {
    interrupts: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    fire: () => {
      listener?.();
    },
    listening: () => listener !== undefined,
  };
}

function options(
  built: Scene,
  fake: Fake,
  extra: Partial<CliOptions> = {},
): CliOptions {
  return {
    nodeVersion: "24.22.1",
    load: () => Promise.resolve(built),
    raster,
    spawn: fake.spawn,
    interrupts: fakeInterrupts().interrupts,
    platform: "linux",
    ...extra,
  };
}

const render = (
  built: Scene,
  fake: Fake,
  extra?: Partial<CliOptions>,
  flags: string[] = [],
): Promise<CliResult> =>
  runCli(["render", sceneFile, ...flags], options(built, fake, extra));

describe("ffmpeg on this machine", () => {
  // R1
  it.each([
    ["darwin", "brew install ffmpeg"],
    ["win32", "winget install --id Gyan.FFmpeg"],
    ["linux", "sudo apt install ffmpeg"],
    ["freebsd", "https://ffmpeg.org/download.html"],
  ])(
    "exits 2 with install guidance for %s when ffmpeg is absent",
    async (platform, line) => {
      const fake = fakeFfmpeg({ missing: true });
      const result = await render(small(), fake, { platform }, ["--json"]);
      expect(result.exitCode).toBe(2);
      const { error } = document(result);
      expect(error?.code).toBe("ERR_ENV_FFMPEG_MISSING");
      expect(error?.fix).toContain(line);
      expect(encodings(fake)).toEqual([]);
      expect(readdirSync(folder)).toEqual([]);
    },
  );

  // R1
  it("exits 2 with install guidance when ffmpeg lacks libx264", async () => {
    const fake = fakeFfmpeg({ listing: WITHOUT_X264 });
    const result = await render(small(), fake, { platform: "darwin" }, ["--json"]);
    expect(result.exitCode).toBe(2);
    const { error } = document(result);
    expect(error?.code).toBe("ERR_ENV_NO_LIBX264");
    expect(error?.fix).toContain("brew install ffmpeg");
    expect(encodings(fake)).toEqual([]);
    expect(readdirSync(folder)).toEqual([]);
  });

  it("asks ffmpeg for its encoders without a banner", async () => {
    const fake = fakeFfmpeg({ listing: WITHOUT_X264 });
    await render(small(), fake);
    expect(fake.calls).toEqual([["-hide_banner", "-encoders"]]);
  });

  it("exits 2 when ffmpeg cannot list its encoders", async () => {
    const fake = fakeFfmpeg({ probeExit: 1 });
    const result = await render(small(), fake, {}, ["--json"]);
    expect(result.exitCode).toBe(2);
    expect(document(result).error?.code).toBe("ERR_ENV_FFMPEG_UNUSABLE");
    expect(readdirSync(folder)).toEqual([]);
  });

  it("exits 2 when ffmpeg is found but cannot be started", async () => {
    const result = await render(
      small(),
      {
        ...fakeFfmpeg(),
        spawn: () => {
          throw Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
        },
      },
      {},
      ["--json"],
    );
    expect(result.exitCode).toBe(2);
    expect(document(result).error?.code).toBe("ERR_ENV_FFMPEG_UNUSABLE");
  });

  it("reads a real spawn failure for a program not on PATH as missing", async () => {
    const absent: Spawn = (_command, args) =>
      spawnProcess("charade-test-no-such-ffmpeg", args);
    await expect(findEncoder(absent, "linux")).rejects.toBeInstanceOf(
      FfmpegMissingError,
    );
  });

  it("spawns a real program with piped stdio", async () => {
    const child = spawnProcess(process.execPath, ["-e", "process.stdout.write('ok')"]);
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    const code = await new Promise((resolve) => child.on("close", resolve));
    expect([code, out]).toEqual([0, "ok"]);
  });
});

describe("before the first frame", () => {
  // R2
  it("exits 1 on an error finding before spawning ffmpeg", async () => {
    const fake = fakeFfmpeg();
    const result = await render(broken, fake, {}, ["--json"]);
    expect(result.exitCode).toBe(1);
    const report = document(result);
    expect(report).toMatchObject({ version: 1, ok: false, paths: [] });
    expect(report.summary?.errors).toBeGreaterThan(0);
    expect(fake.calls).toEqual([]);
    expect(readdirSync(folder)).toEqual([]);
  });

  it("prints the error findings as check does", async () => {
    const result = await render(broken, fakeFfmpeg());
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/^error ERR_\w+: /);
    expect(result.stdout).toMatch(/1 error, 0 warnings\n$/);
  });

  it("exits 1 for a scene without a length", async () => {
    const fake = fakeFfmpeg();
    const result = await render(
      scene({ width: 64, height: 36 }, () => undefined),
      fake,
      {},
      ["--json"],
    );
    expect(result.exitCode).toBe(1);
    expect(document(result).findings?.map(({ code }) => code)).toContain(
      "ERR_SCENE_NO_DURATION",
    );
    expect(fake.calls).toEqual([]);
  });

  // R3
  it.each([
    ["width", { width: 1081 }],
    ["height", { height: 35 }],
  ])("stops on an odd %s before spawning ffmpeg", async (_dimension, size) => {
    const fake = fakeFfmpeg();
    const result = await render(small(size), fake, {}, ["--json"]);
    expect(result.exitCode).toBe(2);
    expect(document(result).error?.code).toBe("ERR_RENDER_ODD_SIZE");
    expect(fake.calls).toEqual([]);
    expect(readdirSync(folder)).toEqual([]);
  });

  it("names the width first when both are odd", async () => {
    const result = await render(small({ width: 63, height: 35 }), fakeFfmpeg(), {}, [
      "--json",
    ]);
    expect(document(result).error?.code).toBe("ERR_RENDER_ODD_SIZE");
    expect(document(result).error?.message).toContain("width");
  });

  it("fails with a write error, spawning no encoder, when the output folder is missing", async () => {
    const fake = fakeFfmpeg();
    const out = path.join(folder, "missing", "out.mp4");
    const result = await render(small(), fake, {}, ["-o", out, "--json"]);
    expect(result.exitCode).toBe(2);
    expect(document(result).error?.code).toBe("ERR_RENDER_WRITE_FAILED");
    expect(encodings(fake)).toEqual([]);
    expect(existsSync(path.join(folder, "missing"))).toBe(false);
  });
});

describe("encoding", () => {
  // R6
  it("renames the finished file to the output and leaves no temporary file", async () => {
    const fake = fakeFfmpeg();
    const result = await render(small(), fake);
    expect(result.exitCode).toBe(0);
    const out = path.join(folder, "scene.mp4");
    expect(result.stdout).toBe(`wrote ${out}\n0 errors, 0 warnings\n`);
    expect(readdirSync(folder)).toEqual(["scene.mp4"]);
    expect(readFileSync(out, "utf8")).toBe("fake mp4");
  });

  it("writes to a hidden temporary file beside the output, in an explicit container", async () => {
    const fake = fakeFfmpeg();
    await render(small(), fake);
    const [args] = encodings(fake);
    const temp = args?.at(-1) ?? "";
    expect(path.dirname(temp)).toBe(folder);
    expect(path.basename(temp)).toMatch(/^\.scene\.mp4\.[0-9a-f]{12}\.partial$/);
    expect(args?.slice(-4, -1)).toEqual(["-f", "mp4", "-y"]);
  });

  it("asks ffmpeg for raw RGBA in and H.264 yuv420p out", async () => {
    const fake = fakeFfmpeg();
    await render(small(), fake);
    const args = encodings(fake)[0] ?? [];
    const after = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
    expect(after("-f")).toBe("rawvideo");
    expect(after("-pix_fmt")).toBe("rgba");
    expect(after("-video_size")).toBe("64x36");
    expect(after("-framerate")).toBe("10");
    expect(after("-i")).toBe("pipe:0");
    expect(after("-c:v")).toBe("libx264");
    expect(args.lastIndexOf("yuv420p")).toBeGreaterThan(args.indexOf("libx264"));
    expect(after("-progress")).toBe("pipe:1");
  });

  it("overwrites an existing output", async () => {
    const out = path.join(folder, "scene.mp4");
    writeFileSync(out, "old");
    const result = await render(small(), fakeFfmpeg());
    expect(result.exitCode).toBe(0);
    expect(readFileSync(out, "utf8")).toBe("fake mp4");
    expect(readdirSync(folder)).toEqual(["scene.mp4"]);
  });

  it("writes where -o says", async () => {
    const out = path.join(folder, "other.mp4");
    const result = await render(small(), fakeFfmpeg(), {}, ["-o", out, "--json"]);
    expect(document(result)).toEqual({
      version: 1,
      ok: true,
      paths: [out],
      findings: [],
      summary: { errors: 0, warnings: 0, truncated: false },
    });
    expect(readdirSync(folder)).toEqual(["other.mp4"]);
  });

  it("streams 121 frames of 4 665 600 bytes for 4 s at 30 fps, 1080 × 1080", async () => {
    const solid: Rasteriser = {
      ...raster,
      rgba: (width, height) => Promise.resolve(Buffer.alloc(width * height * 4, 255)),
    };
    const fake = fakeFfmpeg();
    const fourSeconds = scene({ duration: 4 }, (stage) => {
      stage.actor().wait(4);
    });
    const result = await render(fourSeconds, fake, { raster: solid });
    expect(result.exitCode).toBe(0);
    const encoder = fake.children.at(-1);
    expect(encoder?.bytes).toBe(121 * 4_665_600);
  });

  it("renders a scene with only a warning and prints the warning", async () => {
    const result = await render(leaving, fakeFfmpeg());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^wrote .+scene\.mp4\nwarning ERR_\w+: /);
    expect(result.stdout).toMatch(/0 errors, 1 warning\n$/);
    expect(readdirSync(folder)).toEqual(["scene.mp4"]);
  });

  it("reports progress on stderr, not stdout", async () => {
    const result = await render(small(), fakeFfmpeg(), {}, ["--json"]);
    expect(result.stderr).toContain("render: 11/11 frames\n");
    expect(document(result).ok).toBe(true);
  });

  // R4
  it("fails when ffmpeg exits 0 having encoded fewer frames, and removes the temporary file", async () => {
    const fake = fakeFfmpeg({ encode: { drop: 1 } });
    const result = await render(small(), fake, {}, ["--json"]);
    expect(result.exitCode).toBe(2);
    expect(document(result).error?.code).toBe("ERR_RENDER_FRAME_COUNT");
    expect(readdirSync(folder)).toEqual([]);
  });

  it("fails when ffmpeg exits 0 without reporting a count", async () => {
    const result = await render(
      small(),
      fakeFfmpeg({ encode: { progress: false } }),
      {},
      ["--json"],
    );
    expect(document(result).error?.code).toBe("ERR_RENDER_FRAME_COUNT");
    expect(readdirSync(folder)).toEqual([]);
  });

  it("fails when a frame comes back the wrong size", async () => {
    let calls = 0;
    const short: Rasteriser = {
      ...raster,
      rgba: (width, height) => {
        calls += 1;
        return Promise.resolve(
          Buffer.alloc(width * height * 4 - (calls === 5 ? 4 : 0)),
        );
      },
    };
    const result = await render(small(), fakeFfmpeg(), { raster: short }, ["--json"]);
    expect(document(result).error?.code).toBe("ERR_RENDER_FRAME_COUNT");
    expect(readdirSync(folder)).toEqual([]);
  });

  // R5
  it.each([
    ["exits 0", 0],
    ["exits 1", 1],
  ])(
    "reports ffmpeg closing stdin early when it then %s, with no unhandled EPIPE",
    async (_label, exitCode) => {
      const fake = fakeFfmpeg({ encode: { closeAfter: 3, exitCode } });
      const result = await render(small(), fake, {}, ["--json"]);
      expect(result.exitCode).toBe(2);
      expect(document(result).error?.code).toBe("ERR_RENDER_ENCODER_CLOSED");
      expect(readdirSync(folder)).toEqual([]);
    },
  );

  it("reports ffmpeg failing after every frame, quoting its last line", async () => {
    const fake = fakeFfmpeg({
      encode: { exitCode: 1, stderr: "No space left on device" },
    });
    const result = await render(small(), fake, {}, ["--json"]);
    expect(result.exitCode).toBe(2);
    const { error } = document(result);
    expect(error?.code).toBe("ERR_RENDER_ENCODER_FAILED");
    expect(error?.message).toContain("No space left on device");
    expect(readdirSync(folder)).toEqual([]);
  });

  it("stops ffmpeg and removes the temporary file when drawing fails", async () => {
    let calls = 0;
    const failing: Rasteriser = {
      ...raster,
      rgba: (width, height, draw) => {
        calls += 1;
        return calls === 4
          ? Promise.reject(new InvalidCanvasSizeError("width"))
          : raster.rgba(width, height, draw);
      },
    };
    const fake = fakeFfmpeg();
    const result = await render(small(), fake, { raster: failing }, ["--json"]);
    expect(document(result).error?.code).toBe("ERR_RENDER_INVALID_SIZE");
    expect(fake.children.at(-1)?.signals).toEqual(["SIGKILL"]);
    expect(readdirSync(folder)).toEqual([]);
  });

  it("stops ffmpeg and removes the temporary file when interrupted", async () => {
    const interrupt = fakeInterrupts();
    const fake = fakeFfmpeg({
      encode: {
        onFrame: (received) => {
          if (received === 2) {
            interrupt.fire();
          }
        },
      },
    });
    const result = await render(small(), fake, { interrupts: interrupt.interrupts }, [
      "--json",
    ]);
    expect(result.exitCode).toBe(2);
    expect(document(result).error?.code).toBe("ERR_RENDER_INTERRUPTED");
    expect(fake.children.at(-1)?.signals).toEqual(["SIGKILL"]);
    expect(readdirSync(folder)).toEqual([]);
    expect(interrupt.listening()).toBe(false);
  });

  it("stops listening for interrupts once the video is written", async () => {
    const interrupt = fakeInterrupts();
    await render(small(), fakeFfmpeg(), { interrupts: interrupt.interrupts });
    expect(interrupt.listening()).toBe(false);
  });
});

describe("process interrupts", () => {
  it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
    "listens for %s until stopped",
    (signal) => {
      const before = process.listenerCount(signal);
      const stop = processInterrupts(() => undefined);
      expect(process.listenerCount(signal)).toBe(before + 1);
      stop();
      expect(process.listenerCount(signal)).toBe(before);
    },
  );
});
