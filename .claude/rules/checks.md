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
- Updating a record is blind to what changed, so the look step belongs to the flow that
  adds or changes an item, not to the test. Where records are stored is not settled.

## Findings

Every finding says what is wrong, where, and how to fix it, and carries a stable code;
the code is contract and the wording is not.
