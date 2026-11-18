---
paths:
  - "src/vocabulary/**"
  - "skills/**"
---

# Built-in vocabulary

How an item is written — its shape, its parameters, its sample, and the loop of check,
catalog, look and fix — is stated once, in the shipped skill
`skills/charade-vocabulary/SKILL.md`. That skill serves both a user defining items in
their own project and a contributor adding a built-in, so it is the source and this rule
never repeats it. This rule holds only what is true inside this repository.

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
- A prop handle has three calls, and the one that started last says where the prop is (a
  later-recorded one wins a tie; before any, the row's origin). `place(point, { at })`
  is an open-ended segment that puts the prop's ground point on `point`.
  `hold(effector, { at, offset })` is an open-ended segment that carries the ground
  point on a hand or a foot (a foot is its ankle point) of the row's first actor, moved
  by `offset` with `x` the way the holder faces. `move(to, { at, duration, arc })` is a
  bounded segment, 0.5 s unless told otherwise, that takes the prop from where it was at
  its start to `to`: a straight line at constant speed lifted by
  `4 · arc · p · (1 − p)`, so a thrown thing's parabola is data and serialises; the prop
  stays on `to` afterwards, and a move counts towards the scene's length. Inside an
  action's `build` the prop parameter is a view of the handle whose `at` counts from the
  action's start and whose holder is the actor doing the action. A hold in a row with no
  actor yet, or inside an action done by another row's actor, is `ERR_SCENE_NO_ACTOR`,
  one by something that is not an effector `ERR_SCENE_UNKNOWN_EFFECTOR`; neither is
  recorded. The option types are `HoldOptions` and `MoveOptions`. `clip.mark(name, t)`
  sets a stated mark in the action's time; a stated mark left unset is a finding and
  falls on the action's end.
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
  (`BuiltinActions` and its siblings, one `readonly name: typeof nameKind` member per
  item, an empty interface for a kind with no item yet) are written by the generated
  index, `src/vocabulary/index.ts`, and re-exported by `src/scene/builtins.ts`, which
  the root entry and the scene layer read them from; the methods that take a name are
  typed through them with `BuiltinName`, a root export since those signatures name it.
  The index marks each member `@hidden` and lists the names in the interface's remarks:
  the API reference would otherwise print every item's parameter specification as an
  undocumented type, and `charade catalog` is where parameters are read. `define.ts`
  never imports the maps. A prop, backdrop or effect segment records its `name`, its
  `params`, and its `definition` only when it was passed as one (`null` for a built-in
  named by a string), so a depth 1 scene of built-ins serialises without loss.

## Inside this repository

- One item is one module, `src/vocabulary/<kind>s/<name>.ts`: the file name is the name
  a scene uses and the export is that name and the kind, so `actions/throw.ts` exports
  `throwAction`. The built-in index is generated from those files by
  `scripts/build-vocabulary-index.mjs` (`pnpm vocabulary:index`; `--check` only
  reports), and `tests/vocabulary-index.test.ts` fails when the committed index is not
  byte-identical to a fresh one; nothing registers itself on import, because the package
  declares no side effects. The script writes the text Prettier would leave, so the
  format check and the staleness test agree.
- Built-in items use only what the root entry exports, and import it from there
  (`../../index.js`): the lint rule for `src/vocabulary/**` rejects every other module
  of `src/`. That closes a cycle, root entry → `scene/builtins.ts` → index → item → root
  entry, and an item calls `define…` as it loads, so two orderings hold it up.
  `scene/builtins.ts` imports `./define.js` before the index, and `src/index.ts`
  re-exports `./scene/define.js` before `./scene/builtins.js`; a module runner that
  fills an entry's exports as it goes, as the test runner does, otherwise hands an item
  a root entry without `define…` yet. For the same reason no test or script imports an
  item module directly: it reaches an item through the maps, or through another item's
  import. An item builds its sample lazily, as a method, so the sample may name the item
  itself and other items' definitions.
- An item's `ActionDefinition` annotation states its marks, `never` when it has none:
  the type's own default is `string`, which would type every `a.do("name")` as a span
  with any mark.
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
- A sample is recorded by `tests/vocabulary-samples.test.ts`: the drawing calls of seven
  frames spread over an action's sample, and of one frame of an expression's or a
  prop's, one call a line. The same file runs every action alone at the ends of its
  parameters, under every mood and at a short and a long `duration`, and fails on any
  finding but leaving the frame; a joint limit met by a built-in is a defect of the
  built-in.

## The first three actions

These set the conventions the later items follow.

- How an action scales its timing, plants its feet and composes with another is in the
  skill; what follows is what these items chose.
- A mood an action lists changes timing and body through `clip.mood`; the face is the
  mood's own and an action does not set it. `sitDown` lists `dejected` (drops, then
  sags, head hanging); `slump` lists `dejected` (deeper and slower); `throw` lists
  `focused` (holds its aim before the throw) and `dejected` (a weak toss that lands at
  0.55 of the way and ends hunched).
- `slump` moves only the back, neck and arms, so it works standing and over the seated
  pose `sitDown` leaves; an action that should compose with another leaves that one's
  channels alone.
- `box` is the seat: `sitDown` takes the seat's height as `seat`, a number that defaults
  to the box's default height, not the prop, because a `prop` parameter has no default
  and sitting needs nothing moved. The scene places the box 0.24 behind the actor, where
  the hips come down. `slump` uses it only through `sitDown`'s pose, and `throw` not at
  all; the box's description says so.
- `throw` states one mark, `release`. The prop rides `handR` from the action's start,
  lowered 0.05 into the palm, and at `release` moves to `to` on an arc of `loft`, in the
  air for `sqrt(8 · loft / 12)` seconds: twice the gravity a figure 1 unit tall would
  see, since at the real value a throw short enough to stay in a one-row frame floats.
  `to` defaults to a point inside that frame, so the default throw leaves no warning.
  `bounce` adds one hop of 0.12 past it.
- An expression other than `neutral` takes `intensity`, 0 to 1, and scales every
  channel's distance from rest by it. `neutral` sets all eight channels, which is what
  lets it clear another expression.
