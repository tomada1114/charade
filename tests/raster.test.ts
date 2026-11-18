import { describe, expect, it } from "vitest";

import type { DrawingContext } from "../src/draw/context.js";
import { drawFrame } from "../src/draw/frame.js";
import {
  createRasteriser,
  InvalidCanvasSizeError,
  SkiaUnavailableError,
} from "../src/export/raster.js";
import { scene } from "../src/index.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function rest() {
  return scene((stage) => {
    stage.actor().wait(1);
  });
}

function pixel(rgba: Buffer, width: number, x: number, y: number): number[] {
  const at = (y * width + x) * 4;
  return [...rgba.subarray(at, at + 4)];
}

function alphas(rgba: Buffer): Set<number> {
  const seen = new Set<number>();
  for (let i = 3; i < rgba.length; i += 4) {
    seen.add(rgba[i] ?? -1);
  }
  return seen;
}

const nothing = (): void => undefined;

describe("rasterising", () => {
  it("gives identical PNG bytes for the same frame rendered twice", async () => {
    const raster = createRasteriser();
    const source = rest();
    const draw = (ctx: DrawingContext): void => {
      drawFrame(ctx, source, 15);
    };

    const first = await raster.png(source.width, source.height, draw);
    const second = await raster.png(source.width, source.height, draw);

    expect([...first.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(first.equals(second)).toBe(true);
  });

  // 1080 × 1080, one row: 432 px a unit (1080 / 2.5), the ground at y 950.4 (1080 −
  // 0.3 × 432), the row's centre at x 540. The rest head is centred 0.91 units up with
  // a radius of 0.09, so its top is at y 950.4 − 1.0 × 432 = 518.4, stroked 10.8 px
  // wide (0.025 × 432): pixel (540, 518) lies a full 5 px inside the outline's stroke.
  it("draws ink on the rest figure's head outline and background in a corner", async () => {
    const source = rest();
    const rgba = await createRasteriser().rgba(source.width, source.height, (ctx) => {
      drawFrame(ctx, source, 0);
    });

    expect(pixel(rgba, source.width, 540, 518)).toEqual([0x11, 0x11, 0x11, 255]);
    expect(pixel(rgba, source.width, 2, 2)).toEqual([255, 255, 255, 255]);
  });

  it("gives width × height × 4 RGBA bytes with every alpha 255", async () => {
    const source = rest();
    const rgba = await createRasteriser().rgba(source.width, source.height, (ctx) => {
      drawFrame(ctx, source, 0);
    });

    expect(rgba.length).toBe(4_665_600);
    expect(alphas(rgba)).toEqual(new Set([255]));
  });

  it("gives 16 bytes of background for a 2 × 2 drawing with no calls", async () => {
    const rgba = await createRasteriser().rgba(2, 2, nothing);

    expect([...rgba]).toEqual(
      Array.from({ length: 4 }, () => [255, 255, 255, 255]).flat(),
    );
  });

  it("stays opaque where the drawing leaves the canvas transparent", async () => {
    const rgba = await createRasteriser().rgba(4, 4, (ctx) => {
      ctx.reset();
      ctx.fillStyle = "rgba(0, 0, 0, 0)";
      ctx.fillRect(0, 0, 4, 4);
    });

    expect(alphas(rgba)).toEqual(new Set([255]));
  });

  it("creates every canvas with GPU rendering off", async () => {
    const options: unknown[] = [];
    const { Canvas } = await import("skia-canvas");
    const raster = createRasteriser(() =>
      Promise.resolve({
        Canvas: class extends Canvas {
          constructor(width?: number, height?: number, opts?: { gpu?: boolean }) {
            super(width, height, opts);
            options.push(opts);
            expect(this.gpu).toBe(false);
          }
        },
      }),
    );

    await raster.png(2, 2, nothing);
    await raster.rgba(2, 2, nothing);

    expect(options).toEqual([{ gpu: false }, { gpu: false }]);
  });
});

describe("compositing", () => {
  it("draws each part on a canvas of its own and the overlay on top", async () => {
    const sizes: (readonly [number | undefined, number | undefined])[] = [];
    const { Canvas } = await import("skia-canvas");
    const raster = createRasteriser(() =>
      Promise.resolve({
        Canvas: class extends Canvas {
          constructor(width?: number, height?: number, opts?: { gpu?: boolean }) {
            super(width, height, opts);
            sizes.push([width, height]);
            expect(this.gpu).toBe(false);
          }
        },
      }),
    );
    const order: string[] = [];
    const part = (name: string, x: number) => ({
      x,
      y: 1,
      width: 3,
      height: 2,
      draw: (ctx: DrawingContext): void => {
        order.push(name);
        // A frame drawing resets its context; that must not reach the other parts.
        ctx.reset();
        ctx.fillStyle = "#111111";
        ctx.fillRect(0, 0, 3, 2);
      },
    });

    const png = await raster.composite(10, 4, [part("a", 1), part("b", 6)], () => {
      order.push("over");
    });
    const again = await raster.composite(10, 4, [part("a", 1), part("b", 6)], nothing);

    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([10, 4]);
    expect(png.equals(again)).toBe(true);
    expect(order).toEqual(["a", "b", "over", "a", "b"]);
    expect(sizes.slice(0, 3)).toEqual([
      [10, 4],
      [3, 2],
      [3, 2],
    ]);
  });

  it("differs from the bare paper once a part is drawn", async () => {
    const raster = createRasteriser();
    const blank = await raster.composite(4, 4, [], nothing);
    const inked = await raster.composite(
      4,
      4,
      [
        {
          x: 0,
          y: 0,
          width: 2,
          height: 2,
          draw: (ctx) => {
            ctx.fillStyle = "#111111";
            ctx.fillRect(0, 0, 2, 2);
          },
        },
      ],
      nothing,
    );
    expect(blank.equals(inked)).toBe(false);
  });

  it.each([
    ["the sheet", 0, 2],
    ["a part", 4, 0],
  ] as const)(
    "rejects a bad size for %s before loading skia-canvas",
    async (_, width, part) => {
      let loads = 0;
      const raster = createRasteriser(() => {
        loads += 1;
        return import("skia-canvas");
      });
      const failure = raster.composite(
        width,
        4,
        [{ x: 0, y: 0, width: 2, height: part, draw: nothing }],
        nothing,
      );
      await expect(failure).rejects.toMatchObject({ code: "ERR_RENDER_INVALID_SIZE" });
      expect(loads).toBe(0);
    },
  );
});

describe("a missing native binary", () => {
  const missing = Object.assign(new Error("Cannot find module '@skia-canvas/test'"), {
    code: "MODULE_NOT_FOUND",
  });

  it.each([
    ["png", (r: ReturnType<typeof createRasteriser>) => r.png(2, 2, nothing)],
    ["rgba", (r: ReturnType<typeof createRasteriser>) => r.rgba(2, 2, nothing)],
  ])(
    "fails the first %s with ERR_ENV_SKIA_UNAVAILABLE and a fix line",
    async (_, run) => {
      const raster = createRasteriser(() => Promise.reject(missing));

      const error: unknown = await run(raster).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SkiaUnavailableError);
      expect(error).toMatchObject({ code: "ERR_ENV_SKIA_UNAVAILABLE", cause: missing });
      expect((error as SkiaUnavailableError).fix).not.toBe("");
    },
  );

  it("does not load skia-canvas until the first drawing is rasterised", async () => {
    let calls = 0;
    const raster = createRasteriser(() => {
      calls += 1;
      return Promise.reject(missing);
    });
    expect(calls).toBe(0);

    await expect(raster.png(2, 2, nothing)).rejects.toThrow(SkiaUnavailableError);
    await expect(raster.rgba(2, 2, nothing)).rejects.toThrow(SkiaUnavailableError);

    expect(calls).toBe(1);
  });
});

describe("canvas size", () => {
  it.each([
    ["width", 0, 2],
    ["width", -1, 2],
    ["width", 2.5, 2],
    ["width", Number.NaN, 2],
    ["height", 2, 0],
    ["height", 2, Number.POSITIVE_INFINITY],
  ] as const)(
    "rejects a %s of %s before loading skia-canvas",
    async (path, width, height) => {
      let loads = 0;
      const rasteriser = createRasteriser(() => {
        loads += 1;
        return import("skia-canvas");
      });
      const failure = rasteriser.rgba(width, height, () => undefined);
      await expect(failure).rejects.toBeInstanceOf(InvalidCanvasSizeError);
      await expect(failure).rejects.toMatchObject({
        code: "ERR_RENDER_INVALID_SIZE",
        path,
      });
      expect(loads).toBe(0);
    },
  );
});
