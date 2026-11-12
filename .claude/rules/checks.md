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
- `NaN` or an infinity in an argument throws instead of being logged.
- A property write is logged as a call. A gradient is logged by its creation index.
- The recording context measures text with a deterministic fake, so a bubble's layout in
  the log is not the layout of the real output. Text is tested through this fake only;
  no font file is committed to the repository.
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
  the first. Recording stops at about twenty findings.
- Leaving the frame is a warning. A figure that walks off is ordinary acting, and the
  first README video ends with one.
- Reading the clock or an unseeded random number is detected by replacing `Date`,
  `performance.now` and `Math.random` while the scene callback and every frame's
  functions run, in every command. A scan of the source would flag comments and miss
  indirect calls; a parser would be a second dependency.

## Output

- The default output is compiler-style text, one finding per block with its fix line,
  then a count. `--json` prints one document, `{ version, ok, findings, summary }`. Text
  is the default because the fix line is what the author acts on.
- Exit code 0 is clean (warnings allowed), 1 is error findings, 2 is could not run
  (usage, loading, environment). `--strict` makes warnings fail.
- The text description of state — who is where, in which pose, facing which way — is
  printed by `frame` and `sheet` for the frames they drew, and by `check --at` for given
  times without drawing. It is not a command of its own.
- Text checks need real font metrics, so `check` loads the rasteriser; it never needs
  ffmpeg.
