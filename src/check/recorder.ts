import type { DrawingContext, Gradient, TextMeasurement } from "../draw/context.js";
import { CharadeError } from "../errors.js";

/** A logged gradient: its creation index on the context that made it. */
export interface GradientRef {
  readonly gradient: number;
}

/** One logged argument: a quantised number, a string, a boolean, a list, or a gradient. */
export type LogValue = number | string | boolean | GradientRef | readonly LogValue[];

/** One logged call. A property write is a call named after the property. */
export interface LogEntry {
  readonly call: string;
  readonly args: readonly LogValue[];
}

/**
 * A drawing call was given `NaN` or an infinity. `call` names the member and `argument`
 * the zero-based position of the rejected argument, never its value.
 */
export class NonFiniteDrawingError extends CharadeError {
  readonly code = "ERR_SCENE_NON_FINITE_DRAWING" as const;

  readonly call: string;

  readonly argument: number;

  constructor(call: string, argument: number) {
    super(`Argument ${String(argument)} of ${call} is not a finite number.`);
    this.call = call;
    this.argument = argument;
  }
}

/**
 * A style was set to a gradient this recording context did not create, which it has no
 * creation index to log by. `call` names the property.
 */
export class ForeignGradientError extends CharadeError {
  readonly code = "ERR_SCENE_FOREIGN_GRADIENT" as const;

  readonly call: string;

  constructor(call: string) {
    super(`${call} was given a gradient another context created.`);
    this.call = call;
  }
}

const SCALE = 1e4;

function quantise(value: number, call: string, argument: number): number {
  const scaled = Math.round(value * SCALE);
  if (!Number.isFinite(scaled)) {
    throw new NonFiniteDrawingError(call, argument);
  }
  // `+ 0` turns a `-0` into `0`.
  return scaled + 0;
}

type Paint = string | Gradient;

interface State {
  fillStyle: Paint;
  strokeStyle: Paint;
  lineWidth: number;
  lineCap: DrawingContext["lineCap"];
  lineJoin: DrawingContext["lineJoin"];
  miterLimit: number;
  lineDashOffset: number;
  lineDash: number[];
  globalAlpha: number;
  globalCompositeOperation: string;
  filter: string;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  font: string;
  textAlign: string;
  textBaseline: DrawingContext["textBaseline"];
  direction: DrawingContext["direction"];
  letterSpacing: string;
  wordSpacing: string;
  fontKerning: DrawingContext["fontKerning"];
  fontStretch: string;
  textRendering: DrawingContext["textRendering"];
}

/** The initial state the Canvas 2D standard gives a context. */
function initialState(): State {
  return {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    lineDashOffset: 0,
    lineDash: [],
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
    shadowBlur: 0,
    shadowColor: "rgba(0, 0, 0, 0)",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    direction: "inherit",
    letterSpacing: "0px",
    wordSpacing: "0px",
    fontKerning: "auto",
    fontStretch: "normal",
    textRendering: "auto",
  };
}

const DEFAULT_FONT_SIZE = 10;
const FONT_SIZE = /(\d+(?:\.\d+)?|\.\d+)px/;

/**
 * The fake measurer, the formula recorded in `.claude/rules/checks.md`: each code point
 * advances 0.6 of the font's pixel size, ascent is 0.8 and descent 0.2 of it.
 */
function measure(text: string, font: string, textAlign: string): TextMeasurement {
  const sizeText = FONT_SIZE.exec(font)?.[1];
  const size = sizeText === undefined ? DEFAULT_FONT_SIZE : Number(sizeText);
  const width = Array.from(text).length * size * 0.6;
  const left =
    textAlign === "center"
      ? width / 2
      : textAlign === "right" || textAlign === "end"
        ? width
        : 0;
  return {
    width,
    actualBoundingBoxLeft: left,
    actualBoundingBoxRight: width - left,
    actualBoundingBoxAscent: size * 0.8,
    actualBoundingBoxDescent: size * 0.2,
    fontBoundingBoxAscent: size * 0.8,
    fontBoundingBoxDescent: size * 0.2,
  };
}

class RecordedGradient implements Gradient {
  readonly #addColorStop: (offset: number, color: string) => void;

  constructor(addColorStop: (offset: number, color: string) => void) {
    this.#addColorStop = addColorStop;
  }

  addColorStop(offset: number, color: string): void {
    this.#addColorStop(offset, color);
  }
}

type Args<K extends keyof DrawingContext> = DrawingContext[K] extends (
  ...args: infer A
) => unknown
  ? A
  : never;

/**
 * A drawing context that draws nothing and logs every call and every property write, for
 * the sample records in `.claude/rules/checks.md` § Keeping the log stable. Numbers are
 * logged as `Math.round(v × 1e4)`, and a gradient by its creation index.
 */
export class RecordingContext implements DrawingContext {
  readonly #log: LogEntry[] = [];

  readonly #gradients = new Map<unknown, number>();

  #state: State = initialState();

  #stack: State[] = [];

  /** Every call and property write so far, in order. */
  get log(): readonly LogEntry[] {
    return this.#log;
  }

  #value(value: unknown, call: string, argument: number): LogValue {
    if (typeof value === "number") {
      return quantise(value, call, argument);
    }
    if (typeof value === "string" || typeof value === "boolean") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item: unknown) => this.#value(item, call, argument));
    }
    const index = this.#gradients.get(value);
    if (index === undefined) {
      throw new ForeignGradientError(call);
    }
    return { gradient: index };
  }

  #record(call: string, args: readonly unknown[]): void {
    let end = args.length;
    // An `undefined` trailing argument is an omitted one, as the standard reads it.
    while (end > 0 && args[end - 1] === undefined) {
      end -= 1;
    }
    const logged = args
      .slice(0, end)
      .map((value, argument) => this.#value(value, call, argument));
    this.#log.push({ call, args: logged });
  }

  #set<K extends keyof State>(key: K, value: State[K]): void {
    this.#record(key, [value]);
    this.#state[key] = value;
  }

  #gradient(call: string, args: readonly unknown[]): Gradient {
    this.#record(call, args);
    const index = this.#gradients.size;
    const gradient = new RecordedGradient((offset, color) => {
      this.#log.push({
        call: "addColorStop",
        args: [{ gradient: index }, quantise(offset, "addColorStop", 0), color],
      });
    });
    this.#gradients.set(gradient, index);
    return gradient;
  }

  save(): void {
    this.#record("save", []);
    this.#stack.push({ ...this.#state, lineDash: [...this.#state.lineDash] });
  }

  restore(): void {
    this.#record("restore", []);
    const saved = this.#stack.pop();
    if (saved !== undefined) {
      this.#state = saved;
    }
  }

  reset(): void {
    this.#record("reset", []);
    this.#state = initialState();
    this.#stack = [];
  }

  translate(...args: Args<"translate">): void {
    this.#record("translate", args);
  }

  rotate(...args: Args<"rotate">): void {
    this.#record("rotate", args);
  }

  scale(...args: Args<"scale">): void {
    this.#record("scale", args);
  }

  transform(...args: Args<"transform">): void {
    this.#record("transform", args);
  }

  setTransform(...args: Args<"setTransform">): void {
    this.#record("setTransform", args);
  }

  resetTransform(): void {
    this.#record("resetTransform", []);
  }

  beginPath(): void {
    this.#record("beginPath", []);
  }

  closePath(): void {
    this.#record("closePath", []);
  }

  moveTo(...args: Args<"moveTo">): void {
    this.#record("moveTo", args);
  }

  lineTo(...args: Args<"lineTo">): void {
    this.#record("lineTo", args);
  }

  bezierCurveTo(...args: Args<"bezierCurveTo">): void {
    this.#record("bezierCurveTo", args);
  }

  quadraticCurveTo(...args: Args<"quadraticCurveTo">): void {
    this.#record("quadraticCurveTo", args);
  }

  arc(...args: Args<"arc">): void {
    this.#record("arc", args);
  }

  arcTo(...args: Args<"arcTo">): void {
    this.#record("arcTo", args);
  }

  ellipse(...args: Args<"ellipse">): void {
    this.#record("ellipse", args);
  }

  rect(...args: Args<"rect">): void {
    this.#record("rect", args);
  }

  roundRect(...args: Args<"roundRect">): void {
    this.#record("roundRect", args);
  }

  fill(...args: Args<"fill">): void {
    this.#record("fill", args);
  }

  stroke(): void {
    this.#record("stroke", []);
  }

  clip(...args: Args<"clip">): void {
    this.#record("clip", args);
  }

  fillRect(...args: Args<"fillRect">): void {
    this.#record("fillRect", args);
  }

  strokeRect(...args: Args<"strokeRect">): void {
    this.#record("strokeRect", args);
  }

  clearRect(...args: Args<"clearRect">): void {
    this.#record("clearRect", args);
  }

  createLinearGradient(...args: Args<"createLinearGradient">): Gradient {
    return this.#gradient("createLinearGradient", args);
  }

  createRadialGradient(...args: Args<"createRadialGradient">): Gradient {
    return this.#gradient("createRadialGradient", args);
  }

  createConicGradient(...args: Args<"createConicGradient">): Gradient {
    return this.#gradient("createConicGradient", args);
  }

  setLineDash(segments: readonly number[]): void {
    this.#record("setLineDash", [segments]);
    this.#state.lineDash = [...segments];
  }

  getLineDash(): number[] {
    this.#record("getLineDash", []);
    return [...this.#state.lineDash];
  }

  fillText(...args: Args<"fillText">): void {
    this.#record("fillText", args);
  }

  strokeText(...args: Args<"strokeText">): void {
    this.#record("strokeText", args);
  }

  measureText(text: string): TextMeasurement {
    this.#record("measureText", [text]);
    return measure(text, this.#state.font, this.#state.textAlign);
  }

  get fillStyle(): Paint {
    return this.#state.fillStyle;
  }

  set fillStyle(value: Paint) {
    this.#set("fillStyle", value);
  }

  get strokeStyle(): Paint {
    return this.#state.strokeStyle;
  }

  set strokeStyle(value: Paint) {
    this.#set("strokeStyle", value);
  }

  get lineWidth(): number {
    return this.#state.lineWidth;
  }

  set lineWidth(value: number) {
    this.#set("lineWidth", value);
  }

  get lineCap(): State["lineCap"] {
    return this.#state.lineCap;
  }

  set lineCap(value: State["lineCap"]) {
    this.#set("lineCap", value);
  }

  get lineJoin(): State["lineJoin"] {
    return this.#state.lineJoin;
  }

  set lineJoin(value: State["lineJoin"]) {
    this.#set("lineJoin", value);
  }

  get miterLimit(): number {
    return this.#state.miterLimit;
  }

  set miterLimit(value: number) {
    this.#set("miterLimit", value);
  }

  get lineDashOffset(): number {
    return this.#state.lineDashOffset;
  }

  set lineDashOffset(value: number) {
    this.#set("lineDashOffset", value);
  }

  get globalAlpha(): number {
    return this.#state.globalAlpha;
  }

  set globalAlpha(value: number) {
    this.#set("globalAlpha", value);
  }

  get globalCompositeOperation(): string {
    return this.#state.globalCompositeOperation;
  }

  set globalCompositeOperation(value: string) {
    this.#set("globalCompositeOperation", value);
  }

  get filter(): string {
    return this.#state.filter;
  }

  set filter(value: string) {
    this.#set("filter", value);
  }

  get shadowBlur(): number {
    return this.#state.shadowBlur;
  }

  set shadowBlur(value: number) {
    this.#set("shadowBlur", value);
  }

  get shadowColor(): string {
    return this.#state.shadowColor;
  }

  set shadowColor(value: string) {
    this.#set("shadowColor", value);
  }

  get shadowOffsetX(): number {
    return this.#state.shadowOffsetX;
  }

  set shadowOffsetX(value: number) {
    this.#set("shadowOffsetX", value);
  }

  get shadowOffsetY(): number {
    return this.#state.shadowOffsetY;
  }

  set shadowOffsetY(value: number) {
    this.#set("shadowOffsetY", value);
  }

  get font(): string {
    return this.#state.font;
  }

  set font(value: string) {
    this.#set("font", value);
  }

  get textAlign(): string {
    return this.#state.textAlign;
  }

  set textAlign(value: string) {
    this.#set("textAlign", value);
  }

  get textBaseline(): State["textBaseline"] {
    return this.#state.textBaseline;
  }

  set textBaseline(value: State["textBaseline"]) {
    this.#set("textBaseline", value);
  }

  get direction(): State["direction"] {
    return this.#state.direction;
  }

  set direction(value: State["direction"]) {
    this.#set("direction", value);
  }

  get letterSpacing(): string {
    return this.#state.letterSpacing;
  }

  set letterSpacing(value: string) {
    this.#set("letterSpacing", value);
  }

  get wordSpacing(): string {
    return this.#state.wordSpacing;
  }

  set wordSpacing(value: string) {
    this.#set("wordSpacing", value);
  }

  get fontKerning(): State["fontKerning"] {
    return this.#state.fontKerning;
  }

  set fontKerning(value: State["fontKerning"]) {
    this.#set("fontKerning", value);
  }

  get fontStretch(): string {
    return this.#state.fontStretch;
  }

  set fontStretch(value: string) {
    this.#set("fontStretch", value);
  }

  get textRendering(): State["textRendering"] {
    return this.#state.textRendering;
  }

  set textRendering(value: State["textRendering"]) {
    this.#set("textRendering", value);
  }
}
