import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  drawGhosts,
  drawRowFrame,
  drawSheetLabels,
  ghostLayout,
  rowAspect,
  sheetLayout,
} from "../check/sheet.js";
import type { DrawingContext } from "../draw/context.js";
import { drawFrame, idOf } from "../draw/frame.js";
import { CharadeError } from "../errors.js";
import type { Scene } from "../scene/scene.js";
import type { TimelineTrack } from "../timeline/timeline.js";
import type { Rasteriser } from "./raster.js";

/** Writes a file, replacing one that is there; a test passes a fake. */
export type FileWriter = (file: string, bytes: Buffer) => Promise<void>;

/** What writing a check image needs from outside the scene. */
export interface ImageEnvironment {
  readonly raster: Rasteriser;
  readonly write: FileWriter;
}

/** The output file could not be written. The file system's error is the `cause`. */
export class OutputWriteError extends CharadeError {
  readonly code = "ERR_RENDER_WRITE_FAILED" as const;

  readonly fix =
    "Check that the output's folder exists and can be written to, or name another path with -o.";

  constructor(cause: unknown) {
    super("The output file could not be written.", { cause });
  }
}

/** Writes with `node:fs`, replacing an existing file. */
export const writeOutput: FileWriter = async (file, bytes) => {
  try {
    await writeFile(file, bytes);
  } catch (error) {
    throw new OutputWriteError(error);
  }
};

/**
 * Where a check image goes when `-o` names no path: next to the scene, named after
 * it, as `<scene>.<suffix>.png`.
 */
export function outputBeside(sceneFile: string, suffix: string): string {
  const { dir, name } = path.parse(sceneFile);
  return path.join(dir, `${name}.${suffix}.png`);
}

/** Writes frame `frame` of `scene` at the scene's own size. */
export async function writeFrameImage(
  scene: Scene,
  frame: number,
  out: string,
  { raster, write }: ImageEnvironment,
): Promise<void> {
  const png = await raster.png(scene.width, scene.height, (ctx) => {
    drawFrame(ctx, scene, frame);
  });
  await write(out, png);
}

/**
 * Writes a contact sheet of `frames`, each cell drawn at the cell's own size rather
 * than scaled down from the scene's, so lines keep their weight. With `row`, a cell
 * holds that row alone.
 */
export async function writeSheetImage(
  scene: Scene,
  frames: readonly number[],
  row: number | undefined,
  out: string,
  { raster, write }: ImageEnvironment,
): Promise<void> {
  const { timeline } = scene;
  const aspect =
    row === undefined
      ? scene
      : rowAspect(scene.width, scene.height, timeline.rows.length);
  const layout = sheetLayout(aspect.width, aspect.height, frames, timeline.fps);
  const parts = layout.cells.map(({ x, y, width, height, frame }) => ({
    x,
    y,
    width,
    height,
    draw:
      row === undefined
        ? (ctx: DrawingContext): void => {
            drawFrame(ctx, { width, height, timeline }, frame);
          }
        : (ctx: DrawingContext): void => {
            drawRowFrame(ctx, { width, height, timeline }, row, frame);
          },
  }));
  const png = await raster.composite(layout.width, layout.height, parts, (ctx) => {
    drawSheetLabels(ctx, layout);
  });
  await write(out, png);
}

/** Writes one actor's motion at `frames` overlaid on a single picture of its row. */
export async function writeGhostImage(
  scene: Scene,
  row: number,
  track: TimelineTrack,
  frames: readonly number[],
  out: string,
  { raster, write }: ImageEnvironment,
): Promise<void> {
  const { timeline } = scene;
  const aspect = rowAspect(scene.width, scene.height, timeline.rows.length);
  const layout = ghostLayout(aspect.width, aspect.height, idOf(row, track), frames);
  const png = await raster.png(layout.width, layout.height, (ctx) => {
    drawGhosts(ctx, timeline, row, track, frames, layout);
  });
  await write(out, png);
}
