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
- A row shows 2.5 units of height at every row count, with the ground line 0.3 units
  above its lower edge; the visible width follows from the canvas and the row count. The
  two numbers are tuned on the first three actions and are contract after the first
  release.

## Sequencing

- Each actor has a cursor. A call without `at` starts when everything already recorded
  on that actor has ended, so consecutive calls play in order. `at` is absolute scene
  time. Absolute time on every call would have the author do arithmetic on every line.
- Every recording call returns a span: `start`, `end`, `duration` and named `marks` (the
  release of a throw), all in seconds. Parallel motion and timing across rows are
  written with those numbers; all rows share one clock. `stage.sync()` moves every
  actor's cursor to the latest end.
- A call without `at` after an open-ended track has no cursor to start from and is an
  error with a fix line.
- When two tracks drive one joint, the one recorded later wins for the joints it names,
  blended in and out; `mode: "add"` adds instead. So depth 2 and depth 3 override only
  the joints they name over a depth 1 action. A full-body action that cuts another is a
  warning. Joint limits are checked on the composed angle.
- Each segment blends in from the composed pose beneath it over `blend` seconds (about
  0.2 by default). `anticipation` and `followThrough` are options of `pose` and `reach`,
  in seconds, as closed-form curves.
- A function at depth 3 or 4 receives `t`, seconds since its segment began, and a second
  argument with the scene time, the segment's duration and progress, and the keyed
  random source.

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
  seated figure plant its feet. Wrists can be added later as a minor change.
- Names take a side suffix, as in `handR`. The four effectors in brackets are targets
  for `reach` and are not angles; using one as an angle is an error that names the
  angles of its chain.
- `R` is the limb nearer the camera in both facings, because mirroring flips the
  picture. The catalog says so.
- The root carries position in the actor's own frame (`pelvisX`, `pelvisY`). Where the
  actor stands on the ground and which way it faces are separate.
- The face is eight symmetric numbers: `eyeOpen`, `gazeX`, `gazeY`, `browHeight`,
  `browTilt`, `mouthCurve`, `mouthOpen`, `mouthWidth`.
- `pose` and `drive` take one flat map of channels: angles, root and face.
- Joint limits and segment lengths are tuned on the first three actions. After the first
  release a change to either changes every recorded sample.
- Inverse kinematics with a fixed bend direction cannot bend a knee backwards; a
  directly authored angle can, which is the case the limit check exists for.

## Space and angles

- Coordinates are local to a row. The origin is on the ground line at the row's centre,
  `y` points up, and a standing figure is 1 unit tall. Pixels would tie every item to
  the row count, because a row's height changes between 1 and 4 rows.
- Angles are radians, relative to the parent joint, 0 at the rest pose, and positive in
  the direction the joint flexes. With that sign a joint limit is one comparison, which
  is what turns a knee bent backwards into a `check` finding.
- Vocabulary is written facing right. The engine mirrors it for a figure facing left; an
  item never branches on facing.

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
- The timeline types are internal: none is a root export until the scene layer decides
  what a scene exposes.

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
- Properties are declared with a wide getter and a narrow setter. A plain writable
  property rejects one of the two real contexts (same spike).
- The interface is receive-only for consumers: they are handed one and never implement
  it, so adding a member is a minor change. The recording context in this repository
  implements every member.
- There are two types. The engine draws on the full interface. The one handed to a depth
  4 callback is the same without the text members: with `y` up raw text would be
  mirrored, and it would bypass the text checks. A scene's text goes through labels,
  speech bubbles and the text helper.

## Shapes

A prop or a backdrop is a drawing function. A shape taken from an SVG editor is carried
as SVG path data (the string of a `d` attribute) and drawn by this package's own
path-data helper, which issues ordinary path calls. A full SVG document is not an input:
it would need an image decoder, which the drawing interface excludes.

There is no `Path2D`: it is a global constructor the drawing interface cannot reach, and
a path object would be a host object the recording context cannot log. Paths are drawn
with the context's own path calls every frame.
