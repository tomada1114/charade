import type { Definition } from "./define.js";

// The generated vocabulary index replaces these with one entry per built-in item; the
// methods that take a name are typed through them and need no change when it does.

/**
 * The names of a built-in map, as strings.
 *
 * @public
 */
export type BuiltinName<Map> = keyof Map & string;

/**
 * The built-in actions by name: what `a.do("name")` accepts.
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- empty until the generated index fills it
export interface BuiltinActions {}

/**
 * The built-in expressions by name: what `a.express("name")` and `mood` accept.
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- empty until the generated index fills it
export interface BuiltinExpressions {}

/**
 * The built-in props by name: what `row.prop("name")` accepts.
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- empty until the generated index fills it
export interface BuiltinProps {}

/**
 * The built-in backdrops by name: what `row.backdrop("name")` accepts.
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- empty until the generated index fills it
export interface BuiltinBackdrops {}

/**
 * The built-in effects by name: what `row.effect("name")` accepts.
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- empty until the generated index fills it
export interface BuiltinEffects {}

/**
 * The built-in actions, by name.
 *
 * @public
 */
export const builtinActions: BuiltinActions = Object.freeze({});

/**
 * The built-in expressions, by name.
 *
 * @public
 */
export const builtinExpressions: BuiltinExpressions = Object.freeze({});

/**
 * The built-in props, by name.
 *
 * @public
 */
export const builtinProps: BuiltinProps = Object.freeze({});

/**
 * The built-in backdrops, by name.
 *
 * @public
 */
export const builtinBackdrops: BuiltinBackdrops = Object.freeze({});

/**
 * The built-in effects, by name.
 *
 * @public
 */
export const builtinEffects: BuiltinEffects = Object.freeze({});

/** The built-in maps a scene resolves names against, by kind. */
export type Vocabulary = Readonly<Record<Definition["kind"], object>>;

export const BUILTIN_VOCABULARY: Vocabulary = {
  action: builtinActions,
  expression: builtinExpressions,
  prop: builtinProps,
  backdrop: builtinBackdrops,
  effect: builtinEffects,
};
