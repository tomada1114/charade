import type { ShapeContext } from "../draw/context.js";
import {
  InvalidDefaultError,
  InvalidDefinitionError,
  type ItemKind,
  ReservedParameterError,
} from "../errors.js";
import type { DrawMoment } from "../timeline/segments.js";
import type { Clip, Stage } from "./handles.js";
import {
  type Param,
  PARAM_TYPES,
  type ParamSpec,
  RESERVED_PARAMS,
  type ResolvedParams,
} from "./params.js";
import { deepFreeze, isRecord } from "./values.js";

/**
 * The face values an expression returns, by channel. Channels left out are not touched.
 *
 * @remarks
 * At rest the eyes are open (`eyeOpen` 1), the mouth is its normal width
 * (`mouthWidth` 1) and the rest are 0. The ranges are `eyeOpen` 0..1.5, `mouthOpen`
 * 0..1, `mouthWidth` 0.5..1.5 and the other five −1..1.
 *
 * @public
 */
export interface FaceChannels {
  /** How open the eyes are. */
  readonly eyeOpen?: number;
  /** Where the eyes look, forward positive. */
  readonly gazeX?: number;
  /** Where the eyes look, up positive. */
  readonly gazeY?: number;
  /** How high the brows sit. */
  readonly browHeight?: number;
  /** The brows' tilt, inner end up positive. */
  readonly browTilt?: number;
  /** The mouth's curve, a smile positive. */
  readonly mouthCurve?: number;
  /** How far the mouth opens. */
  readonly mouthOpen?: number;
  /** How wide the mouth is. */
  readonly mouthWidth?: number;
}

/** What every definition carries. */
interface DefinitionBase<P extends ParamSpec> {
  /** The item's name, unique within its kind. */
  readonly name: string;
  /** One or two sentences for the catalog. */
  readonly description: string;
  /** The parameters, as plain data. */
  readonly params: P;
  /**
   * Records the item's sample on the stage it is given. Pass it to `scene`; a sample
   * uses definitions, never names.
   */
  sample?(stage: Stage): void;
}

/**
 * An action: a named piece of acting an actor does with `a.do`.
 *
 * @remarks
 * Made by {@link defineAction}. `build` is declared as a method, which is what keeps
 * a definition with specific parameters assignable to the general type.
 *
 * @public
 */
export interface ActionDefinition<
  P extends ParamSpec = ParamSpec,
  Marks extends string = string,
> extends DefinitionBase<P> {
  /** Marks the value as an action definition. */
  readonly kind: "action";
  /** The moments the action names, such as a throw's `release`. */
  readonly marks: readonly Marks[];
  /** The moods that also change the body, not only the face. */
  readonly moods: readonly string[];
  /**
   * Records the action on `clip`, with time 0 at the action's start. Returns nothing.
   *
   * @param clip - The actor's depth 2 and 3 calls, in the action's own time.
   * @param params - Every parameter, defaults filled in.
   */
  build(clip: Clip<Marks>, params: ResolvedParams<P>): void;
}

/**
 * An expression: face values an actor shows with `a.express`, or as an action's mood.
 *
 * @public
 */
export interface ExpressionDefinition<
  P extends ParamSpec = ParamSpec,
> extends DefinitionBase<P> {
  /** Marks the value as an expression definition. */
  readonly kind: "expression";
  /**
   * The face values of the expression.
   *
   * @param params - Every parameter, defaults filled in.
   * @returns Face values by channel.
   */
  build(params: ResolvedParams<P>): FaceChannels;
}

/**
 * A prop, backdrop or effect: a drawing at a point of a row.
 *
 * @public
 */
export interface DrawnDefinition<
  P extends ParamSpec = ParamSpec,
> extends DefinitionBase<P> {
  /**
   * Draws one frame, in row units with `y` up and the origin at the item's ground point.
   *
   * @param ctx - The drawing interface, without text.
   * @param params - Every parameter, defaults filled in.
   * @param moment - The scene time, the item's segment, its random source and the row's
   *   visible area.
   */
  draw(ctx: ShapeContext, params: ResolvedParams<P>, moment: DrawMoment): void;
}

/**
 * A prop: an object in a row, placed with `row.prop`, which an action may move.
 *
 * @public
 */
export interface PropDefinition<
  P extends ParamSpec = ParamSpec,
> extends DrawnDefinition<P> {
  /** Marks the value as a prop definition. */
  readonly kind: "prop";
}

/**
 * A backdrop: what a row shows behind everything else, placed with `row.backdrop`.
 *
 * @public
 */
export interface BackdropDefinition<
  P extends ParamSpec = ParamSpec,
> extends DrawnDefinition<P> {
  /** Marks the value as a backdrop definition. */
  readonly kind: "backdrop";
}

/**
 * An effect: a drawn accent such as sweat or speed lines, placed with `row.effect`.
 *
 * @public
 */
export interface EffectDefinition<
  P extends ParamSpec = ParamSpec,
> extends DrawnDefinition<P> {
  /** Marks the value as an effect definition. */
  readonly kind: "effect";
}

/**
 * Any vocabulary definition.
 *
 * @public
 */
export type Definition =
  | ActionDefinition
  | ExpressionDefinition
  | PropDefinition
  | BackdropDefinition
  | EffectDefinition;

/**
 * What {@link defineAction} takes: an action definition without its `kind`, with
 * `params`, `marks` and `moods` optional.
 *
 * @public
 */
export interface ActionInput<P extends ParamSpec, Marks extends string> {
  /** The action's name, unique among actions. */
  readonly name: string;
  /** One or two sentences for the catalog. */
  readonly description: string;
  /** The parameters, as plain data. Defaults to none. */
  readonly params?: P;
  /** The moments the action names. Defaults to none. */
  readonly marks?: readonly Marks[];
  /** The moods that also change the body. Defaults to none. */
  readonly moods?: readonly string[];
  /**
   * Records the action on `clip`, with time 0 at the action's start.
   *
   * @param clip - The actor's depth 2 and 3 calls, in the action's own time.
   * @param params - Every parameter, defaults filled in.
   */
  build(clip: Clip<Marks>, params: ResolvedParams<P>): void;
  /**
   * Records the action's sample.
   *
   * @param stage - The stage of the sample's scene.
   */
  sample?(stage: Stage): void;
}

/**
 * What {@link defineExpression} takes.
 *
 * @public
 */
export interface ExpressionInput<P extends ParamSpec> {
  /** The expression's name, unique among expressions. */
  readonly name: string;
  /** One or two sentences for the catalog. */
  readonly description: string;
  /** The parameters, as plain data. Defaults to none. */
  readonly params?: P;
  /**
   * The face values of the expression.
   *
   * @param params - Every parameter, defaults filled in.
   * @returns Face values by channel.
   */
  build(params: ResolvedParams<P>): FaceChannels;
  /**
   * Records the expression's sample.
   *
   * @param stage - The stage of the sample's scene.
   */
  sample?(stage: Stage): void;
}

/**
 * What {@link defineProp}, {@link defineBackdrop} and {@link defineEffect} take.
 *
 * @public
 */
export interface DrawnInput<P extends ParamSpec> {
  /** The item's name, unique within its kind. */
  readonly name: string;
  /** One or two sentences for the catalog. */
  readonly description: string;
  /** The parameters, as plain data. Defaults to none. */
  readonly params?: P;
  /**
   * Draws one frame, in row units with `y` up and the origin at the item's ground point.
   *
   * @param ctx - The drawing interface, without text.
   * @param params - Every parameter, defaults filled in.
   * @param moment - The scene time, the item's segment, its random source and the row's
   *   visible area.
   */
  draw(ctx: ShapeContext, params: ResolvedParams<P>, moment: DrawMoment): void;
  /**
   * Records the item's sample.
   *
   * @param stage - The stage of the sample's scene.
   */
  sample?(stage: Stage): void;
}

/**
 * No parameters: the specification a definition without `params` has.
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- a specification with no keys is the point
export type NoParams = Readonly<Record<never, Param>>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** Whether `value` is a value the parameter allows; a `prop` parameter allows no default. */
export function allows(spec: Param, value: unknown): boolean {
  switch (spec.type) {
    case "number":
      return (
        isFiniteNumber(value) &&
        (spec.min === undefined || value >= spec.min) &&
        (spec.max === undefined || value <= spec.max)
      );
    case "enum":
      return typeof value === "string" && spec.values.includes(value);
    case "boolean":
      return typeof value === "boolean";
    case "color":
      return typeof value === "string" && value !== "";
    case "point":
      return (
        isRecord(value) && isFiniteNumber(value["x"]) && isFiniteNumber(value["y"])
      );
    case "text":
      return typeof value === "string";
    case "prop":
      return false;
  }
}

function isParamType(value: unknown): value is Param["type"] {
  return PARAM_TYPES.some((type) => type === value);
}

/** A checked copy of one parameter's specification, holding only the members its type has. */
function checkParam(kind: ItemKind, key: string, raw: unknown): Param {
  const path = `params.${key}`;
  const invalid = (member: string): InvalidDefinitionError =>
    new InvalidDefinitionError(kind, `${path}.${member}`);
  if (RESERVED_PARAMS.some((name) => name === key)) {
    throw new ReservedParameterError(kind, path);
  }
  if (!isRecord(raw)) {
    throw new InvalidDefinitionError(kind, path);
  }
  const type = raw["type"];
  if (!isParamType(type) || (type === "prop" && kind !== "action")) {
    throw invalid("type");
  }
  const doc = raw["doc"];
  if (typeof doc !== "string" || doc === "") {
    throw invalid("doc");
  }
  let spec: Param;
  switch (type) {
    case "number": {
      const { min, max, unit } = raw;
      if (min !== undefined && !isFiniteNumber(min)) {
        throw invalid("min");
      }
      if (
        max !== undefined &&
        (!isFiniteNumber(max) || (min !== undefined && max < min))
      ) {
        throw invalid("max");
      }
      if (unit !== undefined && typeof unit !== "string") {
        throw invalid("unit");
      }
      spec = {
        type,
        doc,
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
        ...(unit === undefined ? {} : { unit }),
      };
      break;
    }
    case "enum": {
      const values = raw["values"];
      if (
        !isStringList(values) ||
        values.length === 0 ||
        new Set(values).size !== values.length
      ) {
        throw invalid("values");
      }
      spec = { type, doc, values: [...values] };
      break;
    }
    case "prop":
      if (Object.hasOwn(raw, "default")) {
        throw new InvalidDefaultError(kind, `${path}.default`);
      }
      return { type, doc };
    default:
      spec = { type, doc };
  }
  if (Object.hasOwn(raw, "default")) {
    const fallback = raw["default"];
    if (!allows(spec, fallback)) {
      throw new InvalidDefaultError(kind, `${path}.default`);
    }
    if (type === "point" && isRecord(fallback)) {
      return { ...spec, default: { x: fallback["x"], y: fallback["y"] } } as Param;
    }
    return { ...spec, default: fallback } as Param;
  }
  return spec;
}

/** A checked, frozen copy of a parameter specification. */
function checkParams(kind: ItemKind, raw: unknown): ParamSpec {
  if (raw === undefined) {
    return {};
  }
  if (!isRecord(raw)) {
    throw new InvalidDefinitionError(kind, "params");
  }
  // fromEntries defines a `__proto__` key as an own property rather than a prototype.
  return Object.fromEntries(
    Object.entries(raw).map(([key, spec]) => [key, checkParam(kind, key, spec)]),
  );
}

/** The members every definition has, checked. */
function checkBase(
  kind: ItemKind,
  raw: unknown,
  method: "build" | "draw",
): {
  readonly bag: Readonly<Record<string, unknown>>;
  readonly base: Readonly<Record<string, unknown>>;
} {
  if (!isRecord(raw)) {
    throw new InvalidDefinitionError(kind, "definition");
  }
  const { name, description, sample } = raw;
  if (typeof name !== "string" || name === "") {
    throw new InvalidDefinitionError(kind, "name");
  }
  if (typeof description !== "string") {
    throw new InvalidDefinitionError(kind, "description");
  }
  if (typeof raw[method] !== "function") {
    throw new InvalidDefinitionError(kind, method);
  }
  if (sample !== undefined && typeof sample !== "function") {
    throw new InvalidDefinitionError(kind, "sample");
  }
  return {
    bag: raw,
    base: {
      kind,
      name,
      description,
      params: checkParams(kind, raw["params"]),
      [method]: raw[method],
      ...(sample === undefined ? {} : { sample }),
    },
  };
}

function checkNames(kind: ItemKind, raw: unknown, path: string): readonly string[] {
  if (raw === undefined) {
    return [];
  }
  if (
    !isStringList(raw) ||
    raw.some((name) => name === "") ||
    new Set(raw).size !== raw.length
  ) {
    throw new InvalidDefinitionError(kind, path);
  }
  return [...raw];
}

/**
 * Define an action.
 *
 * @remarks
 * Nothing is registered: pass the returned definition to `a.do` wherever it is
 * used. The parameter types are derived from `params` written `as const`.
 *
 * @param definition - The action's name, description, parameters, marks, moods and
 *   `build`.
 * @returns The definition, checked and frozen.
 * @throws `ReservedParameterError` when a parameter is named `at`, `duration`, `mood`,
 *   `blend` or `mode`.
 * @throws `InvalidDefaultError` when a default is not a value its parameter allows.
 * @throws `InvalidDefinitionError` when a member is missing or has the wrong shape.
 *
 * @example
 * ```ts
 * import type { ActionDefinition } from "charade";
 *
 * const waveParams = {
 *   speed: { type: "number", default: 1, min: 0.5, max: 2, unit: "x", doc: "How fast the hand waves." },
 * } as const;
 *
 * const waveAction: ActionDefinition<typeof waveParams> = defineAction({
 *   name: "wave",
 *   description: "Raises the near hand and waves it.",
 *   params: waveParams,
 *   build(clip, { speed }) {
 *     clip.pose({ shoulderR: 2.6, elbowR: 0.4 }, { duration: 0.4 / speed });
 *     clip.pose({ elbowR: 1.2 }, { duration: 0.3 / speed });
 *   },
 * });
 * console.log(waveAction.kind, waveAction.name);
 * // => "action" "wave"
 * ```
 *
 * @public
 */
export function defineAction<
  const P extends ParamSpec = NoParams,
  const Marks extends string = never,
>(definition: ActionInput<P, Marks>): ActionDefinition<P, Marks> {
  const { bag, base } = checkBase("action", definition, "build");
  // The checked copy has the input's members, so the input's type describes it.
  return deepFreeze({
    ...base,
    marks: checkNames("action", bag["marks"], "marks"),
    moods: checkNames("action", bag["moods"], "moods"),
  }) as unknown as ActionDefinition<P, Marks>;
}

/**
 * Define an expression.
 *
 * @param definition - The expression's name, description, parameters and `build`.
 * @returns The definition, checked and frozen.
 * @throws `ReservedParameterError` when a parameter's name is taken.
 * @throws `InvalidDefaultError` when a default is not a value its parameter allows.
 * @throws `InvalidDefinitionError` when a member is missing or has the wrong shape.
 *
 * @example
 * ```ts
 * import type { ExpressionDefinition, NoParams } from "charade";
 *
 * const smugExpression: ExpressionDefinition<NoParams> = defineExpression({
 *   name: "smug",
 *   description: "A half smile under lowered lids.",
 *   build: () => ({ eyeOpen: 0.6, mouthCurve: 0.4, browTilt: -0.2 }),
 * });
 * console.log(smugExpression.kind);
 * // => "expression"
 * ```
 *
 * @public
 */
export function defineExpression<const P extends ParamSpec = NoParams>(
  definition: ExpressionInput<P>,
): ExpressionDefinition<P> {
  const { base } = checkBase("expression", definition, "build");
  return deepFreeze(base) as unknown as ExpressionDefinition<P>;
}

/**
 * Define a prop.
 *
 * @param definition - The prop's name, description, parameters and `draw`.
 * @returns The definition, checked and frozen.
 * @throws `ReservedParameterError` when a parameter's name is taken.
 * @throws `InvalidDefaultError` when a default is not a value its parameter allows.
 * @throws `InvalidDefinitionError` when a member is missing or has the wrong shape.
 *
 * @example
 * ```ts
 * import type { NoParams, PropDefinition } from "charade";
 *
 * const pebbleProp: PropDefinition<NoParams> = defineProp({
 *   name: "pebble",
 *   description: "A small grey stone.",
 *   draw(ctx) {
 *     ctx.beginPath();
 *     ctx.ellipse(0, 0.03, 0.05, 0.03, 0, 0, Math.PI * 2);
 *     ctx.fill();
 *   },
 * });
 * console.log(pebbleProp.kind);
 * // => "prop"
 * ```
 *
 * @public
 */
export function defineProp<const P extends ParamSpec = NoParams>(
  definition: DrawnInput<P>,
): PropDefinition<P> {
  const { base } = checkBase("prop", definition, "draw");
  return deepFreeze(base) as unknown as PropDefinition<P>;
}

/**
 * Define a backdrop.
 *
 * @param definition - The backdrop's name, description, parameters and `draw`.
 * @returns The definition, checked and frozen.
 * @throws `ReservedParameterError` when a parameter's name is taken.
 * @throws `InvalidDefaultError` when a default is not a value its parameter allows.
 * @throws `InvalidDefinitionError` when a member is missing or has the wrong shape.
 *
 * @public
 */
export function defineBackdrop<const P extends ParamSpec = NoParams>(
  definition: DrawnInput<P>,
): BackdropDefinition<P> {
  const { base } = checkBase("backdrop", definition, "draw");
  return deepFreeze(base) as unknown as BackdropDefinition<P>;
}

/**
 * Define an effect.
 *
 * @param definition - The effect's name, description, parameters and `draw`.
 * @returns The definition, checked and frozen.
 * @throws `ReservedParameterError` when a parameter's name is taken.
 * @throws `InvalidDefaultError` when a default is not a value its parameter allows.
 * @throws `InvalidDefinitionError` when a member is missing or has the wrong shape.
 *
 * @public
 */
export function defineEffect<const P extends ParamSpec = NoParams>(
  definition: DrawnInput<P>,
): EffectDefinition<P> {
  const { base } = checkBase("effect", definition, "draw");
  return deepFreeze(base) as unknown as EffectDefinition<P>;
}
