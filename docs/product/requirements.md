# charade — Requirements

- **Status:** Signed off 2026-11-12
- **Platform and stack:** Node.js library and CLI, ESM-only TypeScript, cut from
  `tomada1114/typescript-template` (`node-library` profile with the CLI entry). The
  template fixes: one package, one root entry of named exports, `files: ["dist"]`,
  `sideEffects: false`, pnpm with a strict supply-chain policy, development on Node 24.

## 1. Overview

- **What it is:** an engine that lets an AI coding agent write a short 2D animation as
  code. A stick figure with a face acts out an idea — an action, a mood, a contrast
  between panels — so that the point is carried by the picture rather than by text.
  One-line description: _Short 2D animations where stick figures act out an idea —
  written as code by AI agents._
- **Target users:** people who ask an agent (Claude Code, Codex and the like) for "a
  short clip that shows this idea", and the agent that does the work through an Agent
  Skill. The person does not write the scene; the agent does.
- **Core interaction:** the agent reads the vocabulary, writes a scene in TypeScript,
  checks it, looks at check images, fixes it, and renders an MP4. An agent cannot see
  its own output, so the check-and-look loop is the product, not a debugging aid.
- **What it competes on:** the quality of the acting, the range of what can be expressed
  (motion, worlds, effects), and ease of use. Engine internals and render speed are not
  the headline. Overlap with earlier stick-figure tools is accepted.
- **What makes it its own work:** the scene language, the rig, the animation and the
  drawing are this project's code. Libraries are called as parts (skia-canvas for
  rasterising, the user's ffmpeg for encoding) and could be swapped without changing
  what a user writes. It is not built on, or forked from, another animation framework.

## 2. Scope

### MVP (first public release)

- Scene authoring in TypeScript, at four depths (§3.1)
- A timeline: the scene runs once and yields data the engine draws per frame (§3.2)
- One character: a stick figure with a face, on this project's own rig (§3.3)
- Vocabulary: 12 actions, 6 expressions, 10 props, 5 backdrops, 4 effects, as one file
  each (§3.4)
- Layout in 1–4 rows, at most one actor per row (§3.5)
- Text: labels and speech bubbles (§3.6)
- CLI: `render`, `check`, `frame`, `sheet`, `catalog` (§3.7)
- Check images an agent can read motion from (§3.8)
- Two Agent Skills: one to make a scene, one to add vocabulary (§3.9)
- A flow for adding vocabulary that verifies itself (§3.10)
- README that opens with a video and the scene code that produced it (§3.11)

### Later

- Sound effects (self-made WAV assets, placement and mix only) — after the first
  release; pulled forward when a README video needs sound to land.
- Interaction between actors (touching, handing over, reacting to each other) and more
  than one actor in a row — after the first release.
- More effects beyond the first four.
- A bundled font, if system fonts prove too uneven across machines.
- Running the drawing code in a browser `<canvas>` as an install-free demo page. The
  first release only keeps the layers apart so this can be added without changing the
  published contract (§4).
- Appearance variants of the character (line weight, head shape, colour).
- An MCP server. GIF and image-sequence output.

### Non-goals

- Importing Rive, Lottie, Spine or other external character formats — the acting
  vocabulary is written against this rig's joints, and would not carry over.
- Building on or forking Remotion, HyperFrames, Motion Canvas or Revideo.
- A headless browser anywhere in the render path.
- Bundling ffmpeg, or depending on a package that bundles it.
- Narration, text-to-speech, charts and diagrams.
- A preview editor or any GUI.
- Narrowing what a scene can express in order to make the engine simpler to build.

## 3. Features

### 3.1 Scene authoring

- **Purpose:** the agent writes one TypeScript file per scene, with loops, functions and
  arithmetic available as in any program.
- **Access:** `import { scene } from "charade"`; the file's default export is the scene.

| Depth              | What is written                                                    | Example                                            |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------- |
| 1. Action          | a named piece of acting, with a mood                               | `a.do("sitDown", { mood: "dejected" })`            |
| 2. Pose and target | joint angles, where a hand or foot should reach, timing and easing | `a.reach("handR", ball, { at: 1.2 })`              |
| 3. Motion function | motion as a function of time (sway, spring, arc, follow)           | `a.drive(t => ({ spine: Math.sin(t * 3) * 0.1 }))` |
| 4. Free drawing    | any vector drawing, on a Canvas 2D context, for that frame         | `stage.draw((ctx, t) => { ... })`                  |

- Write at depth 1; go down only when the vocabulary does not have what is needed.
- All four depths ship in the first release.
- Depths 3 and 4 put functions on the timeline. They receive time and a seeded random
  source; reading the clock or `Math.random` is rejected by `check`.
- The context at depth 4 is this package's own interface: every standard Canvas 2D
  member that works on numbers and strings. Bitmap images, pixel readback and raw text
  drawing are not on it; text goes through labels, speech bubbles and a text helper.
- **Edge cases:** an unknown action, expression, prop or backdrop name is an error that
  lists the nearest valid names. A scene with no actor is valid (text and props only).

### 3.2 Timeline and determinism

- Scene code never draws. Each call records "from when to when, which joint does what".
  The code runs exactly once; the engine then draws frame _n_ as a pure function of the
  timeline and _n_.
- The same scene on the same machine and versions produces byte-identical frames.
  Identity across operating systems is not promised in the first release (Open
  questions).
- A timeline built only from depths 1 and 2 serialises to JSON. With depths 3 and 4 the
  serialised form omits the functions.
- Checks, snapshot tests and catalog images all work on the timeline, not on the code.

### 3.3 Character and rig

- One character: a stick figure with a round head and a face.
- The rig is this project's own type: a joint hierarchy, analytic two-bone IK for arms
  and legs, pose interpolation, and anticipation and follow-through as timing options.
- The face is numbers, not sprites: eyes, brows and a mouth whose curve is a parameter.
- Joint limits are part of the rig, so that a knee bending backwards is a `check`
  failure rather than something a reviewer has to spot.

### 3.4 Vocabulary (first release)

| Kind        | Count | Names                                                                                                                           |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| Actions     | 12    | `stand` (breathing, blinking), `walk`, `run`, `sitDown`, `slump`, `throw`, `pickUp`, `push`, `carry`, `cheer`, `point`, `think` |
| Expressions | 6     | `neutral`, `happy`, `dejected`, `angry`, `surprised`, `focused`                                                                 |
| Props       | 10    | `ball`, `hoop`, `box`, `rock`, `lever`, `cart`, `ladder`, `desk`, `laptop`, `lightbulb`                                         |
| Backdrops   | 5     | `plain`, `court`, `office`, `hill`, `night`                                                                                     |
| Effects     | 4     | `sweat`, `impact`, `speedLines`, `sparkle`                                                                                      |

- Each item is one TypeScript module that carries its name, a description, typed
  parameters and a sample scene. A prop or backdrop is a drawing function; a shape made
  in an SVG editor is carried as SVG path data (a `d` string) and drawn by a helper.
- Vocabulary is defined with the same public API a user has (`defineAction` and its
  siblings). The engine has no private back door, so a user can define their own items
  in their own project in the same way.
- A built-in is used by name (`a.do("sitDown")`); any item, a user's own included, is
  used by passing its definition (`a.do(myAction)`). Nothing is registered.
- The index of built-in vocabulary is a generated file. It is rebuilt by a script, and a
  test fails when it is stale. Nothing registers itself on import.
- Names are a contract once released: adding one is a minor change, renaming or removing
  one is breaking.

### 3.5 Layout and actors

- A scene has 1–4 rows (panels), stacked vertically. Each row has its own backdrop,
  props and ground line.
- At most one actor per row. A video may therefore show up to four actors, who do not
  interact.
- Default canvas and frame rate: see Default values. Draw order within a row is
  backdrop, props behind, actor, props in front, text.

### 3.6 Text

- Labels (free-standing text) and speech bubbles (attached to an actor).
- Japanese and other non-Latin text must render. The default font is the first available
  from a per-OS list (macOS: Hiragino Sans; Windows: Yu Gothic; Linux: Noto Sans CJK). A
  scene may name a font file instead, which is then used on every machine. No font is
  bundled.
- Frames that contain text are not identical across machines with different fonts, so
  sample records measure text with a fixed stand-in rather than a real font.
- `check` reports text that is too small to read at the output size or that leaves the
  frame.

### 3.7 CLI

| Command                                         | Does                                                                  | Needs ffmpeg |
| ----------------------------------------------- | --------------------------------------------------------------------- | ------------ |
| `charade render <scene.ts>`                     | writes an MP4 (H.264, yuv420p)                                        | yes          |
| `charade check <scene.ts>`                      | reports problems, each with how to fix it                             | no           |
| `charade frame <scene.ts> --at <time or frame>` | writes one PNG                                                        | no           |
| `charade sheet <scene.ts>`                      | writes a contact sheet PNG of frames across the scene                 | no           |
| `charade catalog`                               | lists the installed vocabulary for an agent, and writes sample images | no           |

- `npx charade render scene.ts` works in an empty folder: Node's built-in type stripping
  loads the scene, and the CLI resolves `import "charade"` to itself. No transpiler is a
  dependency. Consequence: scene files cannot use TypeScript syntax that needs
  transformation (`enum`, parameter properties, namespaces).
- Published Node floor: `>=24`.
- ffmpeg is not bundled. `render` calls the `ffmpeg` on `PATH`; when there is none it
  prints how to install it for the current OS and exits non-zero without writing partial
  output.
- Exit code 0 on success, 1 when `check` finds errors, 2 when the command could not run.
  Findings and failures carry a stable `ERR_…` code; messages may be reworded.
- `--at` takes seconds (`1.5`, `1.5s`) or a frame (`45f`). Output is written next to the
  scene unless `-o` names a path. `catalog` writes sample images when given `--images`.
- `render` checks first and stops on an error finding; a warning, such as a figure
  leaving the frame, does not stop it.
- `check` covers: unknown names, joint limits, anything leaving the frame, overlap of
  actor and text, unreadable text, and clock or unseeded-random use.

### 3.8 Check images

Four ways for an agent to see what it made, since it cannot watch a video:

- a contact sheet of frames (`sheet`),
- a single frame (`frame`),
- one actor's motion overlaid as ghosts on a single image, so motion reads from a still
  (`sheet --ghost`),
- a text description of state at given times: who is where, in which pose, facing which
  way (printed by `frame` and `sheet`, and by `check --at`).

### 3.9 Agent Skills

- Two skills, kept in the repository's `skills/` directory: **making a scene** and
  **adding vocabulary**. They are installed from the repository (for example
  `npx skills add tomada1114/charade`), not from the npm tarball.
- The scene skill drives: read the vocabulary → write the scene → `check` → look at the
  check images → fix → `render`.
- A skill never lists the vocabulary itself. It tells the agent to run
  `charade catalog`, so what the agent reads always matches the installed version.

### 3.10 Adding vocabulary

- The flow is one line: add a file → rebuild the index → `check` → `catalog` → look at
  the sample images and fix → commit.
- Type checking stops a malformed item first. Each sample's drawing calls are recorded,
  so an unintended change in appearance fails a test on any operating system. Pixels are
  checked only within one run: a frame rendered twice is identical.
- The flow must run with an agent alone, so that actions, expressions and backdrops can
  be added day by day. This is verified before the vocabulary grows (§5 of the plan
  below, "first thing to prove").

### 3.11 README

- Opens with a video and the scene code that made it, then the vocabulary sample images.
- First video: **moving a rock, in three rows** — one person pushes it bare-handed and
  gets nowhere, one shifts it a little with a lever, one loads it on a cart and walks
  off. No text needed.

### Default values

| Setting     | Default                                  |
| ----------- | ---------------------------------------- |
| Canvas      | 1080×1080                                |
| Frame rate  | 30 fps                                   |
| Video codec | H.264, yuv420p, MP4                      |
| Rows        | 1                                        |
| Random seed | fixed constant unless the scene sets one |

## 4. Cross-cutting rules

- **Layering:** scene, timeline, rig and drawing are written only against the Canvas 2D
  interface type. skia-canvas, ffmpeg and file access live in the export layer behind
  the CLI. The boundary is enforced mechanically, so that a browser demo can later
  bundle the source without a change to the published contract.
- **Packaging:** one package; consumers import only root named exports; `files` is
  `dist`; `sideEffects: false`. Assets ship as TypeScript modules, so nothing is read
  from disk at run time and no copy step is added to the build.
- **Dependencies:** skia-canvas is the only run-time dependency. It installs under the
  template's supply-chain policy unchanged (no install script; a prebuilt binary arrives
  as an optional dependency), so no install-script exception is needed.
- **Licences:** code MIT; assets (character, props, backdrops, later sounds) CC0 and
  self-made.
- **Errors:** every problem an agent can cause says what is wrong, where, and how to fix
  it. `code` is the contract.
- **Language:** everything committed is in English. Scenes may contain text in any
  language.

## 5. First thing to prove

Before growing the vocabulary: build three actions (`sitDown`, `throw`, `slump`) and
confirm that the loop "render check images → look → fix" converges with an agent alone.
In the feasibility spike the sitting pose came out broken on the first attempt (the knee
bent the wrong way); the acting only became right after looking and correcting. If this
loop does not work, the vocabulary plan does not either.

## 6. Open questions

- **Calling ffmpeg as an external command and the GPL** — a legal reading, deferred; not
  bundling keeps GPL code out of the distribution.
- **Cross-OS frame identity and anti-aliasing quality** — measure after release.

## 7. Decision log

- 2026-11-12 Name `charade` (rejected: `shigusa`, `miburi` — meaning is lost on English
  speakers; `stickact` — narrows the project to stick figures).
- 2026-11-12 Scenes are TypeScript that builds a timeline (rejected: a JSON script as
  the default — it narrows what can be expressed, and an agent already runs code on the
  user's machine).
- 2026-11-12 All four authoring depths in the first release (rejected: holding back free
  drawing — users could not draw what the vocabulary lacks).
- 2026-11-12 Several actors per video, one per row, no interaction (rejected: one actor
  per video — a three-row contrast of different people could not be made; several per
  row — invites interaction that is out of scope).
- 2026-11-12 ffmpeg is the user's, called from `PATH` (rejected: an optional bundled
  binary — recommends a GPL binary and adds branches; own GIF/APNG encoders — extra work
  or dependency).
- 2026-11-12 Assets and vocabulary are TypeScript modules with a generated index
  (rejected: `.svg` files copied into `dist` — a gate change and run-time file reads;
  `.svg` sources converted to modules — two copies to keep in step).
- 2026-11-12 Skills are distributed from the repository's `skills/` (rejected: written
  out by the CLI — skill text as strings in code, and every skill fix needs a release).
- 2026-11-12 Browser demo deferred, layers kept apart (rejected: dropping it — closes
  the install-free entry; shipping it first — time away from acting and vocabulary).
- 2026-11-12 Own rig only (rejected: appearance variants in the first release — more
  samples and checks; external formats — vocabulary would not carry over).
- 2026-11-12 Node `>=24`, native type stripping, no transpiler (rejected: bundling a
  transpiler for Node 22 — a second native dependency; requiring a local install — more
  steps before the first video).
- 2026-11-12 Effects are a vocabulary kind from the first release, four items (rejected:
  after release — emotion would rest on face and posture alone, and adding a kind later
  moves the public API).
- 2026-11-12 System fonts by default, a font file may be named (rejected: bundling a
  font — several MB and a packaging-gate change; dropping text — reverses a decision).
- 2026-11-12 First README video: moving a rock in three rows (rejected: ladder — needs
  an extra action; carrying boxes — needs collapse physics).
- 2026-11-12 Depth 4 draws on the package's own interface without bitmap images
  (rejected: the DOM type — not in the build, and skia-canvas does not satisfy it; image
  members — a host object that cannot be recorded).
- 2026-11-12 Props and backdrops are drawing functions with a path-data helper
  (rejected: whole SVG documents — they need the image decoding just ruled out).
- 2026-11-12 Samples record drawing calls, not pixel hashes (rejected: pixel hashes per
  operating system — a record made on macOS cannot be checked on Linux CI).
- 2026-11-12 Built-ins by name, any item by its definition (rejected: a per-scene
  registry now — it needs a collision policy that makes adding a built-in name a break).
