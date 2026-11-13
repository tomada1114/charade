/** How many units of height a row shows, at every row count. */
export const ROW_UNITS = 2.5;

/** How far the ground line sits above a row's lower edge, in units. */
export const GROUND_UNITS = 0.3;

/** Where one row sits on the canvas, in pixels, and how its units map to them. */
export interface RowLayout {
  /** The row's index; row 0 is the top. */
  readonly index: number;
  /** Canvas `y` of the row's upper edge, in pixels. */
  readonly top: number;
  /** The row's band height in pixels: the canvas height over the row count. */
  readonly height: number;
  /** The canvas width in pixels; every row spans it. */
  readonly width: number;
  /** Pixels per unit. */
  readonly scale: number;
  /** Canvas `y` of the ground line, in pixels. */
  readonly groundY: number;
  /** The visible width of the row, in units. */
  readonly units: number;
}

/**
 * The layout of row `index` on a `width` × `height` canvas split into `rows` rows,
 * stacked top to bottom. Each row shows {@link ROW_UNITS} units of height with its
 * ground line {@link GROUND_UNITS} above its lower edge.
 */
export function rowLayout(
  width: number,
  height: number,
  rows: number,
  index: number,
): RowLayout {
  const band = height / rows;
  const scale = band / ROW_UNITS;
  const top = band * index;
  return {
    index,
    top,
    height: band,
    width,
    scale,
    groundY: top + band - GROUND_UNITS * scale,
    units: width / scale,
  };
}

/**
 * The transform from row units (origin on the ground line at the row's centre, `y`
 * up) to canvas pixels (origin top left, `y` down), as `setTransform` arguments. The
 * `y` scale is negated, which is what turns `y` up into the canvas's `y` down.
 */
export function rowTransform(
  layout: RowLayout,
): readonly [number, number, number, number, number, number] {
  return [layout.scale, 0, 0, -layout.scale, layout.width / 2, layout.groundY];
}
