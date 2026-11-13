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
  colour (ink inside the head, background in a corner).
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
  no font file is committed to the repository.
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
- An unknown name or a bad parameter while a scene runs is recorded as a finding and
  authoring continues with a placeholder, so one run reports every mistake instead of
  the first. Recording stops at twenty findings (`FINDING_CAP`), keeping the first ones;
  the report says when later ones were dropped. A structural mistake — a row the scene
  does not have, a callback that returns a promise — is thrown instead, since there is
  no placeholder to continue with.
- The public names are `Finding` (the plain data), `Severity` (`"error" | "warning"`),
  `SourceLocation` (`file`, `line`, `column`), and `FindingCollector`, which records up
  to the cap. A finding's location fields are `row`, `target`, `joint`, `time` (seconds)
  and `frames`, all optional; `measured` holds the measured values and `nearest` the
  nearest valid names. Exported thrown classes live in `src/errors.ts`, an internal one
  beside the layer that throws it, and all extend `CharadeError`; `UnknownFlagError`
  (`ERR_CLI_UNKNOWN_FLAG`) carries the flag's dotted `path`.
- Leaving the frame is a warning. A figure that walks off is ordinary acting, and the
  first README video ends with one.
- Reading the clock or an unseeded random number is detected by replacing `Date`,
  `performance.now` and `Math.random` while the scene callback and every frame's
  functions run, in every command. The replacement is done by the export layer, which is
  what runs them; the pure layers never touch those globals. A scan of the source would
  flag comments and miss indirect calls; a parser would be a second dependency.

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
- Text checks need real font metrics, so `check` loads the rasteriser; it never needs
  ffmpeg.
