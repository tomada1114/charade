import type { Canvas } from "skia-canvas";

import type { DrawingContext } from "../draw/context.js";
import { PAPER } from "../draw/figure.js";
import { CharadeError } from "../errors.js";

/** The part of skia-canvas the rasteriser uses. */
export interface SkiaModule {
  readonly Canvas: typeof Canvas;
}

/** Imports skia-canvas; injectable so a test can stand in for a missing binary. */
export type SkiaLoader = () => Promise<SkiaModule>;

/** Draws one picture on a context. `drawFrame` bound to a scene and a frame is one. */
export type Drawing = (ctx: DrawingContext) => void;

/**
 * skia-canvas, or the native binary it loads from an optional
 * `@skia-canvas/<platform>` package, could not be loaded. The original error is the
 * `cause`; `fix` is the line the author acts on.
 */
export class SkiaUnavailableError extends CharadeError {
  readonly code = "ERR_ENV_SKIA_UNAVAILABLE" as const;

  readonly fix =
    "Reinstall charade with optional dependencies included (no --omit=optional or --no-optional), so the @skia-canvas package for this platform is installed. On Linux it needs glibc 2.28 or newer, or musl.";

  constructor(cause: unknown) {
    super("The rasteriser skia-canvas could not be loaded.", { cause });
  }
}

/** Turns a drawing into pixels on a fresh, opaque, CPU-rendered canvas. */
export interface Rasteriser {
  /** The picture as PNG bytes. */
  png(width: number, height: number, draw: Drawing): Promise<Buffer>;
  /** The picture as unpremultiplied RGBA, `width × height × 4` bytes, alpha 255. */
  rgba(width: number, height: number, draw: Drawing): Promise<Buffer>;
}

const importSkia: SkiaLoader = () => import("skia-canvas");

/**
 * A rasteriser that imports skia-canvas on its first use, not before, so a command
 * that never draws runs without the native binary.
 *
 * @throws `SkiaUnavailableError` from the first `png` or `rgba` when `load` rejects.
 */
export function createRasteriser(load: SkiaLoader = importSkia): Rasteriser {
  let skia: Promise<SkiaModule> | undefined;
  const loaded = (): Promise<SkiaModule> =>
    (skia ??= load().catch((error: unknown) => {
      throw new SkiaUnavailableError(error);
    }));

  const render = async (
    width: number,
    height: number,
    draw: Drawing,
    encode: (canvas: Canvas) => Promise<Buffer>,
  ): Promise<Buffer> => {
    const { Canvas: SkiaCanvas } = await loaded();
    // skia-canvas renders on the GPU by default where it can; the same scene has to
    // give the same bytes whether or not a GPU initialised.
    const canvas = new SkiaCanvas(width, height, { gpu: false });
    try {
      draw(canvas.getContext("2d"));
      return await encode(canvas);
    } finally {
      canvas.dispose();
    }
  };

  // The matte paints PAPER beneath anything the drawing left transparent, which
  // `reset()` or a drawing with no calls does, so every frame is opaque.
  return {
    png: (width, height, draw) =>
      render(width, height, draw, (canvas) => canvas.toBuffer("png", { matte: PAPER })),
    rgba: (width, height, draw) =>
      render(width, height, draw, (canvas) =>
        canvas.toBuffer("raw", { matte: PAPER, colorType: "rgba" }),
      ),
  };
}
