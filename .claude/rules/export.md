---
paths:
  - "src/export/**"
  - "src/cli.ts"
---

# Export layer and CLI

The export layer is the only code that touches skia-canvas, ffmpeg and the file system.
It sits behind the CLI and is not exported from the root entry: rendering is CLI-only in
the first release. A programmatic API, if one is added, is a new `charade/node` subpath,
which is a minor change; it never goes into the root entry, whose import graph has to
stay free of Node-only modules.

## Loading a scene

- The CLI registers a resolve-only hook with `module.registerHooks()` that maps the
  exact specifier `charade`, from any importer, to the running CLI's own copy, then
  imports the scene file. This is what makes `npx charade render scene.ts` work in an
  empty folder with no flag. Node strips the types; this package transforms nothing.
- It is always the CLI's own copy, also when the folder has another version installed:
  the timeline must not cross a version boundary.
- `module.registerHooks()` is a release candidate (stability 1.2) in Node 24, and
  `module.register()` is deprecated
  (<https://nodejs.org/docs/latest-v24.x/api/module.html>, checked 2026-11-12). Keep the
  hook in one small module so a change in that API touches one file.
- Type stripping is stable from Node 24.12.0
  (<https://nodejs.org/docs/latest-v24.x/api/typescript.html>, checked 2026-11-12). On
  24.0–24.11 the CLI still runs and prints one line on stderr recommending 24.12 or
  newer. The published floor stays `>=24`.
- The hook does not reach an in-process import under vitest, and a `Worker` does not
  inherit it (both spiked on Node 24.22.1 with vitest 4.1.11, 2026-11-12). So the loader
  stays thin, and everything after it is a function that takes an already-built scene,
  which is what tests call and what coverage counts. Rendering is single-threaded in the
  first release.
- Node's own loading failures are translated into this package's errors with a fix line:
  a helper imported as `.js` or without an extension, a missing package, syntax that
  needs transformation (`enum`, parameter properties, a runtime namespace), a type
  imported without `import type`, and a `.ts` file under a `node_modules` path.

## Rasterising

- skia-canvas is imported lazily, so `--help` and argument errors work when the native
  binary is missing, and a missing binary is reported with a code rather than a stack
  trace.
- skia-canvas turns GPU rendering on where the platform supports it
  (<https://skia-canvas.org/api/canvas>, checked 2026-11-12). Whether the export layer
  forces the CPU path is not settled; the promise it has to keep is that the same scene
  on the same machine yields byte-identical frames.
- Every frame is painted on an opaque background; alpha is dropped when the frame is
  converted for the encoder.

## Encoding

- Frames are piped to ffmpeg's stdin as raw RGBA. A PNG sequence would cost a temporary
  directory, an encode and a decode per frame, and a second cleanup path.
- Nothing partial is ever left at the output path. Before the first frame: find ffmpeg,
  confirm an H.264 encoder, reject odd dimensions, run the scene and its fatal checks.
  Then write to a temporary file in the output's own directory with an explicit
  container format, rename on success, and remove it on failure or interrupt.
- ffmpeg's exit code does not prove the frame count: a truncated last frame still exits
  0 (spiked with ffmpeg 9.0.2 on macOS, 2026-11-12). Count the frames written and
  compare.
- ffmpeg is spawned without a shell. Its stderr is drained, stdin has an error listener
  and honours backpressure; an early exit otherwise surfaces as an unhandled `EPIPE`.

## Testing

- The default gate uses an injected, in-process fake in place of the spawn, which is the
  boundary a mock is allowed at, and keeps the logic inside coverage.
- A real-ffmpeg smoke path is a package script outside vitest: it renders a sample and
  asserts codec, pixel format, size and frame count with `ffprobe`, and fails with a
  code when ffmpeg is absent. It runs in CI, in a job that installs ffmpeg; until that
  job exists it is run by hand. It is not a vitest test, because a test may not be
  skipped and most machines have no ffmpeg.
- The empty-folder proof belongs in the package smoke check, which already installs the
  tarball into an empty consumer.
