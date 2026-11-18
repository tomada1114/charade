import type { Point } from "../rig/kinematics.js";
import type { Prop } from "./handles.js";

/**
 * A number parameter. `min` and `max` are inclusive; either may be left out.
 *
 * @public
 */
export interface NumberParam {
  /** The kind of value. */
  readonly type: "number";
  /** The value used when the scene leaves the key out; without one the key is required. */
  readonly default?: number;
  /** The smallest value allowed. */
  readonly min?: number;
  /** The largest value allowed. */
  readonly max?: number;
  /** What the number counts, such as `s` or `x`, shown in the catalog. */
  readonly unit?: string;
  /** One line saying what the parameter does. */
  readonly doc: string;
}

/**
 * A parameter that takes one of a fixed list of strings.
 *
 * @public
 */
export interface EnumParam {
  /** The kind of value. */
  readonly type: "enum";
  /** The allowed values, at least one. */
  readonly values: readonly string[];
  /** The value used when the scene leaves the key out; without one the key is required. */
  readonly default?: string;
  /** One line saying what the parameter does. */
  readonly doc: string;
}

/**
 * A yes-or-no parameter.
 *
 * @public
 */
export interface BooleanParam {
  /** The kind of value. */
  readonly type: "boolean";
  /** The value used when the scene leaves the key out; without one the key is required. */
  readonly default?: boolean;
  /** One line saying what the parameter does. */
  readonly doc: string;
}

/**
 * A colour parameter: a non-empty CSS colour string, such as `#e4572e`.
 *
 * @public
 */
export interface ColorParam {
  /** The kind of value. */
  readonly type: "color";
  /** The value used when the scene leaves the key out; without one the key is required. */
  readonly default?: string;
  /** One line saying what the parameter does. */
  readonly doc: string;
}

/**
 * A point parameter, `{ x, y }` in row units.
 *
 * @public
 */
export interface PointParam {
  /** The kind of value. */
  readonly type: "point";
  /** The value used when the scene leaves the key out; without one the key is required. */
  readonly default?: Point;
  /** One line saying what the parameter does. */
  readonly doc: string;
}

/**
 * A text parameter.
 *
 * @public
 */
export interface TextParam {
  /** The kind of value. */
  readonly type: "text";
  /** The value used when the scene leaves the key out; without one the key is required. */
  readonly default?: string;
  /** One line saying what the parameter does. */
  readonly doc: string;
}

/**
 * A prop handle an action moves. Only an action may declare one, and it has no
 * default: the scene always passes the handle `row.prop` returned.
 *
 * @public
 */
export interface PropParam {
  /** The kind of value. */
  readonly type: "prop";
  /** One line saying what the parameter does. */
  readonly doc: string;
}

/**
 * The specification of one parameter.
 *
 * @public
 */
export type Param =
  | NumberParam
  | EnumParam
  | BooleanParam
  | ColorParam
  | PointParam
  | TextParam
  | PropParam;

/**
 * A definition's parameters by name: plain data, written `as const` so that the
 * parameter types are derived from it.
 *
 * @public
 */
export type ParamSpec = Readonly<Record<string, Param>>;

/**
 * The value a parameter takes.
 *
 * @public
 */
export type ParamValue<S extends Param> = S extends NumberParam
  ? number
  : S extends EnumParam
    ? S["values"][number]
    : S extends BooleanParam
      ? boolean
      : S extends ColorParam | TextParam
        ? string
        : S extends PointParam
          ? Point
          : S extends PropParam
            ? Prop
            : never;

/**
 * The keys of a parameter specification that have no default, which a scene must pass.
 *
 * @public
 */
export type RequiredParamKeys<P extends ParamSpec> = {
  [K in keyof P]: "default" extends keyof P[K] ? never : K;
}[keyof P];

/**
 * What a scene passes for a parameter specification: a key without a default is
 * required, the rest are optional.
 *
 * @public
 */
export type ParamArgs<P extends ParamSpec> = {
  readonly [K in keyof P as "default" extends keyof P[K] ? never : K]: ParamValue<P[K]>;
} & {
  readonly [K in keyof P as "default" extends keyof P[K] ? K : never]?: ParamValue<
    P[K]
  >;
};

/**
 * What a definition's `build` or `draw` receives: every parameter, defaults filled in.
 *
 * @public
 */
export type ResolvedParams<P extends ParamSpec> = {
  readonly [K in keyof P]: ParamValue<P[K]>;
};

/**
 * The arguments after the item of `a.do` and its siblings: the parameters and the
 * call's options in one bag, which may be left out when no parameter is required.
 *
 * @public
 */
export type ItemArgs<P extends ParamSpec, Options> = [RequiredParamKeys<P>] extends [
  never,
]
  ? [options?: ParamArgs<P> & Options]
  : [options: ParamArgs<P> & Options];

/** The parameter kinds, in the order the catalog lists them. */
export const PARAM_TYPES = [
  "number",
  "enum",
  "boolean",
  "color",
  "point",
  "text",
  "prop",
] as const;

/** Options and timing share one bag with the parameters, so these names are taken. */
export const RESERVED_PARAMS = ["at", "duration", "mood", "blend", "mode"] as const;

/** `row.effect` takes `on` in that bag as well, so an effect's parameter may not be it. */
export const EFFECT_RESERVED_PARAM = "on";
