---
paths:
  - "src/scene/**"
  - "src/timeline/**"
  - "src/rig/**"
  - "src/draw/**"
---

# Engine: scene, timeline, rig, drawing

These four layers are pure: they run unchanged in a browser, so a demo page can bundle
them later without a change to the published contract. AGENTS.md's Architecture section
holds what may import what. What follows is what every vocabulary item and every
recorded sample is written against; changing any of it changes all of them at once.

## Time

- A scene states time in seconds, as in `{ at: 1.2 }`. The timeline stores it as integer
  microseconds, quantised when the call is recorded. Float seconds drift: `0.1 + 0.2`
  lands past a frame boundary at 30 fps, and a decimal such as 4.1 s falls one frame
  short under `Math.floor`.
- Each value is quantised on its own by rounding to the nearest microsecond, a half up,
  and sums are taken in microseconds afterwards: truncation would turn 4.1 s into 4 099
  999 µs. A negative, non-finite or unsafely large time is rejected
  (`ERR_SCENE_OUT_OF_RANGE`), and `-0` is stored as `0`.
- Frame `n` is drawn at `n / fps`, counted from 0. Segments are half-open. Time is
  computed from `n` each frame and never accumulated.
- A frame time is rarely a whole microsecond, so frames are compared with stored times
  by cross-multiplying in integers (`n × 1e6` against `µs × fps`), never by rounding the
  frame's time. `fps` is a positive integer; 29.97 is rejected.
- Frame `n` is a pure function of the timeline and `n`. A single frame asked for by time
  or number equals that frame of a full render, so nothing in a frame may depend on an
  earlier frame having been drawn.
- Motion that carries state (a spring, a follow) is simulated once, at a fixed step,
  while the scene runs, and stored on the timeline as data. Evaluating it frame by frame
  would make frame `n` depend on frame `n - 1`; allowing only closed forms would rule
  out following a moving target. Baked motion also serialises.
- Baked motion is sampled every 4 000 µs (250 per second), from the motion's start until
  a sample reaches its end: a whole number of microseconds, independent of fps, and
  several samples per frame at 30 or 60 fps without bloating the JSON form.
- No authoring call bakes motion yet: an actor has `pose`, `reach`, `drive` and `wait`,
  and a follow needs a prop to follow. A spring or follow call records a baked segment
  through `bakeMotion` when it is added.
- A scene of duration `d` has `d × fps + 1` frames: the frame at `t = d` is drawn, so
  the final pose is always in the video and on the contact sheet.
- Duration is the end of the last bounded segment in any row, rounded up to a frame; the
  `duration` option overrides it. An open-ended track (a `stand` with no duration, a
  label with none) runs to the end and does not extend it. A scene with only open-ended
  tracks and no `duration` is an error.
- An explicit `duration` is rounded up to a frame like a computed one. Duration
  computation returns a result rather than throwing, and a timeline with no tracks at
  all fails the same way as one with only open-ended tracks; the scene layer turns that
  result into its finding.

## The scene

- `scene(options, build)` or `scene(build)`. The options are data known before the first
  call — `width`, `height`, `fps`, `rows`, `seed`, `font`, `duration` — so a call on a
  row the scene does not have fails on that line. `build` receives the stage and runs
  once, synchronously, inside `scene()`; a callback that returns a promise is rejected.
- The default export is frozen data, not a function: `kind: "charade.scene"`, a version,
  the built timeline, and the findings recorded while authoring. A function would let
  the CLI run the scene twice, once to check and once to render.
- `stage.row(i)` returns the same handle on every call; row 0 is the top. The stage is
  also row 0, so a one-row scene writes `stage.actor()` and `stage.draw(...)` directly.
  On a scene with more rows those are an error that says to use `stage.row(i)`. There is
  no whole-canvas coordinate space.
- A row creates its backdrop, props, actor, labels and free drawing; an actor has `do`,
  `express`, `pose`, `reach`, `drive`, `say` and `wait`. Handles are variables. Each
  also has an id used in findings, built from the row, the kind, the name and the
  occurrence index — the same key the random source uses.
- The public names are `scene`, `SceneOptions` and `Scene` (the frozen result: `kind`,
  `version: 1`, `width`, `height`, `font`, `timeline`, `findings`, `truncated`; the
  frame rate, seed and rows are read from `timeline`), the handles `Stage` (a `Row` plus
  `row(i)` and `sync()`), `Row` and `Actor`, and their option types `ActorOptions`,
  `PoseOptions`, `ReachOptions`, `DriveOptions` and `DrawOptions`. Handles are
  interfaces an author is handed and never implements, so a later issue adds a method as
  a minor change. `row.actor` and `row.draw` take an options bag rather than a
  positional name, so placement and layering can be added the same way.
- An id is `row<i>` for a row and `row<i>/<kind>/<name>/<occurrence>` for an item; an
  actor's default name is `actor` and a drawing's is `draw`.
- A bad scene option is a finding and its default is used (`rows` is clamped into 1–4
  when it is a whole number), as is a missing `build`: the rest of the scene is still
  checked. `stage.actor()` or `stage.draw()` on a scene with more rows is also a
  finding, `ERR_SCENE_ROW_REQUIRED`, recorded on row 0, since row 0 is a placeholder to
  continue with; it is reported once per scene, so a loop cannot fill the cap. Only
  three things are thrown: a promise returned by `build` (`AsyncBuildError`), a row the
  scene does not have (`UnknownRowError`), and a handle used after `scene()` returned
  (`SceneClosedError`, which is also what an async build meets after its `await`).
- A second actor in a row is a finding (`ERR_SCENE_ROW_HAS_ACTOR`) and is still recorded
  on its own track.
- An author's channel map is copied when the call is recorded; the scene never freezes
  or keeps an object the author owns, only the functions given at depth 3 and 4.
- A row shows 2.5 units of height at every row count, with the ground line 0.3 units
  above its lower edge; the visible width follows from the canvas and the row count. The
  two numbers are tuned on the first three actions and are contract after the first
  release.
- Rows are stacked top to bottom, each a band of `height / rows` pixels spanning the
  canvas width, so a unit is `height / rows / 2.5` pixels. A row is drawn under
  `setTransform(s, 0, 0, −s, width / 2, groundY)`: the negated `y` scale turns row
  units, `y` up, into canvas pixels, `y` down, with the origin on the ground line at the
  band's centre. The transform is set absolutely for every row, never accumulated, so no
  row depends on another having been drawn. This is `rowLayout` and `rowTransform` in
  `src/draw/layout.ts`.
- A row clips its drawing to its band: rows are separate panels, and a figure lifted
  past its row's top would otherwise draw over the row above.

## Sequencing

- Each actor has a cursor. A call without `at` starts when everything already recorded
  on that actor has ended, so consecutive calls play in order. `at` is absolute scene
  time. Absolute time on every call would have the author do arithmetic on every line.
- Every recording call returns a span: `start`, `end`, `duration` and named `marks` (the
  release of a throw), all in seconds. Parallel motion and timing across rows are
  written with those numbers; all rows share one clock. `stage.sync()` moves every
  actor's cursor to the latest end.
- A call without `at` after an open-ended track has no cursor to start from and is an
  error with a fix line (`ERR_SCENE_NO_CURSOR`). It is reported once per actor, at the
  first such call, so one open-ended sway cannot fill the finding cap; that call and
  every later one is placed at the latest end recorded on the actor.
- The cursor is the latest end on the actor, so a call placed earlier with `at` never
  pulls it back. `wait` records a segment of its own, which is what lets a trailing wait
  lengthen the scene. `sync()` returns the time it moved to, counts free drawings as
  well as actors, and does not give a cursor to an actor that has an open-ended track.
- `Span` is generic in its mark names, `Span<Marks extends string = never>`, so an
  action can return `Span<"release">` later without a break; the calls of this layer
  state no marks. An open-ended call's `end` and `duration` are `Infinity`.
- `pose` and `reach` last `anticipation + blend + followThrough` when no `duration` is
  given: a pose with no options takes its 0.2 s arrival and the next call follows it. A
  shorter `duration` shortens the three phases in proportion, so a segment has always
  arrived when it ends. `drive` without a `duration` is open-ended, and `row.draw`
  without `at` starts at 0 and without a `duration` is open-ended; a drawing has no
  cursor.
- When two tracks drive one joint, the one recorded later wins for the joints it names,
  blended in and out; `mode: "add"` adds instead. So depth 2 and depth 3 override only
  the joints they name over a depth 1 action. A full-body action that cuts another is a
  warning. Joint limits are checked on the composed angle.
- Each segment blends in from the composed pose beneath it over `blend` seconds, 0.2 by
  default: six frames at 30 fps, short enough to read as one movement and long enough
  not to pop. `anticipation` and `followThrough` are options of `pose` and `reach`, in
  seconds, as closed-form curves.
- The arrival weight is 0 at the start and 1 at the end of the blend, eased by
  smoothstep (`3p² − 2p³`). Anticipation comes before the blend and dips the weight to
  −0.1 and back (`−0.1 · sin²(πp)`); follow-through comes after it and lifts the weight
  to 1.1 and back. A weight outside 0..1 extrapolates, which is the wind-up and the
  overshoot. The 0.1 is tuned on the first three actions. There is no `ease` option yet;
  it can be added without a break.
- A pose is held after its call ends, until a later call moves those channels: an ended
  `replace` segment stays as the base, a later end over an earlier one. Returning to
  rest instead would make a seated figure stand up during every `wait`. A `drive` is
  held at its last value, with `t` frozen at its duration.
- A segment that ends while an earlier-recorded one is still running on a channel blends
  back out to it over its own `blend`; this is the "out" of an override. Whether it does
  is decided at its end, so the fade goes on if the lower one ends meanwhile. An `add`
  segment is never held and always fades out. The mode's name is `BlendMode`, `replace`
  or `add`; `reach` has no mode.
- A `reach` is solved over the pose beneath it, while it runs and while it is held, so a
  held hand stays on its point when an earlier-recorded call still moves the back. A
  call recorded later than the reach that moves the body is not seen by it: the hand
  then leaves the point, and the reach is recorded again after that call.
- A full-body call is a `replace` pose that names all fourteen angles. One that starts
  while an earlier one is still playing is the warning `ERR_SCENE_FULL_BODY_CUT`.
- The composed pose at a frame is `poseAtFrame` in `src/rig/compose.ts`, internal. It
  compares in frame units (`µs × fps` against `n × 1e6`), reads a segment's data field
  by field so a parsed or hand-built timeline cannot break it, and skips a channel whose
  value is not a finite number.
- `drive` takes one function of time that returns a map of channel values, as in
  `a.drive(t => ({ spine: Math.sin(t * 3) * 0.1 }))`. The channels it names are the keys
  it returns when it is called once with `t = 0` as the call is recorded: an unknown
  name can then be a finding, and the override is limited to those joints. At a frame a
  key outside that set is ignored and a recorded key that is missing or not finite moves
  nothing. A function that throws at `t = 0` or returns no object is a finding and names
  no channel; an argument that is not a function is a finding and is recorded as a wait.
- A function at depth 3 or 4 receives `t`, seconds since its segment began, and a second
  argument with the scene time, the segment's duration and progress, and the keyed
  random source. That argument is `Moment` (`time`, `duration`, `progress`, `random`);
  the function types are `MotionFunction` (returns a map of channel values) and
  `DrawFunction` (draws on a `ShapeContext`), and the source is `RandomSource`. In an
  open-ended segment `duration` is `Infinity` and `progress` stays 0.

## The rig

```
pelvis (root: pelvisX, pelvisY)
├─ spine ─ chest ─ neck ─ head (face)
│          ├─ shoulderL ─ elbowL ─ [handL]
│          └─ shoulderR ─ elbowR ─ [handR]
├─ hipL ─ kneeL ─ ankleL ─ [footL]
└─ hipR ─ kneeR ─ ankleR ─ [footR]
```

- Fourteen angles: the thirteen joints in the tree and `pelvis`, the root's tilt. The
  back has two segments so a slump curves instead of hinging, and the ankles let a
  seated figure plant its feet. Wrists can be added later as a minor change. In order
  they are `pelvis`, `spine`, `chest`, `neck`, `shoulderL`, `shoulderR`, `elbowL`,
  `elbowR`, `hipL`, `hipR`, `kneeL`, `kneeR`, `ankleL`, `ankleR`.
- Names take a side suffix, as in `handR`. The four effectors in brackets are targets
  for `reach` and are not angles; using one as an angle is an error that names the
  angles of its chain (`ERR_SCENE_EFFECTOR_AS_CHANNEL`, carrying the effector and the
  chain). A chain is the two angles inverse kinematics sets: `shoulder`, `elbow` for a
  hand and `hip`, `knee` for a foot. The foot target is the ankle point; the ankle angle
  stays the author's, so a planted foot can still roll.
- `R` is the limb nearer the camera in both facings, because mirroring flips the
  picture. The catalog says so.
- The root carries position in the actor's own frame (`pelvisX`, `pelvisY`). Where the
  actor stands on the ground and which way it faces are separate. `pelvisX` and
  `pelvisY` are offsets from the pelvis's rest position, 0 at rest like the angles, so
  an action's root values survive a change of segment lengths.
- The face is eight symmetric numbers: `eyeOpen`, `gazeX`, `gazeY`, `browHeight`,
  `browTilt`, `mouthCurve`, `mouthOpen`, `mouthWidth`. At rest the eyes are open
  (`eyeOpen` 1), the mouth is its normal width (`mouthWidth` 1), and the rest are 0.
  Their ranges are `eyeOpen` 0..1.5, `mouthOpen` 0..1, `mouthWidth` 0.5..1.5, and the
  other five −1..1.
- `pose` and `drive` take one flat map of channels: angles, root and face. Two maps are
  interpolated linearly per channel, and progress 0 and 1 return the endpoints exactly
  rather than by the formula, which can miss by a rounding step. Progress outside 0..1
  extrapolates, so an overshooting easing carries through, and angles are not wrapped: a
  `pelvis` going from 0 to 2π turns the figure all the way over.
- An author names `ChannelName` (the twenty-four channels), `EffectorName`, `Point`, and
  `PoseChannels`; those are root exports. `ChannelName` is written out as literals,
  because a public type may not refer to an unexported one. The pose type, the angle,
  root and face unions, the limits and the kinematics stay internal.
- An unknown channel is the finding `ERR_SCENE_UNKNOWN_CHANNEL` with the nearest names,
  and an effector used as a channel is the finding `ERR_SCENE_EFFECTOR_AS_CHANNEL`
  naming its chain; either channel is dropped and the rest of the call is recorded.
  Nearest names are at most three, by edit distance, none when the name is further than
  half its length from every valid one.
- Joint limits and segment lengths are tuned on the first three actions. After the first
  release a change to either changes every recorded sample.
- Segment lengths, in units of figure height: thigh 0.24, shin 0.24, spine 0.14, chest
  0.14, neck 0.06, head 0.18 (a circle of diameter 0.18 on the neck), upper arm 0.17,
  forearm 0.16, foot 0.08. The column from ankle to head top sums to 1, so a rest figure
  stands 1 unit tall with its ankles and toes on the ground. Both hips sit on the pelvis
  point and both shoulders on the top of the chest: a stick figure seen side on.
- Joint limits, in radians: spine −0.3..0.9, chest −0.3..0.7, neck −0.7..0.9, shoulder
  −1.0..3.1, elbow 0..2.6, hip −0.5..2.1, knee 0..2.6, ankle −0.6..0.5. `pelvis` has no
  limit: it is the whole body's tilt, which a lie-down or a flip uses in full. A limit
  is inclusive at both ends and `NaN` is never within it.
- Inverse kinematics with a fixed bend direction cannot bend a knee backwards; a
  directly authored angle can, which is the case the limit check exists for.
- Inverse kinematics is analytic two-bone, with the knee bending forward and the elbow
  backward. A target out of reach is met by the limb fully extended toward it; one
  closer than the difference of the two bones by the limb fully folded toward it; one
  within 1e-9 units of the hip or shoulder, which has no direction of its own, along the
  limb's rest direction. Every finite target gives finite angles, so a reach that cannot
  succeed still draws a figure the check can flag. IK does not clamp to the limits: a
  foot target on the hip folds the knee to π, which the limit check flags. The first
  angle is read in the full turn centred on its limit's midpoint, which puts the cut
  behind and above the joint, inside the range no limit allows; centred on 0, an arm
  straight overhead would sit on it.

## Space and angles

- Coordinates are local to a row. The origin is on the ground line at the row's centre,
  `y` points up, and a standing figure is 1 unit tall. Pixels would tie every item to
  the row count, because a row's height changes between 1 and 4 rows.
- Angles are radians, relative to the parent joint, 0 at the rest pose, and positive in
  the direction the joint flexes. With that sign a joint limit is one comparison, which
  is what turns a knee bent backwards into a `check` finding. Facing right, `x` is
  forward: a positive hip, shoulder, elbow or ankle turns its segment counter-clockwise
  (the thigh or arm forward and up, the toe up), and a positive pelvis, spine, chest,
  neck or knee turns it clockwise (the body leaning forward, the shin folding back).
- Vocabulary is written facing right. The engine mirrors it for a figure facing left; an
  item never branches on facing. Mirroring negates every `x` of the posed skeleton and
  keeps every name and angle, so `R` stays the near limb; negation is exact, so
  mirroring twice gives back the original.
- Facing is read from the actor's track, a `facing` field of `"left"` or `"right"`,
  right when absent or anything else. No authoring call sets it yet, so only a
  hand-built timeline faces left; the field is not part of `TimelineTrack`, and the JSON
  reader, which wants a track's exact keys, rejects it. The call that places an actor
  adds it to both. The figure is mirrored about its ground point, which is the row's
  centre until placement exists: the skeleton through `mirrorSkeleton`, the face by
  negating the `x` of every offset from the head's centre. No mirrored primitive carries
  a rotation, so negating `x` is the whole mirror.

## Randomness

The random source is stateless and keyed: a 32-bit integer generator seeded from a hash
of the scene seed, the row, the item's kind and name, and its occurrence index. Adding a
track therefore does not reshuffle the others, and frames can be drawn in any order. A
function at depth 3 or 4 receives this source; it has no sequential stream to advance.

- The hash is 32-bit FNV-1a over the UTF-8 bytes of the key's JSON array
  `[seed, row, kind, name, occurrence]`: a well-known hash with published test vectors,
  and the array keeps `("ab", "c")` apart from `("a", "bc")`.
- The generator is mulberry32, seeded with that hash. Its state after `n` steps is
  `seed + n × 0x6D2B79F5`, so draw `n` is computed directly from its index; there is
  still no stream.
- The default seed is `0`: any fixed constant works, since the hash mixes it with the
  rest of the key.

## Serialised timeline

The JSON form carries `version: 1` and a canonical key order. Where a function at depth
3 or 4 was omitted it leaves a placeholder, and the document is marked as lossy. A
change to the shape raises the version.

- The text is compact JSON. The envelope's keys are `version`, `lossy`, `timeline` in
  that order, so the version is read first; every other object's keys are sorted by
  UTF-16 code unit, written by hand because an engine puts integer-like keys first.
- The placeholder is `{"$omitted":"function"}` and `lossy` is always present. A parsed
  document keeps the placeholder as data, so writing it back gives the same text.
- A non-finite number, `undefined`, an array hole or an object that is not plain (a
  `Map`, a `Date`, a typed array) is rejected when writing, since JSON would change it.
  Reading rejects a segment that ends before it starts and a number JSON reads as an
  infinity. Reading checks every field and reports invalid JSON, another version, or a
  wrong shape as a result.
- A scene exposes the timeline's skeleton: `Timeline`, `TimelineRow`, `TimelineTrack`
  and `TimelineSegment` are root exports, with times in integer microseconds. A
  segment's `data` is typed `unknown`: what a call records is not contract, so it can
  change without a version of its own. The value types of the JSON form stay internal.
- A segment's `data` is an object with a `kind`: `pose` (channels, mode, and the three
  phases in microseconds), `reach` (effector, target, phases), `drive` (the function,
  the channel names read at `t = 0`, mode, blend), `wait`, or `draw` (the callback).
  These live in `src/timeline/segments.ts`. Nothing is released yet, so this shape is
  still JSON version 1.

## The drawing interface

- The pure layers and the depth 4 callback draw on this package's own exported
  interface, not the DOM's type: the build has no DOM lib, and skia-canvas's context is
  not assignable to the DOM type (spiked 2026-11-12 with TypeScript 6.0.3 against
  skia-canvas's declarations on its main branch, not the 4.0.0 tarball). The interface
  is not named after the DOM's, which it would shadow in a consumer's program.
- Its membership is a rule, not a selection: every standard Canvas 2D member whose
  arguments and results are numbers, strings, or this package's own opaque handles. That
  excludes bitmap images and patterns, pixel readback, the back-reference to the canvas,
  and skia-only extensions. Pixel readback would break determinism; an image is a host
  object the recording context cannot log.
- Booleans count with numbers and strings (`arc`'s direction), and so do arrays of
  numbers (`setLineDash`, `roundRect`'s radii, typed `number | number[]` because
  skia-canvas's mutable array parameter rejects a `readonly` one). Host-object overloads
  are left out: `Path2D`, `DOMMatrix`, `DOMPointInit`, `Element`. So is `getTransform`,
  whose result is a `DOMMatrix`.
- Four members pass the rule and are still left out. `isPointInPath` and
  `isPointInStroke` are a hit test the recording context cannot answer without a
  rasteriser's geometry. skia-canvas implements neither `isContextLost` nor
  `fontVariantCaps`, so with them its context could not be handed over as this
  interface. `imageSmoothingEnabled` and `imageSmoothingQuality` belong to the image
  family: they only govern how an image is resampled.
- The names are `DrawingContext` (the full interface) and `ShapeContext` (the depth 4
  type); `DrawingContext extends ShapeContext` with the text members. The handles and
  shapes they return are `Gradient` (only `addColorStop`, structural so a real context's
  gradient satisfies it) and `TextMeasurement` (`width` and the six bounding box
  distances both real contexts report). All four are root exports.
- Properties are declared with a wide getter and a narrow setter. A plain writable
  property rejects one of the two real contexts (same spike). The pair differs only
  where the two contexts differ: `fillStyle` and `strokeStyle` read as `string | object`
  (a pattern or skia's texture) and take `string | Gradient`;
  `globalCompositeOperation`, `textAlign` and `fontStretch` read as `string` and take
  the standard keywords. Every other property is a plain one, since its two types agree.
  The lint rule against unrelated accessor types is disabled on those five lines alone.
- The DOM context's assignability is a type test in `tests/types.test.ts`: the root
  `tsconfig.json` sets no `lib`, so its default DOM lib covers the tests, while
  `tsconfig.build.json` pins `ES2023` and keeps DOM out of `src`. skia-canvas's
  assignability is checked once it is a dependency.
- The interface is receive-only for consumers: they are handed one and never implement
  it, so adding a member is a minor change. The recording context in this repository
  implements every member.
- There are two types. The engine draws on the full interface. The one handed to a depth
  4 callback is the same without the text members: with `y` up raw text would be
  mirrored, and it would bypass the text checks. A scene's text goes through labels,
  speech bubbles and the text helper.

## Drawing a frame

- `drawFrame(ctx, source, n)` in `src/draw/frame.ts`, internal, draws frame `n` of a
  scene on a `DrawingContext`. It starts with `ctx.reset()`, so nothing an earlier frame
  left on the context, an unbalanced `save` included, reaches this one.
- Every frame is first painted `#ffffff`, opaque, over the whole canvas: the rasteriser
  drops alpha, so an undefined background would differ by platform.
- The ink is `#111111`, a near black that reads as drawn rather than printed. The
  figure's lines are 0.025 units wide (10.8 px on one 1080 px row) with round caps and
  joins, the face's 0.01, the ground line's 0.01. Widths are in units, so a figure keeps
  its weight relative to its size at every row count.
- The head is a circle of the head's diameter, stroked in ink and filled with the
  background, so the face draws in ink on paper; the probe pixel inside the head is
  therefore taken on its outline or a feature. The face sits a tenth of the head's
  radius forward of its centre, every feature inside the outline over the channels' full
  ranges, so it reads as facing: two lens-shaped eyes whose height is `eyeOpen` (flat
  at 0) with a pupil moved by `gazeX` and `gazeY`, brows raised by `browHeight` and
  tilted inner end up by a positive `browTilt`, and a mouth of two quadratic curves: the
  upper bends down at the middle by `mouthCurve` (a smile), the lower drops below it by
  `mouthOpen`, the corners spread by `mouthWidth`.
- The figure draws the far (`L`) arm and leg, then the back and the head, then the near
  (`R`) leg and arm, so the near limbs are in front.
- Within a row the order is the five slots of `ROW_SLOTS`: backdrop, props behind,
  actor, props in front, text. Each item runs between `save` and `restore`. Backdrops,
  props and text have no vocabulary yet, so `props behind` and `text` are empty and the
  backdrop slot holds the ground line, drawn across the row's visible width at `y = 0`;
  a backdrop item will draw before it. A free drawing (`row.draw`) goes in the
  props-in-front slot, in recorded order: with no layering option yet, in front is the
  one place it cannot be hidden. Its callback starts with ink as both styles and the
  figure's line width.
- A free drawing is called for each of its segments that `frameInSegment` says frame `n`
  falls in, with `t` and the `Moment` of that segment; a parsed timeline's placeholder
  draws nothing.

## Shapes

A prop or a backdrop is a drawing function. A shape taken from an SVG editor is carried
as SVG path data (the string of a `d` attribute) and drawn by this package's own
path-data helper, which issues ordinary path calls. A full SVG document is not an input:
it would need an image decoder, which the drawing interface excludes.

There is no `Path2D`: it is a global constructor the drawing interface cannot reach, and
a path object would be a host object the recording context cannot log. Paths are drawn
with the context's own path calls every frame.
