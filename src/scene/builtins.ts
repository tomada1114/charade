// Before the index: its items call `define…` as they load, and they import it through
// the root entry, which may be only part-way through loading by then.
import "./define.js";

import {
  builtinActions,
  builtinBackdrops,
  builtinEffects,
  builtinExpressions,
  builtinProps,
} from "../vocabulary/index.js";
import type { Definition } from "./define.js";

export {
  builtinActions,
  builtinBackdrops,
  builtinEffects,
  builtinExpressions,
  builtinProps,
};
export type {
  BuiltinActions,
  BuiltinBackdrops,
  BuiltinEffects,
  BuiltinExpressions,
  BuiltinProps,
} from "../vocabulary/index.js";

/**
 * The names of a built-in map, as strings.
 *
 * @public
 */
export type BuiltinName<Map> = keyof Map & string;

/** The built-in maps a scene resolves names against, by kind. */
export type Vocabulary = Readonly<Record<Definition["kind"], object>>;

export const BUILTIN_VOCABULARY: Vocabulary = {
  action: builtinActions,
  expression: builtinExpressions,
  prop: builtinProps,
  backdrop: builtinBackdrops,
  effect: builtinEffects,
};
