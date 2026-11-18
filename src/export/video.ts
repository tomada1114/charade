import { spawn as spawnChild } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { Readable, Writable } from "node:stream";

import { drawFrame } from "../draw/frame.js";
import { CharadeError } from "../errors.js";
import type { Scene } from "../scene/scene.js";
import { OutputWriteError } from "./images.js";
import type { Rasteriser } from "./raster.js";

/** The part of a spawned child process the encoder uses; a test passes a fake. */
export interface EncoderProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  on(event: "error", listener: (error: Error) => void): this;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  kill(signal?: NodeJS.Signals): boolean;
}

/** Starts a program from `PATH` with piped stdio and no shell. */
export type Spawn = (command: string, args: readonly string[]) => EncoderProcess;

/**
 * Calls `listener` synchronously when the process is interrupted, then lets the
 * interruption take its course; returns the function that stops listening.
 */
export type Interrupts = (listener: () => void) => () => void;

/** What encoding needs from outside the scene. */
export interface VideoEnvironment {
  readonly raster: Rasteriser;
  readonly spawn: Spawn;
  readonly interrupts: Interrupts;
  /** The operating system, as `process.platform` names it: it picks the install line. */
  readonly platform: string;
  /** Writes one progress line to stderr. */
  readonly notice: (line: string) => void;
}

export const spawnProcess: Spawn = (command, args) =>
  spawnChild(command, [...args], {
    stdio: "pipe",
    shell: false,
    windowsHide: true,
  });

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export const processInterrupts: Interrupts = (listener) => {
  const handler = (signal: NodeJS.Signals): void => {
    off();
    listener();
    // With this handler gone the default action applies: the process ends as if the
    // signal had never been caught.
    process.kill(process.pid, signal);
  };
  const off = (): void => {
    for (const signal of SIGNALS) {
      process.off(signal, handler);
    }
  };
  for (const signal of SIGNALS) {
    process.on(signal, handler);
  }
  return off;
};

const FFMPEG = "ffmpeg";

/** How to install an ffmpeg with libx264 on `platform`. */
export function installGuidance(platform: string): string {
  switch (platform) {
    case "darwin":
      return "Install ffmpeg with Homebrew: brew install ffmpeg.";
    case "win32":
      return "Install ffmpeg with winget: winget install --id Gyan.FFmpeg, then open a new terminal so it is on PATH.";
    case "linux":
      return "Install ffmpeg with the package manager: sudo apt install ffmpeg on Debian or Ubuntu, sudo dnf install ffmpeg from RPM Fusion on Fedora (Fedora's own ffmpeg-free has no libx264), sudo pacman -S ffmpeg on Arch.";
    default:
      return "Install an ffmpeg built with libx264 from https://ffmpeg.org/download.html and put it on PATH.";
  }
}

/** No `ffmpeg` was found on `PATH`. */
export class FfmpegMissingError extends CharadeError {
  readonly code = "ERR_ENV_FFMPEG_MISSING" as const;
  readonly fix: string;

  constructor(platform: string, cause: unknown) {
    super("render needs ffmpeg, and no ffmpeg was found on PATH.", { cause });
    this.fix = installGuidance(platform);
  }
}

/** `ffmpeg` was found but could not list its encoders. The failure is the `cause`. */
export class FfmpegUnusableError extends CharadeError {
  readonly code = "ERR_ENV_FFMPEG_UNUSABLE" as const;
  readonly fix: string;

  constructor(platform: string, cause: unknown, detail = "") {
    super(`The ffmpeg on PATH could not be run to list its encoders.${detail}`, {
      cause,
    });
    this.fix = `Check that ffmpeg -encoders runs in a terminal. ${installGuidance(platform)}`;
  }
}

/** The `ffmpeg` on `PATH` was built without the libx264 encoder. */
export class NoLibx264Error extends CharadeError {
  readonly code = "ERR_ENV_NO_LIBX264" as const;
  readonly fix: string;

  constructor(platform: string) {
    super("The ffmpeg on PATH has no libx264 encoder, which render uses for H.264.");
    this.fix = `Install an ffmpeg built with libx264. ${installGuidance(platform)}`;
  }
}

/** yuv420p stores colour per 2 × 2 pixels, so H.264 in it needs even dimensions. */
export class OddSizeError extends CharadeError {
  readonly code = "ERR_RENDER_ODD_SIZE" as const;
  readonly fix: string;

  /** Which dimension is odd. */
  readonly path: "width" | "height";

  constructor(path: "width" | "height") {
    super(`The scene's ${path} is odd; an H.264 video in yuv420p needs even sizes.`);
    this.path = path;
    this.fix = `Set the scene's ${path} to an even number of pixels.`;
  }
}

/** ffmpeg stopped taking frames before the last one was sent. */
export class EncoderClosedError extends CharadeError {
  readonly code = "ERR_RENDER_ENCODER_CLOSED" as const;
  readonly fix =
    "Run the render again; if it fails the same way, check that ffmpeg can write to the output's folder and has disk space.";

  /** Frames the scene has. */
  readonly expected: number;
  /** Frames handed to ffmpeg before it stopped. */
  readonly sent: number;

  constructor(expected: number, sent: number, detail: string, cause?: unknown) {
    super(
      `ffmpeg stopped reading frames after ${String(sent)} of ${String(expected)}.${detail}`,
      { cause },
    );
    this.expected = expected;
    this.sent = sent;
  }
}

/** ffmpeg took every frame but exited with a failure. */
export class EncoderFailedError extends CharadeError {
  readonly code = "ERR_RENDER_ENCODER_FAILED" as const;
  readonly fix =
    "Read ffmpeg's message above; check that the output's folder can be written to and has disk space.";

  /** ffmpeg's exit code, or `null` when it was ended by a signal or never started. */
  readonly exitCode: number | null;

  constructor(exitCode: number | null, detail: string, cause?: unknown) {
    super(
      `ffmpeg failed${exitCode === null ? "" : ` with exit code ${String(exitCode)}`}.${detail}`,
      { cause },
    );
    this.exitCode = exitCode;
  }
}

/** ffmpeg exited cleanly but did not encode exactly the scene's frames. */
export class FrameCountError extends CharadeError {
  readonly code = "ERR_RENDER_FRAME_COUNT" as const;
  readonly fix =
    "Run the render again; if the count is still short, report it with the scene file.";

  /** Frames the scene has. */
  readonly expected: number;
  /** Frames ffmpeg reported encoding, or `undefined` when it reported none. */
  readonly encoded: number | undefined;

  constructor(expected: number, encoded: number | undefined) {
    super(
      `The video holds ${encoded === undefined ? "an unknown number of" : String(encoded)} frames; the scene has ${String(expected)}.`,
    );
    this.expected = expected;
    this.encoded = encoded;
  }
}

/** The render was interrupted; the partial file was removed. */
export class RenderInterruptedError extends CharadeError {
  readonly code = "ERR_RENDER_INTERRUPTED" as const;
  readonly fix = "Run the render again and let it finish.";

  constructor() {
    super("The render was interrupted before the video was finished.");
  }
}

/** Where the video goes when `-o` names no path: next to the scene, as `<scene>.mp4`. */
export function videoBeside(sceneFile: string): string {
  const { dir, name } = path.parse(sceneFile);
  return path.join(dir, `${name}.mp4`);
}

/** @throws OddSizeError when either dimension is odd, width first. */
export function assertEvenSize(width: number, height: number): void {
  if (width % 2 !== 0) {
    throw new OddSizeError("width");
  }
  if (height % 2 !== 0) {
    throw new OddSizeError("height");
  }
}

interface Finished {
  readonly code: number | null;
  readonly error: Error | undefined;
}

/** Resolves once the child has closed or failed to start, whichever is first. */
function finished(child: EncoderProcess): Promise<Finished> {
  return new Promise((resolve) => {
    child.on("error", (error) => {
      resolve({ code: null, error });
    });
    child.on("close", (code) => {
      resolve({ code, error: undefined });
    });
  });
}

/** Keeps the last few kilobytes a stream writes, so a failure can quote ffmpeg. */
function tailOf(stream: Readable): () => string {
  let tail = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    tail = (tail + chunk).slice(-4096);
  });
  return () => {
    const last = tail.trim().split("\n").at(-1)?.trim() ?? "";
    return last === "" ? "" : ` ffmpeg said: ${last}`;
  };
}

const LIBX264 = /^\s*V\S*\s+libx264\s/m;

/**
 * Confirms that `ffmpeg` is on `PATH` and has libx264, by listing its encoders.
 *
 * @throws FfmpegMissingError, FfmpegUnusableError or NoLibx264Error.
 */
export async function findEncoder(spawn: Spawn, platform: string): Promise<void> {
  let child: EncoderProcess;
  try {
    child = spawn(FFMPEG, ["-hide_banner", "-encoders"]);
  } catch (error) {
    throw new FfmpegUnusableError(platform, error);
  }
  const done = finished(child);
  child.stdin.on("error", () => undefined);
  child.stdin.end();
  const said = tailOf(child.stderr);
  let listing = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    listing += chunk;
  });
  const { code, error } = await done;
  if (error !== undefined) {
    throw "code" in error && error.code === "ENOENT"
      ? new FfmpegMissingError(platform, error)
      : new FfmpegUnusableError(platform, error);
  }
  if (code !== 0) {
    throw new FfmpegUnusableError(platform, undefined, said());
  }
  if (!LIBX264.test(listing)) {
    throw new NoLibx264Error(platform);
  }
}

/** ffmpeg's arguments for raw RGBA frames on stdin to an H.264 MP4 at `file`. */
export function encodeArgs(
  width: number,
  height: number,
  fps: number,
  file: string,
): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostats",
    "-progress",
    "pipe:1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-video_size",
    `${String(width)}x${String(height)}`,
    "-framerate",
    String(fps),
    "-i",
    "pipe:0",
    "-an",
    "-vf",
    "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-color_range",
    "tv",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    "-y",
    file,
  ];
}

/** Reads ffmpeg's `-progress` lines and keeps the frame count of its final block. */
function progressOf(stream: Readable): () => number | undefined {
  let pending = "";
  let frame: number | undefined;
  let final: number | undefined;
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    const lines = (pending + chunk).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const [key, value] = line.trim().split("=", 2);
      if (key === "frame" && value !== undefined && /^\d+$/.test(value)) {
        frame = Number(value);
      } else if (key === "progress" && value === "end") {
        final = frame;
      }
    }
  });
  return () => final;
}

/** Resolves `true` on `drain`, `false` once the stream fails or the child is gone. */
function drained(stdin: Writable, gone: Promise<unknown>): Promise<boolean> {
  return new Promise((resolve) => {
    const settle = (ok: boolean): void => {
      stdin.off("drain", onDrain);
      stdin.off("error", onEnd);
      stdin.off("close", onEnd);
      resolve(ok);
    };
    const onDrain = (): void => {
      settle(true);
    };
    const onEnd = (): void => {
      settle(false);
    };
    stdin.on("drain", onDrain);
    stdin.on("error", onEnd);
    stdin.on("close", onEnd);
    void gone.then(onEnd);
  });
}

/** One video's size, rate, length and frames. */
interface Encoding {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: number;
  readonly frame: (n: number) => Promise<Buffer>;
}

/** Streams every frame to ffmpeg, which writes `file`; settles once ffmpeg has exited. */
async function stream(
  child: EncoderProcess,
  { width, height, frames, frame }: Encoding,
  notice: (line: string) => void,
): Promise<void> {
  const done = finished(child);
  // An object, so the compiler does not narrow a flag the callbacks set to its start.
  const state = { exited: false };
  void done.then(() => {
    state.exited = true;
  });
  let stdinError: Error | undefined;
  child.stdin.on("error", (error) => {
    stdinError ??= error;
  });
  const said = tailOf(child.stderr);
  const encoded = progressOf(child.stdout);
  const bytes = width * height * 4;
  const every = Math.max(1, Math.round(frames / 10));
  let sent = 0;
  let closedEarly = false;
  try {
    for (let n = 0; n < frames; n += 1) {
      const rgba = await frame(n);
      if (state.exited || stdinError !== undefined || child.stdin.destroyed) {
        closedEarly = true;
        break;
      }
      if (rgba.length !== bytes) {
        break;
      }
      const more = child.stdin.write(rgba);
      sent += 1;
      if (sent % every === 0 || sent === frames) {
        notice(`render: ${String(sent)}/${String(frames)} frames`);
      }
      if (!more && !(await drained(child.stdin, done)) && sent < frames) {
        closedEarly = true;
        break;
      }
    }
  } catch (error) {
    child.kill("SIGKILL");
    await done;
    throw error;
  }
  child.stdin.end();
  const { code, error } = await done;
  if (error !== undefined) {
    throw new EncoderFailedError(null, said(), error);
  }
  if (closedEarly || stdinError !== undefined) {
    throw new EncoderClosedError(frames, sent, said(), stdinError);
  }
  if (code !== 0) {
    throw new EncoderFailedError(code, said());
  }
  const count = encoded();
  if (sent !== frames || count !== frames) {
    throw new FrameCountError(frames, count);
  }
}

/** A name for the partial file, hidden, in the output's own folder. */
function temporaryBeside(out: string): string {
  const { dir, base } = path.parse(out);
  return path.join(dir, `.${base}.${randomBytes(6).toString("hex")}.partial`);
}

/**
 * Writes `scene` as an MP4 at `out`, through a partial file beside it that is renamed
 * on success and removed on failure or interrupt, so nothing partial is left at `out`.
 * Call {@link findEncoder} and {@link assertEvenSize} first.
 *
 * @returns The number of frames written.
 */
export async function writeVideo(
  scene: Scene,
  textFont: string,
  out: string,
  frames: number,
  environment: VideoEnvironment,
): Promise<number> {
  const { width, height } = scene;
  const { fps } = scene.timeline;
  const temp = temporaryBeside(out);
  let child: EncoderProcess | undefined;
  const run = { interrupted: false };
  // Listening before the partial file exists, so an interrupt during the open cannot
  // leave it behind.
  const stop = environment.interrupts(() => {
    run.interrupted = true;
    child?.kill("SIGKILL");
    try {
      rmSync(temp, { force: true });
    } catch {
      // Windows refuses to remove a file ffmpeg still holds open; the signal must
      // still be re-raised rather than end in an uncaught exception.
    }
  });
  try {
    try {
      await (await open(temp, "wx")).close();
    } catch (error) {
      throw new OutputWriteError(error);
    }
    try {
      child = environment.spawn(FFMPEG, encodeArgs(width, height, fps, temp));
    } catch (error) {
      throw new EncoderFailedError(null, "", error);
    }
    await stream(
      child,
      {
        width,
        height,
        fps,
        frames,
        frame: (n) =>
          environment.raster.rgba(width, height, (ctx) => {
            drawFrame(ctx, { ...scene, textFont }, n);
          }),
      },
      environment.notice,
    );
    if (run.interrupted) {
      throw new RenderInterruptedError();
    }
    try {
      await rename(temp, out);
    } catch (error) {
      throw new OutputWriteError(error);
    }
    return frames;
  } catch (error) {
    await rm(temp, { force: true });
    throw run.interrupted ? new RenderInterruptedError() : error;
  } finally {
    stop();
  }
}
