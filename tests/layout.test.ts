import { describe, expect, it } from "vitest";

import { RecordingContext } from "../src/check/recorder.js";
import { drawFrame } from "../src/draw/frame.js";
import { rowLayout, rowTransform } from "../src/draw/layout.js";
import { scene } from "../src/index.js";

describe("R3: every row shows 2.5 units with its ground 0.3 units up", () => {
  it.each([
    // rows, px per row, px per unit, ground px above the row's lower edge, units wide
    [1, 1080, 432, 129.6, 2.5],
    [2, 540, 216, 64.8, 5],
    [3, 360, 144, 43.2, 7.5],
    [4, 270, 108, 32.4, 10],
  ])(
    "%i row(s) at 1080 × 1080: %f px per row, %f px per unit, ground %f px up",
    (rows, band, scale, ground, units) => {
      for (let index = 0; index < rows; index += 1) {
        const layout = rowLayout(1080, 1080, rows, index);
        expect(layout.height).toBeCloseTo(band, 9);
        expect(layout.scale).toBeCloseTo(scale, 9);
        expect(layout.top).toBeCloseTo(band * index, 9);
        expect(layout.top + layout.height - layout.groundY).toBeCloseTo(ground, 9);
        expect(layout.units).toBeCloseTo(units, 9);
      }
    },
  );

  it("maps row units to pixels with y flipped, the origin on the ground at the centre", () => {
    expect(rowTransform(rowLayout(1080, 1080, 1, 0))).toEqual([
      432,
      0,
      0,
      -432,
      540,
      expect.closeTo(950.4, 9),
    ]);
  });

  it("emits each row's clip band and transform when the last frame of 4 rows is drawn", () => {
    const built = scene({ rows: 4 }, (stage) => {
      for (let row = 0; row < 4; row += 1) {
        stage.row(row).actor().wait(1);
      }
    });
    const ctx = new RecordingContext();
    // 1 s at 30 fps: n = d × fps = 30 is the last frame.
    drawFrame(ctx, built, 30);
    const bands = ctx.log.filter((entry) => entry.call === "rect");
    const transforms = ctx.log.filter(
      (entry) => entry.call === "setTransform" && entry.args[0] !== 10000,
    );
    expect(bands.map((entry) => entry.args)).toEqual([
      [0, 0, 10800000, 2700000],
      [0, 2700000, 10800000, 2700000],
      [0, 5400000, 10800000, 2700000],
      [0, 8100000, 10800000, 2700000],
    ]);
    // Ground at 270 − 32.4 = 237.6 px below each row's top.
    expect(transforms.map((entry) => entry.args)).toEqual([
      [1080000, 0, 0, -1080000, 5400000, 2376000],
      [1080000, 0, 0, -1080000, 5400000, 5076000],
      [1080000, 0, 0, -1080000, 5400000, 7776000],
      [1080000, 0, 0, -1080000, 5400000, 10476000],
    ]);
  });

  it("puts the ground line of 1 row at 1080 px across its 2.5 units", () => {
    const built = scene((stage) => {
      stage.actor().wait(1);
    });
    const ctx = new RecordingContext();
    drawFrame(ctx, built, 30);
    expect(ctx.log).toContainEqual({
      call: "setTransform",
      args: [4320000, 0, 0, -4320000, 5400000, 9504000],
    });
    expect(ctx.log).toContainEqual({ call: "moveTo", args: [-12500, 0] });
    expect(ctx.log).toContainEqual({ call: "lineTo", args: [12500, 0] });
  });
});
