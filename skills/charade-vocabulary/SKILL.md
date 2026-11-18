---
name: charade-vocabulary
description: >
  Adds an item to charade's vocabulary: an action, expression, prop, backdrop or effect
  written with defineAction, defineExpression, defineProp, defineBackdrop or
  defineEffect, in your own project or as a built-in in the charade repository. Use when
  `charade catalog` has no item for what a scene needs and the thing will be used more
  than once, when writing or fixing a definition's params, build, draw or sample, when
  running `charade check --defs` or `charade catalog --defs`, or on
  ERR_DEFINE_INVALID_DEFINITION, ERR_DEFINE_RESERVED_PARAMETER, ERR_DEFINE_NO_SAMPLE or
  ERR_LOAD_NO_DEFINITIONS.
---

# Adding charade vocabulary

**Owns:** how an item is written — its shape, parameters and sample — and the loop that
proves it. **Does not own:** making a scene with it (`charade-scene`); the names and
parameters of what is installed (`charade catalog`); a shape or pose used once, which is
a depth 2–4 call in that one scene.

The flow is one line: **add a file → rebuild the index → check → catalog → look at the
sample images and fix → commit.** Rebuilding the index is for a built-in only; your own
project registers nothing.

Before writing, run `npx charade catalog` and read it. It may already have the item, or
one whose parameters cover the case. The `rig` section at its end is what an action or
expression is written against: joints with limits, effectors, face channels,
conventions. `npx charade catalog <name> --images` shows how a similar built-in looks.

## The file

Every export that a `define…` function returned is an item; one file may hold several.
Every kind takes `name`, `description`, optional `params` and optional `sample`, plus
the method in the table below.

```ts
import { type ActionDefinition, defineAction, type Stage } from "charade";

const waveParams = {
  waves: {
    type: "number",
    default: 2,
    min: 1,
    max: 5,
    doc: "How many times the hand goes back and forth.",
  },
} as const;

export const waveAction: ActionDefinition<typeof waveParams, "up"> = defineAction({
  name: "wave",
  description:
    "Waves the near hand beside the head: the arm swings up in front, the forearm goes back and forth, then the arm drops. Starts and ends standing.",
  params: waveParams,
  marks: ["up"],
  build(clip, { waves }) {
    const count = Math.round(waves);
    const [raise, beat, drop] = [0.3, 0.2, 0.35];
    const natural = raise + beat * 2 * count + drop;
    const k = (clip.duration ?? natural) / natural; // an asked duration is honoured

    clip.pose(
      { shoulderR: 2, elbowR: 0.8, spine: -0.06, neck: -0.1 },
      { duration: raise * k },
    );
    clip.mark("up", raise * k);
    for (let i = 0; i < count; i += 1) {
      clip.pose({ elbowR: 0.3 }, { duration: beat * k, blend: beat * k });
      clip.pose({ elbowR: 1.2 }, { duration: beat * k, blend: beat * k });
    }
    const down = clip.pose(
      { shoulderR: 0, elbowR: 0 },
      { duration: drop * k, blend: drop * k },
    );
    // Overshoot on the back only: a straight elbow is on its limit.
    clip.pose(
      { spine: 0, neck: 0 },
      { at: down.start, blend: drop * 0.6 * k, followThrough: drop * 0.4 * k },
    );
  },
  sample(stage: Stage): void {
    const actor = stage.actor();
    actor.wait(0.2);
    actor.do(waveAction);
    actor.wait(0.4);
  },
});
```

| Kind       | Function           | Its method                                                       | Used as                                |
| ---------- | ------------------ | ---------------------------------------------------------------- | -------------------------------------- |
| action     | `defineAction`     | `build(clip, params)` records, returns nothing; `marks`, `moods` | `actor.do(item, { … })`                |
| expression | `defineExpression` | `build(params)` returns face channels                            | `actor.express(item)`, or `mood: item` |
| prop       | `defineProp`       | `draw(ctx, params, moment)`                                      | `row.prop(item, { … })`                |
| backdrop   | `defineBackdrop`   | `draw(ctx, params, moment)`                                      | `row.backdrop(item, { … })`            |
| effect     | `defineEffect`     | `draw(ctx, params, moment)`                                      | `row.effect(item, { … })`              |

- `name` is what the catalog and findings print, unique within its kind across the files
  loaded together. `description` is all the next agent has to decide whether and how to
  use the item: what it looks like, what it needs around it (a seat, a prop, a pose to
  start from), where it ends, and what each mood changes.
- Annotate the export with its definition type, as above; an action's second type
  argument is its marks, `never` when it has none.
- An item is used by passing the definition itself, with no registration:
  `import { waveAction } from "./wave.ts"`, then `hero.do(waveAction, { waves: 3 })`. It
  may share a built-in's name.
- A scene file's limits apply: erasable TypeScript only (no `enum`, parameter properties
  or `namespace`), no clock, no `Math.random`.

### Parameters

Plain data, declared once and marked `as const`; the argument types are derived from it.
A key without `default` is required. Every key has a `doc` line.

| `type`    | Also takes                       | A value is                     |
| --------- | -------------------------------- | ------------------------------ |
| `number`  | `min`, `max` (inclusive), `unit` | a finite number                |
| `enum`    | `values`, a non-empty list       | one of them                    |
| `boolean` |                                  | `true` or `false`              |
| `color`   |                                  | a CSS colour string            |
| `point`   |                                  | `{ x, y }` in row units        |
| `text`    |                                  | a string                       |
| `prop`    | no `default`; actions only       | the handle `row.prop` returned |

A parameter may not be named `at`, `duration`, `mood`, `blend` or `mode`: a scene passes
those in the same bag. A default must be a value the parameter allows. `define…` checks
both when it runs; the types do not.

### An action's build

- `clip` has the actor's `pose`, `reach`, `drive` and `wait`, with time 0 at the
  action's start, and `clip.mark(name, t)` for each mark listed in `marks`.
- The figure is seen from the side. Write it facing right, from the rest pose, in the
  angles of the catalog's `rig` section, and move limbs forward, back and up: two arms
  doing the same thing draw as one.
- `clip.duration` is the asked duration, or `null`: give every call a `duration` scaled
  by it over the natural length, as a call without one lasts only its blend. `clip.mood`
  is the mood's name, or `null`; the face is set for you, so branch on it only to change
  body or timing, and list those moods in `moods`.
- Feet that stay planted are `clip.reach("footL", point)` and `footR` recorded after the
  body poses, since a reach is solved over what was recorded before it; set the ankle
  angle beside them where the shin tips, so the foot lies flat.
- An action that moves a prop takes it as a `prop` parameter and calls the handle's
  `hold(effector, { at, offset })`, `place(point, { at, layer })` and
  `move(to, { at, duration, arc })`, with `at` in the action's time.
- Leave alone the joints of an action yours should compose with, and end in a pose the
  next action can start from.
- Acting is timing: wind up before a big move (`anticipation`), overshoot after it
  (`followThrough`), let the head trail the body by a beat, hold the end. Both options
  go past the pose, so keep them off a joint resting on its limit.

### An expression's build

Returns any of the eight face channels the `rig` section lists with their ranges and
rest values. Set all eight if it should clear whatever came before. An `intensity`
parameter from 0 to 1 that scales each channel's distance from rest lets a scene soften
it.

### A draw

- Row units, `y` up, origin at the item's ground point: a prop stands on `y = 0`,
  centred on `x = 0`. A standing figure is 1 tall, its head 0.18 across and its lines
  about 0.02 wide; match that scale and weight.
- `ctx` is Canvas-2D-like (paths, fills, strokes, gradients, transforms) without text or
  images. Text is `drawText(ctx, text, { x, y, size })`; a shape from an SVG editor is
  its path's `d` string through `svgPath(ctx, d, { scale, origin })`, `origin` being the
  SVG point that lands on the ground point. Both are imported from `charade`.
- The third argument is the moment: `moment.time` is scene time in seconds,
  `moment.progress` runs 0 to 1 over a shown `duration`, and `moment.random.float(i)` is
  a repeatable number in [0, 1) for each whole number `i`. That is how an effect moves.
- `moment.view` is the row's visible area in the units the draw uses: `left`, `right`,
  `bottom`, `top`. A row is 2.5 units high with 0.3 below the ground line, but its width
  runs from 2.5 units (one square row) to about 17.8 (four rows of a 16:9 canvas). A
  backdrop fills from `view.left` to `view.right` and repeats or extends what it shows
  outwards from the origin, where the actor stands, so a wider row shows more of the
  same picture. Keep it paler than the ink figure, and its detail above head height.

### The sample

`sample(stage)` is a small scene body showing the item alone; `check --defs` checks it
and `catalog --images` draws it. It passes definitions, never names. For an action it is
a short `wait`, the action with whatever prop it needs, and a `wait`.

- A prop or a backdrop: put it in without a `duration`, a prop twice if two settings
  look different, and add `stage.actor().wait(1)` for scale and for the sample's length.
  The image is the sample's last frame, which an item whose `duration` has ended is not
  in.
- An expression: `actor.express(item, { duration: 1 })`. An effect: a `duration`, beside
  an actor that waits as long.

## The loop

In your own project, with the items in `wave.ts`:

1. `npx charade check --defs wave.ts` builds every item's sample and checks it like a
   scene. Do what each `fix:` line says. An item without a sample is the warning
   `ERR_DEFINE_NO_SAMPLE`: nothing of it was checked.
2. `npx charade catalog --defs wave.ts` prints the items as the next agent will read
   them. Rewrite a description or a `doc` that would not let you use the item unseen.
3. `npx charade catalog --defs wave.ts --images` writes
   `charade-catalog/<kind>.<name>.png` for each: a contact sheet of twelve frames for an
   action or an effect, one frame for the others. Open every one.
4. Look: is the figure whole, balanced and inside the frame? Are the feet on the ground?
   Would you name the motion without being told? Is the prop the right size beside a
   figure? Is the figure still the clearest thing in front of a backdrop, in a scene of
   one row and of four? Fix and repeat from 1; a first attempt that passes `check`
   usually still reads wrong.
5. Use it in a scene and look again there (`charade-scene`): an item that reads alone
   can still collide with a seat or leave the frame. Then commit the file.

### A built-in, in the charade repository

The same file, with these differences; `.claude/rules/vocabulary.md` has the rest.

1. One item per file at `src/vocabulary/<kind>s/<name>.ts`, exported as `<name><Kind>`
   (`waveAction`), importing from `../../index.js` in place of `"charade"`.
2. `pnpm vocabulary:index` rebuilds the generated index; a test fails when it is stale.
3. `pnpm build`, then `node dist/cli.js check --defs dist/vocabulary/<kind>s/<name>.js`
   and `node dist/cli.js catalog <name> --images`; look and fix as above.
4. `pnpm exec vitest run tests/vocabulary-samples.test.ts tests/vocabulary-index.test.ts`,
   then `pnpm check`, then commit.
