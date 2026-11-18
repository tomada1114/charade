import { InvalidPathDataError } from "../errors.js";
import type { Point } from "../rig/kinematics.js";
import type { ShapeContext } from "./context.js";

/**
 * How {@link svgPath} places SVG path data in the row.
 *
 * @public
 */
export interface SvgPathOptions {
  /** Row units per SVG unit, `1` by default; a negative scale mirrors left to right. */
  readonly scale?: number;
  /**
   * The SVG point drawn at the context's origin, a prop's ground point; `(0, 0)` by
   * default. Give the shape's foot to stand it on the ground.
   */
  readonly origin?: Point;
}

/** A path call in SVG coordinates; `ellipse` holds the centre form of an arc. */
type Op =
  | ["moveTo" | "lineTo" | "bezierCurveTo" | "quadraticCurveTo", ...number[]]
  | ["closePath"]
  | ["ellipse", number, number, number, number, number, number, number];

const ARGS: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

/**
 * SVG's endpoint to centre parameterisation (SVG 2, B.2.4 and B.2.5): radii too small
 * are scaled up, a zero radius is a line, an arc ending at its start is left out.
 */
function arc(x1: number, y1: number, a: readonly number[]): Op | undefined {
  const [rx0 = 0, ry0 = 0, deg = 0, large = 0, sweepFlag = 0, x2 = 0, y2 = 0] = a;
  if (x1 === x2 && y1 === y2) return undefined;
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  if (rx === 0 || ry === 0) return ["lineTo", x2, y2];
  const phi = ((deg % 360) * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const xp = (cos * (x1 - x2) + sin * (y1 - y2)) / 2;
  const yp = (cos * (y1 - y2) - sin * (x1 - x2)) / 2;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const k =
    Math.sqrt(Math.max(0, (rx * rx * ry * ry - den) / den)) *
    (large === sweepFlag ? -1 : 1);
  const cxp = (k * rx * yp) / ry;
  const cyp = (-k * ry * xp) / rx;
  const ux = (xp - cxp) / rx;
  const uy = (yp - cyp) / ry;
  const vx = (-xp - cxp) / rx;
  const vy = (-yp - cyp) / ry;
  let sweep = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (sweepFlag === 0 && sweep > 0) sweep -= 2 * Math.PI;
  if (sweepFlag === 1 && sweep < 0) sweep += 2 * Math.PI;
  return [
    "ellipse",
    cos * cxp - sin * cyp + (x1 + x2) / 2,
    sin * cxp + cos * cyp + (y1 + y2) / 2,
    rx,
    ry,
    phi,
    Math.atan2(uy, ux),
    sweep,
  ];
}

/** Parses the whole string before any call, so a malformed one draws nothing. */
function parse(d: string): Op[] {
  let i = 0;
  const fail = (at: number): never => {
    throw new InvalidPathDataError(at);
  };
  const digit = (at: number): boolean => /\d/.test(d[at] ?? "");
  const wsp = (): void => {
    while (/[ \t\n\r\f]/.test(d[i] ?? "")) i += 1;
  };
  const commaWsp = (): boolean => {
    wsp();
    if (d[i] !== ",") return false;
    i += 1;
    wsp();
    return true;
  };
  const digits = (): number => {
    const from = i;
    while (digit(i)) i += 1;
    return i - from;
  };
  const number = (): number => {
    const from = i;
    if (d[i] === "-" || d[i] === "+") i += 1;
    let count = digits();
    if (d[i] === ".") {
      i += 1;
      count += digits();
    }
    if (count === 0) fail(from);
    const sign = d[i + 1] === "-" || d[i + 1] === "+" ? 1 : 0;
    if ((d[i] === "e" || d[i] === "E") && digit(i + 1 + sign)) {
      i += 1 + sign;
      digits();
    }
    const value = Number(d.slice(from, i));
    return Number.isFinite(value) ? value : fail(from);
  };
  const flag = (): number => {
    if (d[i] !== "0" && d[i] !== "1") fail(i);
    i += 1;
    return Number(d[i - 1]);
  };

  const ops: Op[] = [];
  let x = 0;
  let y = 0;
  let x0 = 0;
  let y0 = 0;
  // The control point S and T reflect, and the command family that set it.
  let cx = 0;
  let cy = 0;
  let last = "";
  wsp();
  if (i < d.length && d[i]?.toUpperCase() !== "M") fail(i);
  while (i < d.length) {
    const letter = d[i] ?? "";
    let command = letter.toUpperCase();
    const count = ARGS[command] ?? fail(i);
    const rel = letter === command ? 0 : 1;
    i += 1;
    wsp();
    if (count === 0) {
      ops.push(["closePath"]);
      [x, y, last] = [x0, y0, ""];
      continue;
    }
    for (;;) {
      const a: number[] = [];
      for (let k = 0; k < count; k += 1) {
        if (k > 0) commaWsp();
        a.push(command === "A" && (k === 3 || k === 4) ? flag() : number());
      }
      // Each argument made absolute: even ones by x, odd ones by y; H by x, V by y.
      const p = (k: number): number =>
        (a[k] ?? 0) +
        rel * (command === "V" || (command !== "H" && k % 2 === 1) ? y : x);
      const reflect = (family: string): [number, number] =>
        last === family ? [2 * x - cx, 2 * y - cy] : [x, y];
      let family = "";
      if (command === "M" || command === "L") {
        [x, y] = [p(0), p(1)];
        ops.push([command === "M" ? "moveTo" : "lineTo", x, y]);
        if (command === "M") [x0, y0, command] = [x, y, "L"];
      } else if (command === "H" || command === "V") {
        if (command === "H") x = p(0);
        else y = p(0);
        ops.push(["lineTo", x, y]);
      } else if (command === "C" || command === "S") {
        const [c1x, c1y] = command === "C" ? [p(0), p(1)] : reflect("C");
        const j = command === "C" ? 2 : 0;
        [cx, cy, x, y] = [p(j), p(j + 1), p(j + 2), p(j + 3)];
        ops.push(["bezierCurveTo", c1x, c1y, cx, cy, x, y]);
        family = "C";
      } else if (command === "Q" || command === "T") {
        [cx, cy] = command === "Q" ? [p(0), p(1)] : reflect("Q");
        const j = command === "Q" ? 2 : 0;
        [x, y] = [p(j), p(j + 1)];
        ops.push(["quadraticCurveTo", cx, cy, x, y]);
        family = "Q";
      } else {
        const [ex, ey] = [(a[5] ?? 0) + rel * x, (a[6] ?? 0) + rel * y];
        const op = arc(x, y, [...a.slice(0, 5), ex, ey]);
        if (op !== undefined) ops.push(op);
        [x, y] = [ex, ey];
      }
      last = family;
      const comma = commaWsp();
      if (!/[\d.+-]/.test(d[i] ?? "")) {
        if (comma) fail(i);
        break;
      }
    }
  }
  return ops;
}

/**
 * Adds the shape in an SVG path's `d` string to the context's current path.
 *
 * @remarks
 * It issues only `moveTo`, `lineTo`, `bezierCurveTo`, `quadraticCurveTo`, `ellipse` (for
 * `A`) and `closePath`, never `beginPath`, `fill` or `stroke`, so it composes with the
 * context's own calls like `ctx.rect`. It reads the whole path grammar, `M L H V C S Q T
 * A Z` in both cases; an empty string issues no call.
 *
 * SVG's `y` points down and the row's up, so an SVG point `(x, y)` is drawn at
 * `((x − origin.x) × scale, (origin.y − y) × |scale|)`, so a negative scale mirrors
 * the shape left to right and keeps it standing.
 *
 * @param ctx - The context to add the path to.
 * @param d - The value of an SVG `<path>`'s `d` attribute.
 * @param options - The scale, and the SVG point drawn at the context's origin.
 * @throws {@link InvalidPathDataError} when `d` does not parse, before any call.
 *
 * @example
 * ```ts
 * import type { ShapeContext } from "charade";
 *
 * // A leaf 100 units tall in an editor, its stem at (50, 100).
 * const LEAF = "M50 100 C0 60 20 10 50 0 C80 10 100 60 50 100 Z";
 *
 * function drawLeaf(ctx: ShapeContext): void {
 *   ctx.beginPath();
 *   svgPath(ctx, LEAF, { scale: 0.004, origin: { x: 50, y: 100 } });
 *   ctx.fill();
 * }
 * ```
 *
 * @public
 */
export function svgPath(ctx: ShapeContext, d: string, options?: SvgPathOptions): void {
  const s = options?.scale ?? 1;
  const size = Math.abs(s);
  const ox = options?.origin?.x ?? 0;
  const oy = options?.origin?.y ?? 0;
  for (const [call, ...v] of parse(d)) {
    const p = v.map((n, k) => (k % 2 === 0 ? (n - ox) * s : (oy - n) * size));
    if (call === "ellipse") {
      const [, , rx = 0, ry = 0, phi = 0, start = 0, sweep = 0] = v;
      // The y flip negates the rotation and the angles. A mirror on top of it is a half
      // turn of the SVG shape: the rotation is kept and the angles move by π.
      const mirrored = s < 0;
      const from = mirrored ? Math.PI + start : -start;
      const to = mirrored ? from + sweep : from - sweep;
      ctx.ellipse(
        p[0] ?? 0,
        p[1] ?? 0,
        size * rx,
        size * ry,
        mirrored ? phi : -phi,
        from,
        to,
        mirrored ? sweep < 0 : sweep > 0,
      );
    } else {
      const [a = 0, b = 0, c = 0, e = 0, f = 0, g = 0] = p;
      if (call === "moveTo") ctx.moveTo(a, b);
      else if (call === "lineTo") ctx.lineTo(a, b);
      else if (call === "quadraticCurveTo") ctx.quadraticCurveTo(a, b, c, e);
      else if (call === "bezierCurveTo") ctx.bezierCurveTo(a, b, c, e, f, g);
      else ctx.closePath();
    }
  }
}
