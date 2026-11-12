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
- Frame `n` is drawn at `n / fps`, counted from 0. Segments are half-open. Time is
  computed from `n` each frame and never accumulated.
- Frame `n` is a pure function of the timeline and `n`. A single frame asked for by time
  or number equals that frame of a full render, so nothing in a frame may depend on an
  earlier frame having been drawn. That binds motion that carries state (a spring, a
  follow) too; how it meets the rule is not settled.

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

## Serialised timeline

The JSON form carries `version: 1` and a canonical key order. Where a function at depth
3 or 4 was omitted it leaves a placeholder, and the document is marked as lossy. A
change to the shape raises the version.

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
