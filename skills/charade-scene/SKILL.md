---
name: charade-scene
description: >
  Makes a short 2D animation in which a stick figure acts out an idea, with the charade
  package: read the installed vocabulary with `charade catalog`, write a scene file in
  TypeScript, run `charade check`, look at the check images from `charade sheet` and
  `charade frame`, fix, then `charade render` an MP4. Use when asked for a short clip,
  animation or video that shows an idea, a mood or a before-and-after contrast with
  stick figures, when writing or fixing a charade scene file, or when a `charade`
  command reports a finding such as ERR_CHECK_JOINT_LIMIT or ERR_SCENE_UNKNOWN_ACTION.
---

# Making a charade scene

**Owns:** going from an idea to a rendered MP4: the loop, the scene file, how to look at
what you made. **Does not own:** writing a reusable action, expression, prop, backdrop
or effect of your own (`charade-vocabulary`); the list of what is installed, which only
`charade catalog` knows.

You cannot watch the video. The check images are your eyes, so the loop below is the
work, and a scene nobody looked at is not finished.

## Before you start

- Node 24 or newer (`node --version`). Run every command as `npx charade <command>`; it
  works in an empty folder, and the scene's `import "charade"` resolves to the CLI
  itself, so nothing else has to be installed.
- `render` needs `ffmpeg` on `PATH`; the other commands do not. Without it `render` says
  how to install it and writes nothing. Ask the person before installing anything.
- `npx charade <command> --help` lists a command's flags. Every command takes `--json`.

## The loop

1. **Read the vocabulary.** Run `npx charade catalog` and read all of it, every time: it
   lists the actions, expressions, props, backdrops and effects of the installed version
   with their parameters, marks and moods, then the rig (joints, limits, effectors, face
   channels, conventions). Never write a name or a parameter from memory.
   `npx charade catalog <name>` shows one item; `npx charade catalog --images` writes a
   sample image of each into `charade-catalog/`. Open the ones you plan to use.
2. **Plan the acting** as beats before writing code (see Acting).
3. **Write the scene** as one file, such as `idea.ts` (see The scene file).
4. **Check:** `npx charade check idea.ts`. Each finding has a `fix:` line; do what it
   says. Exit code 0 is clean (warnings allowed), 1 is error findings, 2 is could not
   run.
5. **Look** (see Looking). Open every image you write.
6. **Fix and repeat 4–5** until the pictures show the idea to someone who has not read
   the code. Expect several passes; the first version is rarely right.
7. **Render:** `npx charade render idea.ts` writes `idea.mp4` beside the scene. It
   checks first and stops on an error finding; a warning does not stop it. Tell the
   person the path and what the clip shows.

## The scene file

`<action>`, `<expression>` and `<prop>` stand for names the catalog printed.

```ts
import { scene } from "charade";

export default scene({ rows: 2 }, (stage) => {
  const top = stage.row(0); // row 0 is the top
  const thing = top.prop("<prop>");
  const hero = top.actor({ name: "hero" });
  thing.place({ x: 0.6, y: 0 });
  hero.wait(0.4);
  const tried = hero.do("<action>", { mood: "<expression>" });
  hero.express("<expression>", { at: tried.end });
  hero.wait(1);

  const other = stage.row(1).actor({ name: "other" });
  other.do("<action>", { at: tried.start }); // rows share one clock
  stage.sync(); // every actor's cursor moves to the latest end
});
```

- The default export is the `scene(...)` result. The callback runs once and only
  records; nothing is drawn while it runs, and it must not be `async`.
- `scene(build)` or `scene(options, build)`; options are `rows` (1–4), `width` and
  `height` (1080×1080), `fps` (30), `seed`, `font` (a font file, relative to the scene)
  and `duration`. Nothing on the command line overrides them.
- One actor per row at most, and actors do not interact. With one row the stage is the
  row (`stage.actor()`); with more, use `stage.row(i)`.
- Time is seconds. Each actor has a cursor: a call without `at` starts when that actor's
  earlier calls have ended; `at` is absolute scene time. Every call returns a span
  (`start`, `end`, `duration`, and `marks` for an action that states them), which is how
  one thing is timed against another.
- Space is per row: the origin is on the ground at the row's centre, `y` is up, a
  standing figure is 1 unit tall. The figure is seen from the side, standing at the
  origin and facing right. A row shows `y` from -0.3 to 2.2 and `x` out to ±(1.25 × rows
  × width ÷ height): ±1.25 for one square row, ±2.5 for two.
- A prop is `row.prop(name, params)`. It stands on the row's origin, under the actor,
  until its handle says otherwise: `place(point, { at, layer })`,
  `hold(effector, { at, offset })` or `move(to, { at, duration, arc })`. Create the
  row's actor before a `hold`. A placed prop draws behind the actor; `layer: "front"`
  puts it in front, as for a desk the figure sits at. An action that uses a prop takes
  the handle as a parameter; if it starts with the prop in a hand, `hold` it there from
  the start.
- Erasable TypeScript only: no `enum`, no parameter properties, no `namespace`. Loops,
  functions and arithmetic are fine. A helper file is imported with its `.ts` extension.
- If the folder has a `package.json` without `"type": "module"`, name the scene
  `idea.mts`; otherwise it fails with `ERR_LOAD_FAILED` ("Cannot use import statement
  outside a module").
- Never read the clock (`Date`, `performance`) or `Math.random`; `check` rejects both.
  Functions at depths 3 and 4 get `moment.random.float(i)` instead: a number in [0, 1)
  for each whole number `i`, the same on every run.
- A row is 2.5 units high but its width depends on the canvas and the row count. A depth
  4 drawing that spans the row reads its edges from `moment.view` (`left`, `right`,
  `bottom`, `top`, in row units).

### Depths

Write at depth 1. Go down one step only for what the catalog lacks, and only for that
part of the scene.

| Depth | Call                                                                       | Use it for                                      |
| ----- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| 1     | `a.do(name, { …params, mood })`, `a.express(name)`                         | everything the catalog has                      |
| 2     | `a.pose({ joint: radians }, { duration })`, `a.reach("handR", { x, y })`   | a pose, or a hand or foot target, no action has |
| 3     | `a.drive((t, moment) => ({ spine: Math.sin(t * 3) * 0.1 }), { duration })` | continuous motion: sway, tremble, bounce        |
| 4     | `row.draw((ctx, t, moment) => { … }, { at, duration })`                    | a shape no prop gives                           |

- Depth 2 follows the catalog's `rig` section: radians from the rest pose, a limit per
  joint, `R` the limb nearer the camera. A pose is held until a later call moves those
  joints. `pelvisX` and `pelvisY` move the whole figure. `blend` is how long the arrival
  takes; `anticipation` winds up away from the pose first and `followThrough` overshoots
  it, so neither belongs on a joint that starts or ends on its limit, such as a straight
  elbow or knee.
- `drive` moves the joints its function returns at `t = 0`; `mode: "add"` lays it over
  the pose beneath. Without `duration` it runs to the scene's end and leaves the actor
  without a cursor, so give it one, or give later calls `at`.
- Depth 4 draws on a Canvas-2D-like context in row units with `y` up, and has no text or
  image members. A shape you will use again is a prop: see `charade-vocabulary`.

### Text

The picture carries the point; add text only when the idea needs a word. Text goes
through three calls and nothing else: `row.label(text, { x, y, size, at, duration })`
for free-standing text, `actor.say(text)` for a speech bubble that occupies the actor
for a reading time, and `drawText(ctx, text, { x, y, size })`, imported from `charade`,
inside a depth 4 drawing. Any language works; `check` warns when no font for it is
installed, when text is too small to read, and when it leaves the row.

## Acting

- One idea per clip, 3 to 8 seconds. Write the beats first: _setup_ (who, where, the
  resting state), _attempt or change_, _reaction_, and a _hold_ on the final pose.
- Moods do most of the acting: the same action under another `mood` is another story.
  The catalog says which moods also change an action's body.
- Leave stillness: `wait` 0.3–0.5 s before the first move so the start reads, 0.2–0.6 s
  between beats, and at least 1 s on the last pose. A scene ends with its last timed
  call, so the final `wait` is what keeps the ending on screen.
- A contrast (before and after, three ways of doing one thing) is rows: the same staging
  in each, one difference. Start the rows together and let the outcomes differ.
- Follow each item's description for staging: where its prop goes, what it composes
  with, where a moved thing ends up by default.
- Change the face when something happens: `a.express(name, { at: span.end })`, or at a
  mark, `{ at: span.marks.<mark> }`.
- The figure is small in a tall row: it is two fifths of the row's height whatever the
  canvas. Give the scene only the width the action needs.

## Looking

Four ways to see; use more than one on every pass.

| Command                                  | Gives                                                                    | Look for                             |
| ---------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| `npx charade sheet idea.ts`              | `idea.sheet.png`: twelve frames across the scene, each with time, frame  | does the story read, cell by cell?   |
| `npx charade frame idea.ts --at 1.5`     | `idea.frame-45.png`: one frame, full size                                | the face, a hand on a prop, one pose |
| `npx charade sheet idea.ts --ghost hero` | `idea.ghost.png`: one actor's motion overlaid, faint to solid in time    | the path and rhythm of a move        |
| `npx charade check idea.ts --at 1.5`     | the state as text: where pelvis, head, hands, feet and props are; joints | the numbers to correct a pose with   |

- `--at` takes seconds (`1.5`, `1.5s`) or a frame (`45f`). `sheet` narrows with
  `--from 1 --to 2` (twelve frames inside that range), `--times 0,0.5,45f` (those
  frames) and `--row 1` (one row alone, larger; use it on any scene with rows).
- `--ghost` takes the actor's name, or the id findings print. It reads best when the
  actor travels; where it stays in place, add `--times` with three or four moments, or
  the ghosts pile up.
- `frame` and `sheet` also print the state description of each frame they drew and the
  findings count. They draw even when `check` fails: look at the broken pose to see what
  to change.
- Twelve frames miss a fast beat. Look at every beat with `--from`/`--to` around it
  before rendering.
- In each image ask: Is the figure whole and inside the frame? Do the feet stay on the
  ground when they should? Is a limb bent the wrong way, or through the body? Is the
  prop in the hand, on the seat, where the action expects it, from the first frame on?
  Does the face match the beat? Does the key moment fall in a frame you can see? Is the
  last pose held? Would someone who has not read the code say what happened?

## Findings

An unknown name lists the nearest valid ones; a bad value is reported and replaced by a
placeholder, so one `check` run reports every mistake. Fix errors first, then decide
each warning: `ERR_CHECK_OFF_FRAME` is fine when an exit is meant, and not when a hand
or a thrown prop was supposed to stay in view. `ERR_CHECK_JOINT_LIMIT` on your own pose
means an angle outside the range the catalog's `rig` lists. Match on the `ERR_…` code,
never on the message. `check --strict` fails on warnings too.
