---
paths:
  - "src/check/**"
---

# Checks and sample records

An agent cannot watch a video, so `check` and the check images are the product, and a
recorded sample is how an unintended change in appearance fails a test.

## What a sample record is

- A record is a log of the drawing calls a sample makes, taken by a recording context in
  the `unit` project. It needs no rasteriser, so it is the same on every operating
  system; the same log on macOS and on CI is what lets an agent add vocabulary alone.
- Pixels are not recorded across runs. Rasterised output differs by operating system and
  by skia version, a record made on one cannot be produced on another, and a platform
  without a record would pass vacuously.
- The pixel layer lives in the automation project and asserts two things only: a frame
  rendered twice in one run is byte-identical, and a few probe pixels have the expected
  colour (ink on the head's outline, background in a corner).
- What the log cannot see: a change in the rasteriser, a call skia interprets
  differently, text shaping, and a bug in the recorder itself. A refactor that draws the
  same picture with different calls changes the log; look at the check images before
  re-recording.

## Keeping the log stable

- Every numeric argument is logged as an integer, `Math.round(v * 1e4)`, with negative
  zero normalised to zero. Number formatting is deterministic; the last digit of a
  computed value is not.
- `NaN` or an infinity in an argument throws instead of being logged, as does a number
  whose scaled form overflows. The class is `NonFiniteDrawingError`
  (`ERR_SCENE_NON_FINITE_DRAWING`, since it arises from a scene's drawing), internal to
  `src/check/recorder.ts`, carrying the member as `call` and the zero-based `argument`
  position, never the value. A property write counts: the write throws and the state
  keeps its old value. An `undefined` in a required argument, before a given one, or
  written to a property throws the same class, since a real context reads it as `NaN`.
- An argument a real context rejects throws instead of being logged, so a record cannot
  pass where the rendered frame throws: a negative radius to `arc`, `arcTo` or `ellipse`
  and a colour stop offset outside 0..1 (`IndexSizeError` in the DOM), and a negative
  corner radius or more than four of them to `roundRect` (`RangeError`). The class is
  `DrawingArgumentRangeError` (`ERR_SCENE_DRAWING_OUT_OF_RANGE`), beside
  `NonFiniteDrawingError` and carrying the same `call` and `argument`, never the value;
  a list of radii is its one argument position. The test is on the value given, not the
  logged one, `-0` is not negative, and a negative infinity throws
  `NonFiniteDrawingError`. An empty radius list is not rejected, since skia-canvas 4
  accepts it (and five radii too, which the recorder still rejects as the DOM does).
- `setLineDash` keeps the dash list as a real context does: a list with a negative entry
  leaves the previous one in place, and an odd-length list is stored twice over, so
  `[1, 2, 3]` reads back from `getLineDash` as `[1, 2, 3, 1, 2, 3]`. The call is logged
  as given either way. A non-finite entry, which a real context ignores too, throws
  `NonFiniteDrawingError` as any non-finite argument does.
- A property write is logged as a call. A gradient is logged by its creation index.
- An entry is `{ call, args }`. A property write's `call` is the property's name and
  `args` holds the one value; a method's `args` holds the arguments given, so an omitted
  optional argument, or a trailing `undefined` in an optional position, is absent.
  Strings and booleans are kept as they are, arrays element by element, and a gradient
  is `{ gradient: index }`, which no number collides with. A colour stop is logged as
  `addColorStop` with the gradient first. Reads are not logged; query methods
  (`getLineDash`, `measureText`) are.
- A gradient another context created has no index to log by and throws
  `ForeignGradientError` (`ERR_SCENE_FOREIGN_GRADIENT`, carrying `call`).
- The recording context is `RecordingContext` in `src/check/recorder.ts`, internal: the
  engine and the sample tests use it, and a consumer is never handed one. Its getters
  return the last value written, starting from the standard defaults, and `save`,
  `restore` and `reset` keep that state as a real context does.
- The recording context measures text with a deterministic fake, so a bubble's layout in
  the log is not the layout of the real output. Text is tested through this fake only;
  no font file is committed to the repository. The automation project draws one frame
  with text through skia-canvas and asserts only that it is the same twice and differs
  from the frame without text.
- The fake reads the first `<n>px` in `font` as the size `s` (10 when there is none).
  `width` is 0.6 × `s` per code point, both ascents 0.8 × `s` and both descents 0.2 ×
  `s`. `actualBoundingBoxLeft` is 0 for `start` and `left`, `width / 2` for `center`,
  and `width` for `right` and `end`; `actualBoundingBoxRight` is the rest of the width.
  `letterSpacing` and the rest of the font are ignored.
- Records are vitest snapshots: no script of their own, no file access in the test, and
  a readable diff in the pull request. Updating a snapshot is blind to what changed, so
  the look step belongs to the flow that adds or changes an item, not to the test.

## Findings

- A finding is plain data: `code`, `severity` (`error` or `warning`), `message` (what is
  wrong), `fix` (how to fix it), and where it applies — row, target id, joint, a time
  range in seconds and the matching frame range, and the source location when the call
  site could be captured. The location is optional; it is read from a stack trace.
- A finding may carry measured values and the nearest valid names. The rule that an
  error never carries the rejected value applies to thrown error classes, not to
  findings, whose purpose is to show the author what was measured.
- `code` and `severity` are contract; the wording is not. Raising a warning to an error
  changes exit codes and is a breaking change.
- Codes share one namespace, `ERR_<AREA>_<FAILURE>`, for errors and warnings alike:
  `ERR_CLI_` (usage), `ERR_LOAD_` (loading a scene), `ERR_SCENE_` (authoring calls),
  `ERR_DEFINE_` (definitions), `ERR_CHECK_` (computed over the timeline), `ERR_RENDER_`,
  and `ERR_ENV_` (ffmpeg, fonts, the native binary).
- A name given to `catalog` that is no item's is `ERR_CLI_UNKNOWN_ITEM`, in the usage
  area with exit 2, not an `ERR_SCENE_UNKNOWN_<KIND>` finding: the name is an argument
  of the command, no scene ran, and the command cannot do what was asked. It carries
  `nearest`, each as `<kind>.<name>`, which `--json` prints as `error.nearest`.
- A definition's sample that throws is `ERR_DEFINE_SAMPLE_FAILED`, thrown, exit 2; a
  definition without a sample under `check --defs` is the warning finding
  `ERR_DEFINE_NO_SAMPLE`. Both are faults of a definition, so they are in its area.
- skia-canvas or its native binary failing to load throws `SkiaUnavailableError`
  (`ERR_ENV_SKIA_UNAVAILABLE`, internal to `src/export/raster.ts`), carrying a `fix`
  line and the loader's error as `cause`; the code is not chosen by skia's message text.
  A canvas size that is not a positive whole number throws `InvalidCanvasSizeError`
  (`ERR_RENDER_INVALID_SIZE`, same module) before skia is loaded, since skia would
  resize it quietly and the raw output would lose its `width × height × 4` length.
- An unknown name or a bad parameter while a scene runs is recorded as a finding and
  authoring continues with a placeholder, so one run reports every mistake instead of
  the first. Recording stops at twenty findings (`FINDING_CAP`), keeping the first ones,
  except that a warning gives way to an error: at the cap a later warning is dropped and
  a later error evicts the last warning kept, never an error, so the kept findings are
  the first errors and, in the room left, the first warnings, in the order added. The
  cap lives in `FindingCollector` rather than in a separate place for late findings,
  because the scene's clock and random reads are recorded only after its build callback
  returns, and `checkScene` never sees what the scene dropped: a dropped error would
  turn a failing run into exit 0. The report says when findings were dropped. A
  structural mistake — a row the scene does not have, a callback that returns a promise
  — is thrown instead, since there is no placeholder to continue with.
- The public names are `Finding` (the plain data), `Severity` (`"error" | "warning"`),
  `SourceLocation` (`file`, `line`, `column`), and `FindingCollector`, which records up
  to the cap. A finding's location fields are `row`, `target`, `joint`, `time` (seconds)
  and `frames`, all optional; `measured` holds the measured values and `nearest` the
  nearest valid names. Exported thrown classes live in `src/errors.ts`, an internal one
  beside the layer that throws it, and all extend `CharadeError`; `UnknownFlagError`
  (`ERR_CLI_UNKNOWN_FLAG`) carries the flag's dotted `path`.
- The scene layer throws `AsyncBuildError` (`ERR_SCENE_ASYNC_BUILD`), `UnknownRowError`
  (`ERR_SCENE_UNKNOWN_ROW`, carrying the scene's `rows`) and `SceneClosedError`
  (`ERR_SCENE_CLOSED`). Its findings are `ERR_SCENE_UNKNOWN_CHANNEL`,
  `ERR_SCENE_UNKNOWN_EFFECTOR`, `ERR_SCENE_UNKNOWN_MODE` and `ERR_SCENE_UNKNOWN_OPTION`
  (each with `nearest`), `ERR_SCENE_EFFECTOR_AS_CHANNEL`, `ERR_SCENE_OUT_OF_RANGE` (a
  number was expected), `ERR_SCENE_INVALID_VALUE` (another type was expected),
  `ERR_SCENE_NO_CURSOR`, `ERR_SCENE_ROW_REQUIRED`, `ERR_SCENE_ROW_HAS_ACTOR`,
  `ERR_SCENE_NO_DURATION`, the vocabulary findings `ERR_SCENE_UNKNOWN_ACTION`,
  `ERR_SCENE_UNKNOWN_EXPRESSION`, `ERR_SCENE_UNKNOWN_PROP`,
  `ERR_SCENE_UNKNOWN_BACKDROP`, `ERR_SCENE_UNKNOWN_EFFECT` and `ERR_SCENE_UNKNOWN_MARK`
  (each with `nearest`), `ERR_SCENE_MISSING_PARAMETER`, `ERR_SCENE_MISSING_MARK` and
  `ERR_SCENE_NO_ACTOR` (a prop held in a row that has no actor yet), and the warning
  `ERR_SCENE_FULL_BODY_CUT`. `svgPath` throws `InvalidPathDataError`
  (`ERR_SCENE_INVALID_PATH_DATA`, carrying the character `offset`) while a frame is
  drawn. `define…` throws `ReservedParameterError`, `InvalidDefaultError` and
  `InvalidDefinitionError` (`ERR_DEFINE_`, each carrying `kind` and `path`). An
  authoring finding carries its `row` and the handle's id as `target`, and the channel
  as `joint`; it has no `source` yet, since reading a call site from a stack trace is
  not built.
- Drawing a frame throws when one item throws: an actor whose `drive` function throws at
  a frame after `t = 0`, a free drawing's callback that throws, or a drawing call the
  context rejects, such as the recorder's `ERR_SCENE_NON_FINITE_DRAWING` for `NaN`. The
  frame drawer wraps it in `FrameItemError` (`ERR_SCENE_DRAWING_FAILED`, internal to
  `src/draw/frame.ts`), carrying `row`, the item's id as `target`, `frame` and `time` in
  seconds, with the original error as `cause`; the recorder's `call` and `argument` are
  on that cause. It is thrown, not recorded: a frame with a hole in it has no
  placeholder to continue with, and the pure layer has no collector. The layer that
  draws the frames, `check` or `render`, turns it into an error finding with the same
  code, row, target and time. It is never swallowed.
- Leaving the frame is a warning. A figure that walks off is ordinary acting, and the
  first README video ends with one. Text follows it, with the same code: clipped text is
  a fault of looks that `frame` shows at once, an error would stop `render` over a
  caption a few pixels wide of the edge, and a warning can be raised later only as a
  breaking change. `--strict` is there for a run that must not ship one.
- Text too small to read is `ERR_CHECK_TEXT_TOO_SMALL`, a warning for the same reasons.
  The threshold is 12 px at the output size (`MIN_TEXT_PX`): below it the strokes of a
  kanji run together, and Latin text is already hard to read. What is measured is the
  font size in output pixels, the size in row units times the row's pixels per unit, not
  a glyph box: a glyph box differs by font, and Noto Sans CJK's is 1.45 sizes high.
  Exactly 12 px passes; the size is rounded to a millionth of a pixel first, so a size
  that is 12 px but for a rounding step passes too. `measured` holds `size` and `min` in
  pixels, and the fix names a size in units rounded up, so following it clears the
  check.
- A label is measured by the box of its lines and a bubble by its body without the tail,
  against the row's visible area, at every frame it is shown. They are laid out with the
  measurer `checkScene` is given (`measurer`), which is the recording context's fake by
  default; the CLI passes a skia-canvas context set to the chosen font, so the box is
  the one the frame draws. A bubble whose speaker's function throws at a frame is a
  failure of the bubble as well, as a held prop's is.
- Text drawn with `drawText` inside a drawing is not measured: it has no box the check
  can read without tracking the context's transform, as a free drawing has none.
- A missing font is `ERR_ENV_FONT_MISSING`, a warning: the scene has a label or a
  bubble, names no font file, and no family of the system's list is installed. Drawing
  goes on with the rasteriser's fallback, and an error would stop `render` on a bare
  Linux machine. A font file the scene names that cannot be read is
  `ERR_ENV_FONT_UNREADABLE`, an error: the scene asked for one font on every machine,
  and a video in another is not the one its file describes; `frame` and `sheet` still
  draw, with the system's list. Both are findings, not thrown, and carry no row. A scene
  whose only text is drawn with `drawText` gets the chosen font but neither finding,
  since nothing in the timeline says a drawing draws text.
- The computed checks are `checkScene` in `src/check/check.ts`, internal: it takes a
  built scene and returns the findings frozen into it followed by the computed ones. It
  composes every actor's pose and calls every free drawing at every frame, drawing on a
  recording context, so it needs no rasteriser. A scene with no countable length has no
  frames; it reports its authoring findings alone.
- The computed codes are `ERR_CHECK_JOINT_LIMIT` (error; `joint`, and `measured` holds
  `value`, `min`, `max`), `ERR_CHECK_OFF_FRAME` (warning; `measured.overshoot` in
  units), `ERR_CHECK_TEXT_OVERLAP` and `ERR_CHECK_TEXT_TOO_SMALL` (warnings; the second
  with `measured.size` and `measured.min` in pixels), `ERR_CHECK_CLOCK_READ` and
  `ERR_CHECK_UNSEEDED_RANDOM` (errors). A function that throws at a frame is the error
  `ERR_SCENE_DRAWING_FAILED`, keeping the code the frame drawer throws with. Each
  carries `row` and the item's id as `target`.
- Contiguous frames of one violation (same check, item and joint) are one finding, which
  describes its worst frame. `frames` is the first and last frame, both included; `time`
  runs from the first frame's time to where the last frame's ends, `(last + 1) / fps`,
  half-open as a segment is. So a violation on frames 36 to 44 at 30 fps is 1.2 to 1.5
  s. A gap of one clean frame starts a new finding.
- The limit is checked on the composed angle, not on the call that set it: a `replace`
  pose is held after its call ends, so its finding runs until something moves the joint
  back, and it starts at the first frame the blend has left the limit, not at the call's
  first frame.
- Leaving the frame is measured on the figure's joints and its head circle against the
  row's visible area (`width / scale` units across, −0.3 to 2.2 up), with any part
  outside counting; line width is ignored. A prop is measured at its ground point while
  it is shown, since its drawing has no extent the check can read: where it was placed,
  on the effector that holds it, or along its move. A held prop composes its holder's
  pose, so a holder whose function throws at a frame is a failure of the prop as well. A
  free drawing is not measured. Nor is an effect: it is drawn around a point or a part
  of an actor, and the actor is measured already. An effect on an actor composes that
  actor's pose as a held prop does its holder's, so the actor's clock and random reads
  stay the actor's and its failure is the effect's as well.
- An actor over text is a warning, not an error. Text is the top slot, so what is hidden
  is part of the figure, which a hand passing behind a label does on purpose; an error
  would stop `render` on a question of looks; and a warning can be raised to an error
  later only as a breaking change, so the weaker one is chosen while no text exists to
  tune it on. The test is exact for the skeleton, not a bounding box: a bone's line or
  the head circle touching the text's box. The box is a `TextBox` (`id`, `row`, and `x`,
  `y`, `width`, `height` in row units from its lower left corner): the scene's labels
  and bubble bodies at that frame, or what `textBoxes` returns in their place.
- A report is capped at `FINDING_CAP` like a scene's findings, authoring findings first
  and computed ones in order of their first frame. When the cap cuts, a warning gives
  way to an error: a dropped error would turn a failing run into exit 0.
- Reading the clock or an unseeded random number is detected by replacing `Date`,
  `performance.now` and `Math.random` while the scene callback and every frame's
  functions run, in every command. A scan of the source would flag comments and miss
  indirect calls; a parser would be a second dependency.
- The replacement itself is `watchGlobals` in `src/export/watch.ts`: the export layer is
  the one that may name those globals. The pure layers reach it through a seam,
  `src/check/reads.ts`: the CLI calls `installReadWatch(watchGlobals)` for the length of
  a scene command, and `scene()` and `checkScene` run author functions inside
  `watchReads`, which with nothing installed just runs them. So the ESLint ban on the
  clock and `Math.random` in the pure layers stays as it is, with no disable comment:
  pure code names a function it was handed, never a global.
- The wrap is in `scene()`, around the build callback, not around loading the file.
  Loading is an `await`, so a replacement held across it would also catch whatever else
  runs meanwhile and every imported package's start-up; the build callback is
  synchronous, so the globals are back before `scene()` returns. A read at a module's
  top level, outside the callback, is therefore not seen.
- A watched global still answers as the real one does, so the scene runs on and one
  check reports every read. Only reading the current time counts: `Date.now()`,
  `new Date()` and `Date()`, not `new Date(2020, 0, 1)` or `Date.UTC`. A nested watch
  keeps its reads to itself.
- A read in the build callback is a finding frozen into the scene, with no row or
  target. A read at a frame names the track. Both use the `ERR_CHECK_` codes, also the
  one recorded while authoring: it is one failure with one fix, and a caller should not
  need two codes for it. The call a `drive` gets at `t = 0` while it is recorded drops
  its reads, since the frame check meets the same read at every frame and names the
  track; kept, one mistake would be reported twice.

## Output

- The default output is compiler-style text, one finding per block with its fix line,
  then a count. `--json` prints one document, `{ version, ok, findings, summary }`. Text
  is the default because the fix line is what the author acts on.
- Exit code 0 is clean (warnings allowed), 1 is error findings, 2 is could not run
  (usage, loading, environment). `--strict` makes warnings fail.
- These are data in `src/check/findings.ts`: `exitCodeFor(findings, { strict })` returns
  0 or 1, `COULD_NOT_RUN` is 2, and `ExitCode` is `0 | 1 | 2`. `checkReport` builds the
  `CheckReport`: `version` is `1`, `ok` agrees with `exitCodeFor` under the same
  strictness, and `summary` is `{ errors, warnings, truncated }`.
- The text description of state — who is where, in which pose, facing which way — is
  printed by `frame` and `sheet` for the frames they drew, and by `check --at` for given
  times without drawing. It is not a command of its own.
- Text checks need real font metrics, so `check` loads the rasteriser for a scene that
  has a label or a bubble, to look up the font and to measure with it; for any other
  scene it loads nothing. It never needs ffmpeg. `frame` and `sheet` run `checkScene`
  with the same measurer and font findings, so their count is `check`'s.
- The text is `formatReport` in `src/check/check.ts`: per finding
  `<severity> <code>: <message>`, an `at:` line with the place (row, target, joint,
  seconds, frames) when there is one, and a `fix:` line; then `<n> errors, <m> warnings`
  and a line saying so when findings were dropped. It goes to stdout.
- `check --at` prints the findings first and the description after them; under `--json`
  the description is a fifth key, `state`. The description is `describeState` in
  `src/check/describe.ts`: per row, each actor's facing, the positions of its pelvis,
  head, hands and feet in row units, and the channels away from rest; each shown prop's
  ground point; each shown free drawing's id; each shown label's and bubble's id and
  text (`texts`), since a contact sheet cell is too small to read a caption from.
  Numbers are rounded to three decimals. It composes poses, which calls `drive`
  functions, and never calls a drawing callback.
- As text (`formatState`) a description is `state at <seconds> s (frame <n>)`, then per
  row `row <i>` and, indented, `actor <id>: facing <side>, pelvis (x, y), head (x, y)`
  with a `hands:`/`feet:` line and a `pose:` line of the channels away from rest (`rest`
  when none), `prop <id>: at (x, y)`, `drawing <id>`, `text <id>: "<text>"` (the text as
  a JSON string, so a newline stays on the line), or `empty`. `frame` and `sheet` print
  the same block for each frame they drew, in frame order with a blank line after each,
  between the `wrote <path>` line and the count: one format for `check --at` and the
  check images, so an agent matches a block to a cell by the frame number both carry.
  The sheet and ghost layout is `src/check/sheet.ts`, pure and recorded like any
  drawing; `frame` and `sheet` run `checkScene` only for its count.
