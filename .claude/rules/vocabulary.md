---
paths:
  - "src/vocabulary/**"
  - "skills/**"
---

# Built-in vocabulary

How an item is written — its shape, its parameters, its sample, and the loop of check,
catalog, look and fix — is stated once, in the shipped skill for adding vocabulary under
the repository's skills directory. That skill serves both a user defining items in their
own project and a contributor adding a built-in, so it is the source and this rule never
repeats it. This rule holds only what is true inside this repository.

## How an item reaches a scene

- A built-in is named by a string, as in `a.do("sitDown", { mood: "dejected" })`. Its
  parameters are typed per name through a generated type map, and an unknown name is an
  error that lists the nearest valid names.
- Any item, built-in or a user's own, can also be passed as its definition object. That
  is how a user's item is used: no registration and no name collision, and adding a
  built-in name later breaks nobody.
- A per-scene registry of names is not part of the first release. It can be added
  without a break.
- Types are erased before a scene runs and an empty folder has no compiler, so unknown
  names, bad parameters and the catalog listing all work from the parameter
  specification as runtime data. That specification is part of the public definition
  API.
- Names are unique within a kind, not across kinds: the method called already says which
  kind is meant. The catalog and every error name the kind beside the name.

## The shape of a definition

- Parameters are declared once, as plain data marked `as const`, and the TypeScript type
  is derived from it. Each key states its `type` (`number`, `enum`, `boolean`, `color`,
  `point`, `text`, `prop`), a `default` (a key without one is required), a range or the
  allowed values, a unit and a `doc` line. Helper calls such as a number builder fail
  under isolated declarations, and an interface written beside the data drifts from it.
- A definition's export is annotated with its definition type; the `build` or `draw`
  member is declared as a method, which is what keeps a specific definition assignable
  to the general type. The export is named for the item and its kind, since a name such
  as `throw` is a reserved word.
- Options and timing share one bag, so a parameter may not be named `at`, `duration`,
  `mood`, `blend` or `mode`. The types do not catch that, nor a default outside the
  allowed values; the `define…` function rejects both when it runs.
- An action's `build` receives a clip with an actor's depth 2 and 3 calls, time 0 at the
  action's start, and the resolved parameters. It records and returns nothing. An action
  states its marks, and built-in actions stay free of functions on the timeline so that
  a scene written at depth 1 serialises without loss.
- An expression returns face channels. A prop, backdrop or effect has a `draw` that
  receives the drawing interface, the resolved parameters and the same second argument a
  depth 4 callback gets, in row units with the origin at the item's ground point.
- `mood` is an option of every action and takes any expression name. An action lists the
  moods that also change the body.
- An action that moves a prop takes it as a parameter: the scene passes the prop's
  handle, and `build` writes that prop's track — held by an effector until a mark, then
  along a closed-form path. This is how `throw`, `pickUp`, `push` and `carry` work, and
  it is not interaction between actors.
- The sample is a builder callback, `sample(stage)`, which the consumer passes to
  `scene`. A sample that called `scene` itself would import the root entry and close the
  cycle named below; this way an item imports nothing for its sample, and built-ins and
  a user's items are written the same way. A sample passes definitions, never names.
- The root entry exports the `define…` functions, the definition and parameter types,
  and the built-in maps. The individual built-in definitions are not root exports.

## The definition API

- `defineAction`, `defineExpression`, `defineProp`, `defineBackdrop` and `defineEffect`
  in `src/scene/define.ts` take `name`, `description`, an optional `params` and the
  `build` (action, expression) or `draw` (prop, backdrop, effect) method, plus an
  optional `sample`; an action also takes optional `marks` and `moods`. Each checks the
  shape when it runs and returns a frozen copy with its `kind` added. A missing or
  malformed member throws `InvalidDefinitionError` (`ERR_DEFINE_INVALID_DEFINITION`), a
  taken parameter name `ReservedParameterError` (`ERR_DEFINE_RESERVED_PARAMETER`), a
  default the parameter does not allow `InvalidDefaultError`
  (`ERR_DEFINE_INVALID_DEFAULT`); each carries the `kind` and the dotted `path`, such as
  `params.speed.default`, never the value. A `prop` parameter outside an action is a
  malformed `type`.
- A parameter's spelling: `number` takes `min`, `max` (both inclusive, either optional)
  and `unit`; `enum` takes `values`, a non-empty list without repeats; `color` is any
  non-empty string; `point` is `{ x, y }` with finite numbers; `prop` has no default.
  Every key has a `doc`. The types are `Param`, `ParamSpec`, `ParamValue`, `ParamArgs`
  (what a scene passes), `ResolvedParams` (what `build` and `draw` receive) and
  `NoParams`.
- The methods are `a.do`, `a.express`, `row.prop`, `row.backdrop` and `row.effect`, each
  taking a built-in name or a definition, then one bag of parameters and options. `do`
  takes `at`, `duration`, `mood`, `blend` and `mode`: the clip's calls default to that
  `blend` and `mode`, `clip.duration` is the asked `duration` or `null`, and the action
  occupies the asked duration or else what it recorded. A mood is a face pose over the
  action's span, recorded beneath the action's own calls so a face the action sets wins;
  like any ended pose it is held afterwards, until a later call moves the face. An
  action's or expression's `build` that throws propagates out of `scene()`, as the
  scene's own code does. `express` takes `at`, `duration`, `blend` and `mode` and
  records a pose of the face channels `build` returns. A prop, backdrop or effect takes
  `at` (default 0) and `duration` (default open-ended).
- A prop handle has `place(point, { at })`, an open-ended segment that puts the prop's
  ground point on `point`; inside an action's `build` the prop parameter is a view of
  the handle whose `at` counts from the action's start. `clip.mark(name, t)` sets a
  stated mark in the action's time; a stated mark left unset is a finding and falls on
  the action's end.
- A name is looked up with `Object.hasOwn` in the built-in map of its kind, and an
  unknown one is `ERR_SCENE_UNKNOWN_<KIND>` with nearest names by the metric the rest of
  the scene layer uses (`src/check/nearest.ts`): Levenshtein distance ignoring case, at
  most three, none further than half the name's length or two edits. A bad parameter is
  `ERR_SCENE_OUT_OF_RANGE` (a number; clamped into range, with `measured` holding
  `value`, `min` and `max`), `ERR_SCENE_INVALID_VALUE` (another type) or
  `ERR_SCENE_MISSING_PARAMETER`, each continuing with a placeholder. An action whose
  prop parameter is missing or not a handle of the scene is not run and is recorded as a
  wait.
- The built-in maps (`builtinActions` and its siblings) and their types
  (`BuiltinActions` and its siblings, empty interfaces until the generated index fills
  them) are in `src/scene/builtins.ts`; the methods that take a name are typed through
  them with `BuiltinName`. `define.ts` never imports the maps. A prop, backdrop or
  effect segment records its `name`, its `params`, and its `definition` only when it was
  passed as one (`null` for a built-in named by a string), so a depth 1 scene of
  built-ins serialises without loss.

## Inside this repository

- One item is one module. The built-in index is generated by a script, and a test that
  fails when it is stale lands with that script; nothing registers itself on import,
  because the package declares no side effects.
- Built-in items use only what the root entry exports. An item imports the defining
  modules directly and builds its sample lazily, since importing the root entry from an
  item would close a cycle through the generated index.
- Every item's export carries a full explicit type annotation. Isolated declarations
  report a missing one only under the build configuration, so the narrowest check for an
  item includes `tsc -p tsconfig.build.json`.
- A released name is contract: adding one is a minor change, renaming or removing one is
  breaking.
- Assets are self-made and CC0.
- One file per item is kept as the vocabulary grows. If the packed tarball reaches the
  limits in `scripts/check-package.mjs`, the limit is raised in its own pull request
  with the measured numbers, as a gate change a human approves; items are not merged
  into larger files to stay under it.
- Re-recording a sample is done after looking at its check images, never to make a test
  pass.
