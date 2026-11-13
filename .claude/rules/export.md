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
  the timeline must not cross a version boundary. A differing local version gets one
  line on stderr naming both, and the run continues.
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
- The hook is `src/export/hook.ts`; it resolves this copy as `../index.js` from its own
  URL and records each failed resolution (specifier, importer, the error instance that
  `import()` rejects with), so a fix line names the specifier as written without reading
  Node's message. The local version is read from the scene folder's resolution of
  `charade/package.json`, before the hook is registered, without importing it.
- The loader is `src/export/loader.ts`, keyed on Node's `code`: `ERR_MODULE_NOT_FOUND`
  with a `url` and an existing `.ts` twin is `ERR_LOAD_HELPER_EXTENSION` (its fix names
  the `.ts` specifier), without a twin `ERR_LOAD_MODULE_NOT_FOUND`, and without a `url`
  `ERR_LOAD_PACKAGE_NOT_FOUND`; `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` is
  `ERR_LOAD_UNSUPPORTED_SYNTAX`; `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` is
  `ERR_LOAD_TS_IN_NODE_MODULES`. A codeless `SyntaxError` naming a missing export is
  `ERR_LOAD_MISSING_EXPORT`, the one case read from the message, since V8 gives it no
  code and a plain syntax error is also a codeless `SyntaxError`. A missing scene file
  is `ERR_LOAD_SCENE_NOT_FOUND`, a default export without `kind: "charade.scene"` is
  `ERR_LOAD_NOT_A_SCENE`, and anything else, a scene that throws included, is
  `ERR_LOAD_FAILED` with the original as `cause`. All are internal and carry `fix`.

## Rasterising

- skia-canvas is imported lazily, so `--help` and argument errors work when the native
  binary is missing, and a missing binary is reported with a code rather than a stack
  trace.
- Every canvas is created with GPU rendering off. skia-canvas turns it on where the
  platform supports it (<https://skia-canvas.org/api/canvas>, checked 2026-11-12), and
  the same scene on the same machine has to yield byte-identical frames whether or not a
  GPU initialised. Render speed is not what this package competes on. The mechanism is
  skia-canvas 4's constructor option, `new Canvas(width, height, { gpu: false })`.
- When a scene has text, names no font file, and no font from the per-OS list is
  installed, drawing continues with the rasteriser's fallback and `check` and `render`
  report it with how to fix it. Stopping would block the first video on a bare Linux
  machine.
- Every frame is painted on an opaque background; alpha is dropped when the frame is
  converted for the encoder. The rasteriser (`src/export/raster.ts`) exports with
  `matte` set to the paper colour, so a drawing that resets the context or makes no
  calls is still opaque; its raw output is unpremultiplied RGBA, `width × height × 4`
  bytes, alpha 255 everywhere.

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

- The encoder is libx264 and nothing else. Without it `render` stops with a code and
  install guidance; falling back to another H.264 encoder would add argument sets and
  output that nothing here tests.

## Commands

- Output goes next to the scene, named after it: the video, the contact sheet, the ghost
  image, a single frame. `-o, --out` overrides the path. Existing output is overwritten,
  because the loop regenerates it on every pass.
- stdout carries the result: paths written, findings, descriptions, the catalog. stderr
  carries progress and notices. `--json` exists on every command and makes stdout
  exactly one JSON document, also on failure.
- The scene is the only source of seed, frame rate and size. There are no override
  flags, so a video is a function of its file.
- `--at` takes seconds, as a scene does: `1.5` and `1.5s` are seconds, `45f` is a frame.
  One parser, `parseAt` in `src/cli.ts`, takes ASCII digits only: no sign, exponent,
  leading or trailing dot, and no frame past the safe integers; anything else is
  `ERR_CLI_INVALID_AT`.
- The command comes first. A usage error is `ERR_CLI_NO_COMMAND`,
  `ERR_CLI_UNKNOWN_COMMAND`, `ERR_CLI_UNKNOWN_FLAG` (the flag's dotted path, named from
  `parseArgs` tokens), `ERR_CLI_MISSING_VALUE`, `ERR_CLI_UNEXPECTED_VALUE`,
  `ERR_CLI_UNEXPECTED_ARGUMENT`, `ERR_CLI_MISSING_SCENE` or `ERR_CLI_MISSING_FLAG`. A
  failure under `--json` is `{ version: 1, ok: false, error: { code, message, fix } }`;
  as text it is `error <code>: <message>` and a `fix:` line on stderr. A command whose
  body is not built yet answers `ERR_CLI_NOT_IMPLEMENTED`.
- `sheet` picks twelve evenly spaced frames including the first and the last by default,
  or the times, range or row it is given, labels every cell with its time and frame
  number, and scales the sheet to a width an agent's image input can take. `--ghost`
  draws one actor's motion overlaid on a single image instead.
- `catalog` prints every item with its description, parameters, marks and moods, and the
  rig: joints, limits, effectors, face channels and conventions. Sample images are
  written only with `--images`, for all items or the one named.
- `check` and `catalog` also accept a module of definitions, so a user's own vocabulary
  goes through the same loop as a built-in.
- `render` runs the checks first. Error findings stop it before the first frame;
  warnings are printed and it continues. `frame` and `sheet` never refuse: looking at
  the broken pose is the loop.

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
