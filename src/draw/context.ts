// Membership follows `.claude/rules/engine.md` § The drawing interface: every standard
// Canvas 2D member whose arguments and results are numbers, strings, booleans, or this
// package's own handles. Left out, with the reason where the rule alone does not say:
//
// - `drawImage`, `createPattern`, `imageSmoothingEnabled`, `imageSmoothingQuality`: bitmap
//   images and patterns; the two smoothing properties only govern how an image is
//   resampled.
// - `getImageData`, `putImageData`, `createImageData`: pixel readback and `ImageData`.
// - `canvas`, `getContextAttributes`: the back-reference to the canvas and its settings.
// - The `Path2D` overloads of `fill`, `stroke` and `clip`, `drawFocusIfNeeded`, and the
//   `DOMMatrix` forms of `setTransform`/`getTransform`: host objects.
// - `isPointInPath`, `isPointInStroke`: a hit test the recording context cannot answer
//   without a rasteriser's geometry.
// - `isContextLost`, `fontVariantCaps`: skia-canvas does not implement them, so its context
//   could not be handed over as this interface.

/**
 * A gradient created by a drawing context, used as a fill or stroke style.
 *
 * @remarks
 * An opaque handle: the only thing a drawing does with one is add colour stops and assign
 * it to `fillStyle` or `strokeStyle` of the context that created it.
 *
 * @public
 */
export interface Gradient {
  /**
   * Adds a colour stop.
   *
   * @param offset - Where the stop sits along the gradient, from 0 to 1.
   * @param color - A CSS colour.
   */
  addColorStop(offset: number, color: string): void;
}

/**
 * The measurements of a piece of text, as `measureText` returns them.
 *
 * @remarks
 * Distances are in the context's current units, from the text's alignment point and
 * baseline.
 *
 * @public
 */
export interface TextMeasurement {
  /** The advance width of the text. */
  readonly width: number;
  /** Distance from the alignment point to the left edge of the drawn glyphs. */
  readonly actualBoundingBoxLeft: number;
  /** Distance from the alignment point to the right edge of the drawn glyphs. */
  readonly actualBoundingBoxRight: number;
  /** Distance from the baseline to the top of the drawn glyphs. */
  readonly actualBoundingBoxAscent: number;
  /** Distance from the baseline to the bottom of the drawn glyphs. */
  readonly actualBoundingBoxDescent: number;
  /** Distance from the baseline to the top of the font's bounding box. */
  readonly fontBoundingBoxAscent: number;
  /** Distance from the baseline to the bottom of the font's bounding box. */
  readonly fontBoundingBoxDescent: number;
}

/**
 * The drawing context without text: paths, styles, transforms, state and gradients.
 *
 * @remarks
 * This is what a depth 4 drawing callback receives. It has the standard Canvas 2D members
 * of {@link DrawingContext} except the text ones: with `y` pointing up, raw text would be
 * drawn mirrored, and it would bypass the text checks. A scene's text goes through labels,
 * speech bubbles and the text helper.
 *
 * A property whose value two real contexts report differently is declared with a wide
 * getter and a narrow setter: read it as any string, write one of the standard values.
 *
 * Receive-only: charade hands you one and you call it. Do not implement it; members may be
 * added in a minor release.
 *
 * @example
 * ```ts
 * function drawBall(ctx: ShapeContext): void {
 *   ctx.beginPath();
 *   ctx.arc(0, 0.1, 0.1, 0, Math.PI * 2);
 *   ctx.fillStyle = "#e4572e";
 *   ctx.fill();
 * }
 * ```
 *
 * @public
 */
export interface ShapeContext {
  /** Pushes the current drawing state onto the stack. */
  save(): void;
  /** Pops the drawing state saved last. */
  restore(): void;
  /** Resets the context to its initial state, clearing the state stack and the path. */
  reset(): void;

  /**
   * Moves the origin.
   *
   * @param x - Distance along `x`.
   * @param y - Distance along `y`.
   */
  translate(x: number, y: number): void;
  /**
   * Rotates the coordinate system.
   *
   * @param angle - The angle in radians.
   */
  rotate(angle: number): void;
  /**
   * Scales the coordinate system.
   *
   * @param x - The factor along `x`.
   * @param y - The factor along `y`.
   */
  scale(x: number, y: number): void;
  /**
   * Multiplies the current transform by the matrix `[a c e; b d f; 0 0 1]`.
   *
   * @param a - Horizontal scaling.
   * @param b - Vertical skewing.
   * @param c - Horizontal skewing.
   * @param d - Vertical scaling.
   * @param e - Horizontal translation.
   * @param f - Vertical translation.
   */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  /**
   * Replaces the current transform with the matrix `[a c e; b d f; 0 0 1]`.
   *
   * @param a - Horizontal scaling.
   * @param b - Vertical skewing.
   * @param c - Horizontal skewing.
   * @param d - Vertical scaling.
   * @param e - Horizontal translation.
   * @param f - Vertical translation.
   */
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  /** Replaces the current transform with the identity. */
  resetTransform(): void;

  /** Starts a new path. */
  beginPath(): void;
  /** Closes the current subpath with a straight line to its start. */
  closePath(): void;
  /**
   * Starts a new subpath at a point.
   *
   * @param x - The point's `x`.
   * @param y - The point's `y`.
   */
  moveTo(x: number, y: number): void;
  /**
   * Adds a straight line to a point.
   *
   * @param x - The point's `x`.
   * @param y - The point's `y`.
   */
  lineTo(x: number, y: number): void;
  /**
   * Adds a cubic Bézier curve.
   *
   * @param cp1x - The first control point's `x`.
   * @param cp1y - The first control point's `y`.
   * @param cp2x - The second control point's `x`.
   * @param cp2y - The second control point's `y`.
   * @param x - The end point's `x`.
   * @param y - The end point's `y`.
   */
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void;
  /**
   * Adds a quadratic Bézier curve.
   *
   * @param cpx - The control point's `x`.
   * @param cpy - The control point's `y`.
   * @param x - The end point's `x`.
   * @param y - The end point's `y`.
   */
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  /**
   * Adds a circular arc.
   *
   * @param x - The centre's `x`.
   * @param y - The centre's `y`.
   * @param radius - The radius.
   * @param startAngle - The start angle in radians.
   * @param endAngle - The end angle in radians.
   * @param counterclockwise - Whether the arc runs counter-clockwise.
   */
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  /**
   * Adds an arc joining two tangent lines.
   *
   * @param x1 - The first control point's `x`.
   * @param y1 - The first control point's `y`.
   * @param x2 - The second control point's `x`.
   * @param y2 - The second control point's `y`.
   * @param radius - The radius.
   */
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  /**
   * Adds an elliptical arc.
   *
   * @param x - The centre's `x`.
   * @param y - The centre's `y`.
   * @param radiusX - The radius along the ellipse's own `x`.
   * @param radiusY - The radius along the ellipse's own `y`.
   * @param rotation - The ellipse's rotation in radians.
   * @param startAngle - The start angle in radians.
   * @param endAngle - The end angle in radians.
   * @param counterclockwise - Whether the arc runs counter-clockwise.
   */
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  /**
   * Adds a rectangle as a closed subpath.
   *
   * @param x - The corner's `x`.
   * @param y - The corner's `y`.
   * @param w - The width.
   * @param h - The height.
   */
  rect(x: number, y: number, w: number, h: number): void;
  /**
   * Adds a rectangle with rounded corners as a closed subpath.
   *
   * @param x - The corner's `x`.
   * @param y - The corner's `y`.
   * @param w - The width.
   * @param h - The height.
   * @param radii - One radius for every corner, or one to four radii.
   */
  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii?: number | number[],
  ): void;

  /**
   * Fills the current path.
   *
   * @param fillRule - The winding rule, `nonzero` by default.
   */
  fill(fillRule?: "nonzero" | "evenodd"): void;
  /** Strokes the current path. */
  stroke(): void;
  /**
   * Intersects the clipping region with the current path.
   *
   * @param fillRule - The winding rule, `nonzero` by default.
   */
  clip(fillRule?: "nonzero" | "evenodd"): void;

  /**
   * Fills a rectangle.
   *
   * @param x - The corner's `x`.
   * @param y - The corner's `y`.
   * @param w - The width.
   * @param h - The height.
   */
  fillRect(x: number, y: number, w: number, h: number): void;
  /**
   * Strokes a rectangle.
   *
   * @param x - The corner's `x`.
   * @param y - The corner's `y`.
   * @param w - The width.
   * @param h - The height.
   */
  strokeRect(x: number, y: number, w: number, h: number): void;
  /**
   * Clears a rectangle to transparent.
   *
   * @param x - The corner's `x`.
   * @param y - The corner's `y`.
   * @param w - The width.
   * @param h - The height.
   */
  clearRect(x: number, y: number, w: number, h: number): void;

  /**
   * Creates a linear gradient along a line.
   *
   * @param x0 - The start point's `x`.
   * @param y0 - The start point's `y`.
   * @param x1 - The end point's `x`.
   * @param y1 - The end point's `y`.
   * @returns The gradient, with no colour stops yet.
   */
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): Gradient;
  /**
   * Creates a radial gradient between two circles.
   *
   * @param x0 - The start circle's centre `x`.
   * @param y0 - The start circle's centre `y`.
   * @param r0 - The start circle's radius.
   * @param x1 - The end circle's centre `x`.
   * @param y1 - The end circle's centre `y`.
   * @param r1 - The end circle's radius.
   * @returns The gradient, with no colour stops yet.
   */
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): Gradient;
  /**
   * Creates a conic gradient around a point.
   *
   * @param startAngle - The angle the gradient starts at, in radians.
   * @param x - The centre's `x`.
   * @param y - The centre's `y`.
   * @returns The gradient, with no colour stops yet.
   */
  createConicGradient(startAngle: number, x: number, y: number): Gradient;

  /**
   * Sets the dash pattern for strokes.
   *
   * @param segments - Alternating dash and gap lengths; empty for a solid line.
   */
  setLineDash(segments: readonly number[]): void;
  /**
   * Returns the current dash pattern.
   *
   * @returns Alternating dash and gap lengths.
   */
  getLineDash(): number[];

  /**
   * The paint for fills: a CSS colour or a gradient this context created. A real context
   * may read back a paint object set outside this interface.
   */
  // eslint-disable-next-line @typescript-eslint/related-getter-setter-pairs -- wide getter, narrow setter (.claude/rules/engine.md)
  get fillStyle(): string | object;
  /** Sets the paint for fills. */
  set fillStyle(value: string | Gradient);
  /**
   * The paint for strokes: a CSS colour or a gradient this context created. A real context
   * may read back a paint object set outside this interface.
   */
  // eslint-disable-next-line @typescript-eslint/related-getter-setter-pairs -- wide getter, narrow setter (.claude/rules/engine.md)
  get strokeStyle(): string | object;
  /** Sets the paint for strokes. */
  set strokeStyle(value: string | Gradient);

  /** The stroke width. */
  lineWidth: number;
  /** How a stroke's ends are drawn. */
  lineCap: "butt" | "round" | "square";
  /** How a stroke's corners are drawn. */
  lineJoin: "bevel" | "miter" | "round";
  /** The limit on a mitred corner's length, as a ratio of the line width. */
  miterLimit: number;
  /** Where the dash pattern starts along a stroke. */
  lineDashOffset: number;

  /** The opacity applied to everything drawn, from 0 to 1. */
  globalAlpha: number;
  /** How new drawing is combined with what is already drawn. */
  // eslint-disable-next-line @typescript-eslint/related-getter-setter-pairs -- wide getter, narrow setter (.claude/rules/engine.md)
  get globalCompositeOperation(): string;
  /** Sets the compositing operation to one of the standard values. */
  set globalCompositeOperation(
    value:
      | "color"
      | "color-burn"
      | "color-dodge"
      | "copy"
      | "darken"
      | "destination-atop"
      | "destination-in"
      | "destination-out"
      | "destination-over"
      | "difference"
      | "exclusion"
      | "hard-light"
      | "hue"
      | "lighten"
      | "lighter"
      | "luminosity"
      | "multiply"
      | "overlay"
      | "saturation"
      | "screen"
      | "soft-light"
      | "source-atop"
      | "source-in"
      | "source-out"
      | "source-over"
      | "xor",
  );
  /** A CSS filter applied to everything drawn, or `none`. */
  filter: string;

  /** The blur radius of shadows. */
  shadowBlur: number;
  /** The CSS colour of shadows. */
  shadowColor: string;
  /** The horizontal offset of shadows. */
  shadowOffsetX: number;
  /** The vertical offset of shadows. */
  shadowOffsetY: number;
}

/**
 * The full drawing context the engine draws a frame on: {@link ShapeContext} plus the
 * standard Canvas 2D text members.
 *
 * @remarks
 * Not named after the DOM's context type, which it would shadow. Both a browser's 2D
 * context and the renderer's satisfy it.
 *
 * Receive-only: charade hands you one and you call it. Do not implement it; members may be
 * added in a minor release.
 *
 * @example
 * ```ts
 * function caption(ctx: DrawingContext, text: string): number {
 *   ctx.font = "24px sans-serif";
 *   ctx.textAlign = "center";
 *   ctx.fillText(text, 0, 0);
 *   return ctx.measureText(text).width;
 * }
 * ```
 *
 * @public
 */
export interface DrawingContext extends ShapeContext {
  /**
   * Fills text at a point.
   *
   * @param text - The text.
   * @param x - The alignment point's `x`.
   * @param y - The baseline's `y`.
   * @param maxWidth - The width the text is condensed to fit, if given.
   */
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  /**
   * Strokes text at a point.
   *
   * @param text - The text.
   * @param x - The alignment point's `x`.
   * @param y - The baseline's `y`.
   * @param maxWidth - The width the text is condensed to fit, if given.
   */
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
  /**
   * Measures text in the current font.
   *
   * @param text - The text.
   * @returns Its measurements.
   */
  measureText(text: string): TextMeasurement;

  /** The CSS font shorthand, such as `24px sans-serif`. */
  font: string;
  /** Where text sits horizontally relative to its alignment point. */
  // eslint-disable-next-line @typescript-eslint/related-getter-setter-pairs -- wide getter, narrow setter (.claude/rules/engine.md)
  get textAlign(): string;
  /** Sets the alignment to one of the standard values. */
  set textAlign(value: "center" | "end" | "left" | "right" | "start");
  /** Where text sits vertically relative to its baseline point. */
  textBaseline: "alphabetic" | "bottom" | "hanging" | "ideographic" | "middle" | "top";
  /** The text direction. */
  direction: "inherit" | "ltr" | "rtl";
  /** Extra space between letters, as a CSS length. */
  letterSpacing: string;
  /** Extra space between words, as a CSS length. */
  wordSpacing: string;
  /** Whether the font's kerning is used. */
  fontKerning: "auto" | "none" | "normal";
  /** The font's width, as a CSS `font-stretch` keyword. */
  // eslint-disable-next-line @typescript-eslint/related-getter-setter-pairs -- wide getter, narrow setter (.claude/rules/engine.md)
  get fontStretch(): string;
  /** Sets the width to one of the standard keywords. */
  set fontStretch(
    value:
      | "condensed"
      | "expanded"
      | "extra-condensed"
      | "extra-expanded"
      | "normal"
      | "semi-condensed"
      | "semi-expanded"
      | "ultra-condensed"
      | "ultra-expanded",
  );
  /** What the rasteriser favours when drawing text. */
  textRendering: "auto" | "geometricPrecision" | "optimizeLegibility" | "optimizeSpeed";
}
