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
  `mood`, `blend` or `mode`, and an effect's may not be named `on`, which only
  `row.effect` takes: a prop keeps the name, since `on` is what a lamp's switch would be
  called. The types do not catch that, nor a default outside the allowed values; the
  `define…` function rejects both when it runs.
- An action's `build` receives a clip with an actor's depth 2 and 3 calls, `cycle` among
  them, time 0 at the action's start, and the resolved parameters. It records and
  returns nothing. An action states its marks, and built-in actions stay free of
  functions on the timeline so that a scene written at depth 1 serialises without loss.
- An expression returns face channels. A prop, backdrop or effect has a `draw` that
  receives the drawing interface, the resolved parameters and the same second argument a
  depth 4 callback gets, in row units with the origin at the item's ground point. That
  argument's `view` is the row's visible area (`.claude/rules/engine.md` § Sequencing),
  which is how a backdrop learns the row's width.
- `mood` is an option of every action and takes any expression name. An action lists the
  moods that also change the body.
- An action that moves a prop takes it as a parameter: the scene passes the prop's
  handle, and `build` writes that prop's track — held by an effector until a mark, then
  along a closed-form path. This is how `throw`, `pickUp`, `push` and `carry` work, and
  it is not interaction between actors.
- The sample is a builder callback, `sample(stage)`, which the consumer passes to
  `scene`. A sample that called `scene` itself would import `scene/scene.ts`, which
  loads the built-in index, and close the cycle named below; this way an item imports
  nothing for its sample, and built-ins and a user's items are written the same way. A
  sample passes definitions, never names.
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
  `express` that starts inside the action ends the mood there on the channels it names
  (`.claude/rules/engine.md`, Sequencing). An action's or expression's `build` that
  throws propagates out of `scene()`, as the scene's own code does. `express` takes
  `at`, `duration`, `blend` and `mode` and records a pose of the face channels `build`
  returns. A prop, backdrop or effect takes `at` (default 0) and `duration` (default
  open-ended).
- `row.effect` also takes `on`, where the effect's origin is (`EffectOptions`): a point
  of the row, an actor of the row, which is the centre of its head, or an `EffectAnchor`
  `{ actor, part, offset }` whose `part` (`AnchorPart`) is `head`, `pelvis`, `handL`,
  `handR`, `footL` or `footR`, the points a state description prints, a foot being its
  ankle point. On an actor the origin follows that part every frame
  (`.claude/rules/engine.md` § Drawing a frame). It is one option whose value has three
  shapes, not `on`, `part` and `offset` side by side: each option name is taken from
  every effect's parameters, and the object can take a member later, or `on` a prop's
  handle, without another. It is on `row.effect` and not on a handle, as a prop's
  `layer` is on `place`, because an effect has no handle: the call returns its span,
  which a scene needs to time the next thing. A value that is none of the three, or an
  actor that is not a handle of the scene, is `ERR_SCENE_INVALID_VALUE` and an actor of
  another row `ERR_SCENE_NO_ACTOR`, either leaving the effect on the row's origin; a
  part that is not one is `ERR_SCENE_INVALID_VALUE` with the nearest names and `head` is
  used; an offset that is not a point is `ERR_SCENE_OUT_OF_RANGE` and none is used, and
  so is a point of numbers that are not finite, which leaves the effect on the row's
  origin: a bad number is out of range everywhere else, `place` and `offset` included.
- A prop handle has three calls, and the one that started last says where the prop is (a
  later-recorded one wins a tie; before any, the row's origin).
  `place(point, { at, layer })` is an open-ended segment that puts the prop's ground
  point on `point`, behind the actor or with `layer: "front"` in front of it
  (`.claude/rules/engine.md` § Drawing a frame). `hold(effector, { at, offset })` is an
  open-ended segment that carries the ground point on a hand or a foot (a foot is its
  ankle point) of the row's first actor, moved by `offset` with `x` the way the holder
  faces. `move(to, { at, duration, arc })` is a bounded segment, 0.5 s unless told
  otherwise, that takes the prop from where it was at its start to `to`: a straight line
  at constant speed lifted by `4 · arc · p · (1 − p)`, so a thrown thing's parabola is
  data and serialises; the prop stays on `to` afterwards, and a move counts towards the
  scene's length. Inside an action's `build` the prop parameter is a view of the handle
  whose `at` counts from the action's start and whose holder is the actor doing the
  action. A hold in a row with no actor yet, or inside an action done by another row's
  actor, is `ERR_SCENE_NO_ACTOR`, one by something that is not an effector
  `ERR_SCENE_UNKNOWN_EFFECTOR`; neither is recorded. The option types are `HoldOptions`
  and `MoveOptions`. `clip.mark(name, t)` sets a stated mark in the action's time; a
  stated mark left unset is a finding and falls on the action's end.
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
  named by a string), so a depth 1 scene of built-ins serialises without loss. An effect
  segment also records `on`: `null`, the point, or the actor's track key with the part
  and the offset, all data.

## Inside this repository

- One item is one module, `src/vocabulary/<kind>s/<name>.ts`: the file name is the name
  a scene uses and the export is that name and the kind, so `actions/throw.ts` exports
  `throwAction`. The built-in index is generated from those files by
  `scripts/build-vocabulary-index.mjs` (`pnpm vocabulary:index`; `--check` only
  reports), and `tests/vocabulary-index.test.ts` fails when the committed index is not
  byte-identical to a fresh one; nothing registers itself on import, because the package
  declares no side effects. The script writes the text Prettier would leave, so the
  format check and the staleness test agree.
- Built-in items use only what the root entry exports, and import each name from the
  module `src/index.ts` re-exports it from (`defineProp` from `../../scene/define.js`,
  `Stage` from `../../scene/handles.js`), never from the root entry. The root entry,
  `scene/scene.ts` and `scene/builtins.ts` load the built-in index, so an item that
  imported one of them would close a cycle (root entry → `scene/builtins.ts` → index →
  item) that loads only under a particular import order; the lint rule for
  `src/vocabulary/**` rejects those three, the built-in index and `src/internal/`. A
  specifier cannot tell `defineProp` from a private export of the same module, so
  `tests/vocabulary-imports.test.ts` checks, for every item, that each name is a root
  export taken from its defining module, a value only where the root exports a value; it
  also walks the items' run-time imports and fails if they reach the index,
  `scene/builtins.ts` or the root entry. Nothing depends on import order: an item module
  can be imported on its own. An item builds its sample lazily, as a method, so the
  sample may name the item itself and other items' definitions.
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
  frames spread over an action's or an effect's sample, and of one frame of an
  expression's or a prop's, one call a line. An effect is recorded like an action
  because it moves: its frame 0 is the start of its first droplet or star, which shows
  nothing, and `catalog --images` draws both as a contact sheet. That one frame is the
  one `catalog --images` draws (`sampleFrames` in `src/check/catalog.ts`). An
  expression's is the sample's last: it blends in from the resting face, so frame 0 is
  the same resting face for every expression and pins nothing. A prop's is frame 0: a
  prop with a moving part (`lever`, `cart`) shows its start state there, and a sample
  that gives the prop a `duration` ending with the sample has no prop in its last frame,
  so that image and record would be empty. The same file runs every action alone at the
  ends of its parameters, under every mood and at a short and a long `duration`, and
  fails on any finding but leaving the frame; a joint limit met by a built-in is a
  defect of the built-in.

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
- A prop that faces a way takes it as an enum of `left` and `right`, named for what
  faces (`faces` on `hoop` and `laptop`, `handle` on `lever` and `cart`), and its `draw`
  mirrors the whole drawing with `scale(-1, 1)`. The default suits a figure standing to
  its left, since vocabulary is written facing right.
- A prop's parameters are fixed for as long as it is shown and an action writes only its
  track, so a part that moves is a parameter read against `moment.time`: `lever` starts
  at `tilt` and turns by `swing` from `swingAt` over `swingFor`, eased, and `cart`'s
  wheels start at `turn` and turn for a `roll` of that many units from `rollAt` over
  `rollFor`, at constant speed like the `move` they accompany. Both keep the end state,
  so one prop shows the whole motion; scene time, not the segment's `progress`, because
  an open-ended prop has none. `rock` has no moving part. Each description states its
  part and the points a scene needs: the lever's handle end, the cart's deck at 0.24,
  the desk's surface at its `height`, the hoop's rim straight above its ground point,
  the lightbulb's ground point at the tip of its base.
- A backdrop paints its own opaque fill over the whole of `moment.view`, wall or sky
  from the ground line up and floor below it, and its description says so. The frame's
  white paper would otherwise show wherever a backdrop stopped, and a row with a
  backdrop reads as a panel beside one without. It is anchored on the row's origin,
  where the actor stands, and repeats or extends outwards from there (`court`'s fence
  posts, `office`'s windows, `hill`'s crests, `night`'s stars one to a cell), so a wider
  row shows more of the same picture and a scene keeps its composition when its canvas
  or row count changes. Whatever is not a fill stays paler than ink and thinner than the
  figure's line, and detail hangs above head height or lies below the ground line: the
  figure and the props are the subject. `night` fades to a light horizon for the same
  reason, since the figure is ink. A backdrop has no moving part and takes colours, and
  at most one switch (`office`'s `blinds`, `night`'s `moon`).
- A backdrop's record is its sample's frame 0, as a prop's is, and a second record of
  the definition alone in row 2 of a four-row scene, where the row is four times as wide
  as it is high.
- An expression other than `neutral` takes `intensity`, 0 to 1, and scales every
  channel's distance from rest by it. `neutral` sets all eight channels, which is what
  lets it clear another expression.

## The six solo actions

- `stand` records two open-ended `cycle` calls and nothing bounded, so alone it is the
  open-ended-only error and beside a bounded call it does not lengthen the scene. One
  cycle names every angle and `pelvisY`: the stance, constant, and the breath on the
  back, neck and shoulders, in for 0.42 of a 3.4 s period and out until 0.9. The other
  adds to `eyeOpen` and shuts the eyes four times in 10.4 s (at 1.2, 4, 4.35 and 7.6 s,
  so the sample's sheet shows two), one of them a double blink: the timing varies by
  being keyed unevenly, not by the random source, which a clip has no access to; every
  actor therefore blinks on the same beat. It adds −1.5, which shuts the widest eye of
  any mood, and the drawing stops at 0.
- There is no placement call yet, so where an actor stands is `pelvisX`, which a pose
  holds. `walk` and `run` take `from` (default 0) and `distance`, set `pelvisX` to
  `from` at once and leave it on `from + distance`; a second one names where the first
  ended. `point` takes `from` for the same reason: its aim is an angle from the
  shoulder. `stand`, `cheer` and `think` move no root `x` and plant no foot by `reach`,
  so they play wherever the actor is. `sitDown` and `throw` still plant their feet
  around 0; the placement call is what removes `from`.
- `walk` and `run` share one recorder, `stride` in `actions/walk.ts`, driven by a `Gait`
  of numbers; a mood is another `Gait`. A foot on the ground is a `reach` on its spot
  from its landing until its next step is under way, so it cannot slide; its heel peels
  up over the toe before it leaves; in the air it is three overlapping reaches (up
  behind, through, down). The hips' steady speed is poses of `pelvisX` overlapped four
  deep, since one blend is eased, which keeps it within a fourteenth of steady; their
  height is keyed between and over the supports, and no higher than both legs can span
  while both feet are down. The ankle is keyed from the same geometry so the foot lies
  flat. A `duration` scales the pace; the number of steps follows `distance` alone.
- A walk is 0.32 a step and 0.46 s a beat, both feet down for 0.12 of a beat; a run is
  0.46 a stride and 0.27 s a beat, both feet off the ground for 0.38 of one, leaning in,
  with the heels kicked up. The default `distance` of each is 0.9, which stays inside a
  square one-row frame from its middle; their samples go from −0.9 to 0.9.
- Moods: `stand` lists `dejected` (sagging, slow breath); `walk` `dejected` (a trudge)
  and `happy` (a bounce); `run` `surprised` (fleeing, arms up) and `dejected` (a plod);
  `cheer` `happy` (jumps) and `dejected` (a limp wave); `point` `angry` (jabs twice,
  fist on hip) and `surprised` (leans away); `think` `happy` (ends on the idea, finger
  up) and `dejected` (scratches its head and gives up).
- Marks: `cheer` states `up` and `point` states `aimed`, the moments an effect or a
  label is timed to. The others state none.
- A joint that arrives on or near its limit is posed without `followThrough`, in a pose
  of its own beside the one that overshoots: a straight elbow or knee, a shoulder raised
  past 3.
- Each pose of these actions lasts until the next one on its channels has arrived, not
  only until it starts (`.claude/rules/engine.md` § Sequencing), so an action plays the
  same alone and over an open-ended `stand`. The sweep in
  `tests/vocabulary-samples.test.ts` runs every action both ways.

## The three actions that move a prop

- `pickUp`, `push` and `carry` take the prop as `prop` and `from` as `walk` does: every
  foot and hand target is counted from `from`, so each plays where a walk ended.
- An action cannot ask a prop where it is, so the scene says: `where` is the prop's
  ground point from the actor's feet, and `grip` the spot on the prop the hands take,
  from its ground point. `where` is the placement and `grip` a fact of the prop's shape,
  which is why they are two points; the defaults fit a default `box` (`pickUp`, `carry`)
  and a default `rock` (`push`). `carry`'s `deck` and `handle` are from the feet, since
  they are two spots on one cart.
- A prop is on a hand only while it is in the hands: `pickUp` holds it on `handR` from
  the mark `grip`, `carry` from its start. What travels along the ground is a `move`,
  never a hold: a hand's height wobbles with the IK beneath it, and the `cart`'s `roll`
  and the `lever`'s `swing` were made for one `move` at constant speed. The hands follow
  the moving prop instead, in reaches cut 0.06 s short (`glide` in `actions/push.ts`): a
  reach is eased, and one long one would leave a prop that moves at constant speed. They
  keep to it within 0.015.
- `push` with `distance` 0 records nothing on the prop, which is what "gets nowhere" is:
  the track the scene wrote is the whole track. The strain is `tries` heaves, the back
  foot skidding after each. With a distance the prop is a `move` from the mark `heave`
  to the mark `stop` and the actor walks behind it with `stride`.
- `by` picks the tool: `push` `hands` or `lever`, `carry` `arms` or `cart`. A second
  prop cannot be a parameter that is left out, since a `prop` parameter has no default,
  and an action cannot set a prop's parameters, so the tool is the scene's: it makes the
  lever or the cart after the action, with `swingAt` and `swingFor`, or `roll`, `rollAt`
  and `rollFor` and a `move`, from the marks the span returned. The action only puts the
  hands where the tool's handle is and goes (`grip` and `press`; `handle`), and for a
  cart sets the load down on `deck` and moves it as the cart is moved. Each description
  spells the calls out. A prop made after the action draws after the one it moves.
- Marks: `pickUp` `grip` and `up`; `push` `contact`, `heave` and `stop`; `carry`
  `loaded`, `off` and `stop`. `heave` to `stop`, and `off` to `stop`, are the times a
  moving part is given.
- Each lists `dejected`: `pickUp` heaves in two goes and ends stooped with the prop held
  low, `push` is slower and ends stooped, `carry` trudges bowed. `carry` walks in the
  pose `pickUp` ends in, under either mood, so the prop does not jump between them.
- `stride` takes a fifth argument, when it starts and how long it may last, and returns
  when the hips leave and arrive, for an action that does something before walking;
  `strideTime` is its natural length. A foot under a deep crouch comes up on its toe
  once the ankle is on its limit (`squat` in `actions/pickUp.ts`).

## The four effects

- An effect draws around its origin and its description says what that origin is, which
  is what a scene's `on` should name: the centre of a head for `sweat` and `sparkle`
  (`on: actor`), the middle of what moves for `speedLines` (an actor's `pelvis`, or a
  hand or foot with a smaller `spread` and `length`), the point of contact for `impact`
  (a point of the row, or a hand or foot).
- `sweat`, `sparkle` and `speedLines` repeat for as long as they are shown: each
  droplet, star or streak lives one period (0.6 s, 0.8 s, 0.36 s) and the next takes its
  place. Their time is the moment's `t`, counted from the effect's start whether it has
  a duration or is open-ended, so an open-ended effect builds up from its `at` as a
  bounded one does, and what it shows does not depend on `at`. `impact` plays once over
  its duration, about 0.4 s, and without one is a still burst.
- The things of a repeating effect start staggered by a fraction of the period each, and
  one that would have started before the effect did is not drawn: the effect builds up
  over its first period from nothing, which is what its progress 0 shows, instead of
  appearing with droplets already in mid-air.
- Scatter is `moment.random.float` at `(cycle × count + i) × 3` and the two after it,
  for thing `i` in its `cycle`-th life: a pure function of the frame's time, so frame
  `n` needs no other frame, and every life is scattered afresh. Each thing keeps to its
  own slice of the fan, ring or band, so two never draw on each other. `impact` reads
  one number for its turn and one for each point and line.
- An effect is an accent: thinner than the figure's line (0.007 to 0.018 against 0.025),
  no larger than a head unless a parameter asks, and clear of the face. `sparkle`'s ring
  starts 0.75 of its `radius` out, past the head's edge at the default; `sweat` leaves
  from the head's edge upwards; `speedLines` starts a `gap` behind its origin.
- An effect that faces a way is written facing right, as an action is: `speedLines`
  trails to the left. On a left-facing actor the engine mirrors it with the figure;
  `moving` is for a subject that moves the other way than it faces, or a point.
