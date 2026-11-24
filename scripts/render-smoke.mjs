#!/usr/bin/env node
// Render a sample scene with the built CLI and a real ffmpeg, then read the
// video back with ffprobe. vitest only ever sees an injected fake encoder
// (.claude/rules/export.md § Testing), so this is the one place the real
// argument list meets a real libx264.
//
// The build happens in the package.json script that calls this one. A missing
// ffmpeg or ffprobe fails with a code rather than skipping: a smoke check that
// passes when it could not run proves nothing.
import { spawnSync } from "node:child_process";
import console from "node:console";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { isMain } from "./lib/is-main.mjs";
import { parseJson, readKey, readString } from "./lib/json.mjs";
import { repoRoot } from "./lib/node-tools.mjs";

const USAGE = `Usage: pnpm run render:smoke

Builds the package, renders a sample scene with dist/cli.js and a real ffmpeg,
and checks the video with ffprobe: H.264, yuv420p, the scene's size, and
duration × fps + 1 frames. Takes no options.

Exit codes:
  0  the video has the expected codec, pixel format, size and frame count
  1  a tool is missing, the render failed, or the video differs
  2  the arguments were wrong`;

/** The sample's settings, written into the scene and expected back from ffprobe. */
export const SAMPLE = Object.freeze({
  width: 1080,
  height: 1080,
  fps: 30,
  duration: 2,
});

const INSTALL =
  "install ffmpeg, which ships ffprobe (`sudo apt-get install ffmpeg` on Debian or " +
  "Ubuntu, `brew install ffmpeg` on macOS), then rerun `pnpm run render:smoke`.";

/**
 * @typedef {object} SpawnResult
 * @property {number | null} status
 * @property {string} stdout
 * @property {string} stderr
 * @property {NodeJS.ErrnoException | undefined} error
 */

/**
 * @typedef {(
 *   command: string,
 *   args: readonly string[],
 *   options: { cwd: string, env: NodeJS.ProcessEnv },
 * ) => SpawnResult} Spawn
 */

/** A failed check, already shaped for an agent to read. */
export class RenderSmokeError extends Error {
  /**
   * @param {string} code - Stable error code.
   * @param {object} detail - What went wrong.
   * @param {string} detail.what - The failed check, in one sentence.
   * @param {string} [detail.subject] - Command or file concerned.
   * @param {string} [detail.expected] - Expected value.
   * @param {string} [detail.actual] - Observed value.
   * @param {string} detail.next - The next safe command or edit.
   */
  constructor(code, detail) {
    const lines = [`${code}: ${detail.what}`];
    if (detail.subject !== undefined) {
      lines.push(`Subject: ${detail.subject}`);
    }
    if (detail.expected !== undefined) {
      lines.push(`Expected: ${detail.expected}`);
    }
    if (detail.actual !== undefined) {
      lines.push(`Actual: ${detail.actual}`);
    }
    lines.push(`Next: ${detail.next}`);
    super(lines.join("\n"));
    this.name = "RenderSmokeError";
    this.code = code;
  }
}

/**
 * Spawn a program without a shell and capture its output.
 *
 * @type {Spawn}
 */
export function spawnTool(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
}

/**
 * Truncate captured output so a failure message stays readable.
 *
 * The tail is kept: render prints its progress lines first and its error code and
 * fix line last, and ffmpeg's error is likewise its last line.
 *
 * @param {string} text - Captured stream.
 * @returns {string} At most the last dozen lines of it.
 */
function excerpt(text) {
  const trimmed = text.trim();
  if (trimmed === "") {
    return "<empty>";
  }
  const lines = trimmed.split("\n");
  return lines.length <= 12 ? trimmed : `…\n${lines.slice(-12).join("\n")}`;
}

/**
 * Reject every option: the sample is fixed so a run is a function of this file.
 *
 * @param {readonly string[]} argv - Arguments after the script path.
 * @returns {void}
 * @throws {RenderSmokeError} On any argument other than pnpm's `--`.
 */
export function parseArguments(argv) {
  const extra = argv.filter((argument) => argument !== "--");
  if (extra.length > 0) {
    throw new RenderSmokeError("ERR_SMOKE_ARGUMENT", {
      what: "render:smoke takes no options.",
      actual: extra.join(" "),
      next: `run \`pnpm run render:smoke\` with no arguments.\n\n${USAGE}`,
    });
  }
}

/**
 * Confirm one program starts, by name on `PATH`, the way the render finds ffmpeg.
 *
 * @param {Spawn} spawn - The subprocess boundary.
 * @param {"ffmpeg" | "ffprobe"} tool - Program to look for.
 * @returns {void}
 * @throws {RenderSmokeError} `ERR_SMOKE_FFMPEG_MISSING` / `ERR_SMOKE_FFPROBE_MISSING`
 * when it is not on `PATH`, `ERR_SMOKE_TOOL_UNUSABLE` when it does not run.
 */
export function requireTool(spawn, tool) {
  const result = spawn(tool, ["-hide_banner", "-version"], {
    cwd: repoRoot,
    env: process.env,
  });
  if (result.error?.code === "ENOENT") {
    throw new RenderSmokeError(
      tool === "ffmpeg" ? "ERR_SMOKE_FFMPEG_MISSING" : "ERR_SMOKE_FFPROBE_MISSING",
      {
        what: `${tool} is not on PATH, so the real-encoder smoke check cannot run.`,
        subject: `${tool} -version`,
        next: INSTALL,
      },
    );
  }
  if (result.error !== undefined || result.status !== 0) {
    throw new RenderSmokeError("ERR_SMOKE_TOOL_UNUSABLE", {
      what: `${tool} is on PATH but did not run.`,
      subject: `${tool} -version`,
      expected: "exit 0",
      actual:
        result.error === undefined
          ? `exit ${String(result.status)}\n${excerpt(result.stderr)}`
          : result.error.message,
      next: `check that \`${tool} -version\` runs in this shell, or ${INSTALL}`,
    });
  }
}

/**
 * The sample scene's source. Erasable syntax only, as a user's scene would be.
 *
 * @returns {string}
 */
export function sampleSceneSource() {
  return `import { scene } from "charade";

export default scene(${JSON.stringify(SAMPLE)}, (stage) => {
  stage.row(0).actor({ name: "hero" });
});
`;
}

/**
 * @typedef {object} VideoStream
 * @property {string | undefined} codec
 * @property {string | undefined} pixelFormat
 * @property {number | undefined} width
 * @property {number | undefined} height
 * @property {number | undefined} frames - Frames ffprobe decoded.
 */

/**
 * Read the first video stream out of `ffprobe -of json`.
 *
 * @param {string} text - ffprobe's stdout.
 * @returns {VideoStream}
 * @throws {RenderSmokeError} `ERR_SMOKE_PROBE_UNREADABLE` when there is no stream.
 */
export function readProbe(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = parseJson(text);
  } catch {
    parsed = undefined;
  }
  const streams = readKey(parsed, "streams");
  const stream = Array.isArray(streams)
    ? /** @type {unknown} */ (streams[0])
    : undefined;
  if (typeof stream !== "object" || stream === null) {
    throw new RenderSmokeError("ERR_SMOKE_PROBE_UNREADABLE", {
      what: "ffprobe printed no video stream.",
      expected: '{ "streams": [ { "codec_name": … } ] }',
      actual: excerpt(text),
      next: "run the ffprobe command in Subject by hand on a rendered video.",
    });
  }
  const width = readKey(stream, "width");
  const height = readKey(stream, "height");
  const frames = readString(stream, "nb_read_frames");
  return {
    codec: readString(stream, "codec_name"),
    pixelFormat: readString(stream, "pix_fmt"),
    width: typeof width === "number" ? width : undefined,
    height: typeof height === "number" ? height : undefined,
    frames: frames !== undefined && /^\d+$/.test(frames) ? Number(frames) : undefined,
  };
}

/**
 * Compare a probed stream with the sample.
 *
 * @param {VideoStream} stream - What ffprobe reported.
 * @returns {RenderSmokeError[]} One error per property that differs; empty on a pass.
 */
export function verifyStream(stream) {
  const next =
    "compare the encoder arguments in src/export/video.ts with " +
    ".claude/rules/export.md § Encoding, then rerun `pnpm run render:smoke`.";
  const expectedFrames = SAMPLE.duration * SAMPLE.fps + 1;
  /** @type {RenderSmokeError[]} */
  const problems = [];
  if (stream.codec !== "h264") {
    problems.push(
      new RenderSmokeError("ERR_SMOKE_VIDEO_CODEC", {
        what: "The rendered video is not H.264.",
        expected: "h264",
        actual: String(stream.codec),
        next,
      }),
    );
  }
  if (stream.pixelFormat !== "yuv420p") {
    problems.push(
      new RenderSmokeError("ERR_SMOKE_VIDEO_PIXEL_FORMAT", {
        what: "The rendered video is not yuv420p.",
        expected: "yuv420p",
        actual: String(stream.pixelFormat),
        next,
      }),
    );
  }
  if (stream.width !== SAMPLE.width || stream.height !== SAMPLE.height) {
    problems.push(
      new RenderSmokeError("ERR_SMOKE_VIDEO_SIZE", {
        what: "The rendered video is not the scene's size.",
        expected: `${String(SAMPLE.width)}x${String(SAMPLE.height)}`,
        actual: `${String(stream.width)}x${String(stream.height)}`,
        next,
      }),
    );
  }
  if (stream.frames !== expectedFrames) {
    problems.push(
      new RenderSmokeError("ERR_SMOKE_VIDEO_FRAME_COUNT", {
        what: "The rendered video does not hold duration × fps + 1 frames.",
        expected: `${String(expectedFrames)} (${String(SAMPLE.duration)} s × ${String(SAMPLE.fps)} fps + 1)`,
        actual: String(stream.frames),
        next,
      }),
    );
  }
  return problems;
}

/**
 * Render the sample in `directory` and probe the result.
 *
 * @param {Spawn} spawn - The subprocess boundary.
 * @param {string} cli - Path of the built CLI.
 * @param {string} directory - An empty folder for the scene and the video.
 * @returns {VideoStream}
 * @throws {RenderSmokeError} When the render or the probe fails.
 */
export function renderAndProbe(spawn, cli, directory) {
  const scenePath = path.join(directory, "sample.ts");
  const videoPath = path.join(directory, "sample.mp4");
  writeFileSync(scenePath, sampleSceneSource());

  // No loader the caller's shell registers may stand in for type stripping.
  const env = { ...process.env };
  delete env["NODE_OPTIONS"];
  const renderArgs = [cli, "render", "sample.ts", "--out", "sample.mp4"];
  console.log("render-smoke: charade render sample.ts --out sample.mp4");
  const render = spawn(process.execPath, renderArgs, { cwd: directory, env });
  if (render.error !== undefined || render.status !== 0) {
    throw new RenderSmokeError("ERR_SMOKE_RENDER_FAILED", {
      what: "The built CLI could not render the sample scene.",
      subject: "charade render sample.ts --out sample.mp4",
      expected: "exit 0",
      actual:
        render.error === undefined
          ? `exit ${String(render.status)}\n${excerpt(render.stderr || render.stdout)}`
          : render.error.message,
      next: "fix the error code the CLI printed, then rerun `pnpm run render:smoke`.",
    });
  }
  process.stdout.write(render.stdout);

  const probeArgs = [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-count_frames",
    "-show_entries",
    "stream=codec_name,pix_fmt,width,height,nb_read_frames",
    "-of",
    "json",
    videoPath,
  ];
  console.log("render-smoke: ffprobe -count_frames sample.mp4");
  const probe = spawn("ffprobe", probeArgs, { cwd: directory, env: process.env });
  if (probe.error !== undefined || probe.status !== 0) {
    throw new RenderSmokeError("ERR_SMOKE_PROBE_FAILED", {
      what: "ffprobe could not read the rendered video.",
      subject: `ffprobe ${probeArgs.slice(0, -1).join(" ")} sample.mp4`,
      expected: "exit 0",
      actual:
        probe.error === undefined
          ? `exit ${String(probe.status)}\n${excerpt(probe.stderr)}`
          : probe.error.message,
      next: "check that render wrote sample.mp4, then rerun `pnpm run render:smoke`.",
    });
  }
  return readProbe(probe.stdout);
}

/**
 * Run the smoke check as a command.
 *
 * @param {readonly string[]} argv - Arguments after the script path.
 * @param {Spawn} [spawn] - The subprocess boundary; tests pass a fake.
 * @param {string} [cli] - Path of the built CLI.
 * @returns {number} Process exit code.
 */
export function main(
  argv,
  spawn = spawnTool,
  cli = path.join(repoRoot, "dist", "cli.js"),
) {
  try {
    parseArguments(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  /** @type {string | undefined} */
  let directory;
  try {
    // Both tools before anything is written, so a bare machine leaves no trace.
    requireTool(spawn, "ffmpeg");
    requireTool(spawn, "ffprobe");

    if (!existsSync(cli)) {
      throw new RenderSmokeError("ERR_SMOKE_CLI_NOT_BUILT", {
        what: "The built CLI is missing.",
        expected: "dist/cli.js",
        actual: "path is absent",
        next: "run `pnpm run render:smoke`, which builds first, rather than the script alone.",
      });
    }

    directory = mkdtempSync(path.join(tmpdir(), "charade-render-smoke-"));
    const problems = verifyStream(renderAndProbe(spawn, cli, directory));
    if (problems.length > 0) {
      console.error(problems.map((problem) => problem.message).join("\n\n"));
      return 1;
    }
    const frames = SAMPLE.duration * SAMPLE.fps + 1;
    console.log(
      `render-smoke: ok — h264, yuv420p, ${String(SAMPLE.width)}x${String(SAMPLE.height)}, ${String(frames)} frames`,
    );
    return 0;
  } catch (error) {
    if (error instanceof RenderSmokeError) {
      console.error(error.message);
      return 1;
    }
    console.error(
      `ERR_SMOKE_UNEXPECTED: ${error instanceof Error ? error.message : String(error)}\n` +
        "Next: inspect the output above, then rerun `pnpm run render:smoke`.",
    );
    return 1;
  } finally {
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
