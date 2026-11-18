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
- The font is chosen by `chooseFont` in `src/export/fonts.ts`, from the scene, the scene
  file's path, the platform and a `FontLookup` (`has(family)`, `use(alias, file)`),
  which the rasteriser backs with skia-canvas's `FontLibrary` and a test replaces. A
  font file the scene names is resolved from the scene file's folder, so the scene reads
  the same from any working directory, and registered under the family
  `charade scene font`; it wins whatever is installed. Otherwise the first installed
  family of the platform's list is used: `Hiragino Sans` on `darwin`, `Yu Gothic` on
  `win32`, and elsewhere `Noto Sans CJK JP`, `SC`, `TC`, `KR`, `HK` in that order, since
  Noto Sans CJK installs one family per language and each draws them all. The result is
  a CSS family list ending in `sans-serif`, the rasteriser's fallback.
- The findings are `ERR_ENV_FONT_MISSING` (warning) and `ERR_ENV_FONT_UNREADABLE`
  (error); `.claude/rules/checks.md` holds why. A command that draws looks the font up
  always, so text a drawing draws with `drawText` is in it too; `check` only for a scene
  with a label or a bubble. `Rasteriser.measurer(font)` is a context on a 1 px canvas of
  its own, kept for the length of the command.
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
- The encoder is `src/export/video.ts`; `render` in `src/cli.ts` only orders its steps.
  The order is: odd size (`ERR_RENDER_ODD_SIZE`, width named first), the font lookup and
  `checkScene`, then ffmpeg. The checks come before any spawn because an error finding
  must stop `render` without ffmpeg having run, and the size check is first because it
  costs nothing.
- ffmpeg is found and checked with one spawn of `ffmpeg -hide_banner -encoders`, looking
  for a video encoder line named `libx264`: it finds the program on `PATH` the way the
  encode will, and needs no second, version-specific probe. `ENOENT` is
  `ERR_ENV_FFMPEG_MISSING`, any other start failure or a non-zero exit
  `ERR_ENV_FFMPEG_UNUSABLE`, a listing without libx264 `ERR_ENV_NO_LIBX264`; all exit 2
  and nothing is written.
- The install line (the `fix` of all three) is per `process.platform`, naming a package
  that ships libx264: `darwin` `brew install ffmpeg`; `win32`
  `winget install --id Gyan.FFmpeg` and a new terminal for `PATH`; `linux`
  `sudo apt install ffmpeg` (Debian, Ubuntu), `sudo dnf install ffmpeg` from RPM Fusion
  (Fedora's own `ffmpeg-free` has no libx264), `sudo pacman -S ffmpeg` (Arch); elsewhere
  <https://ffmpeg.org/download.html>.
- The partial file is `.<output name>.<12 hex>.partial` in the output's folder, created
  with an exclusive open before ffmpeg starts: hidden, so the loop's folder listing
  stays clean, and the open proves the folder writable, so a missing folder is
  `ERR_RENDER_WRITE_FAILED` rather than an ffmpeg failure. A failed rename is the same
  code.
- The argument list, with why for each group: `-hide_banner -loglevel error -nostats`
  (stderr carries only errors, the last line of which a failure quotes);
  `-progress pipe:1` (ffmpeg's own count at `progress=end`, which with the frames sent
  is the count compared with `d × fps + 1`);
  `-f rawvideo -pix_fmt rgba -video_size WxH -framerate fps -i pipe:0 -an`;
  `-vf scale=out_color_matrix=bt709:out_range=tv,format=yuv420p` and
  `-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv` (swscale
  converts with BT.601 by default while players read untagged HD video as BT.709, which
  shifts the paper colour); `-c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p` (CRF
  18 keeps thin lines on flat paper free of ringing; file size is not what this competes
  on); `-movflags +faststart` (plays before it is fully read, as a preview does);
  `-f mp4 -y <partial>` (the explicit container, since the name ends in `.partial`).
- After the frames: ffmpeg not taking every frame (a stdin error, an exit before the
  last frame) is `ERR_RENDER_ENCODER_CLOSED`; every frame taken and a non-zero exit
  `ERR_RENDER_ENCODER_FAILED`; exit 0 with fewer frames sent or reported than the scene
  has, or no `progress=end`, `ERR_RENDER_FRAME_COUNT`. All exit 2 and remove the partial
  file. A frame is written only at `width × height × 4` bytes.
- SIGINT, SIGTERM and SIGHUP during the encode kill ffmpeg, remove the partial file
  synchronously, then re-raise the signal with the handler gone, so the process ends as
  it would have; `ERR_RENDER_INTERRUPTED` is what the run reports when the signal is not
  re-raised, as under the injected fake.
- `render` prints `wrote <path>`, then the report as `check` prints it, warnings
  included; `--json` is `{ version, ok, paths, findings, summary }`. Error findings
  print the report alone and exit 1, with `paths` empty. Progress is
  `render: <sent>/<total> frames` on stderr about every tenth of the frames.

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
  `ERR_CLI_INVALID_AT`. Seconds name the frame on screen at that time, the last one at
  or before it (`frameAt`), so `0.99` at 30 fps is frame 29. A frame after the scene's
  last one is `ERR_CLI_AT_PAST_END`, exit 2, naming the last frame: describing a frame
  the video does not have would mislead.
- The command comes first. A usage error is `ERR_CLI_NO_COMMAND`,
  `ERR_CLI_UNKNOWN_COMMAND`, `ERR_CLI_UNKNOWN_FLAG` (the flag's dotted path, named from
  `parseArgs` tokens), `ERR_CLI_MISSING_VALUE`, `ERR_CLI_UNEXPECTED_VALUE`,
  `ERR_CLI_UNEXPECTED_ARGUMENT`, `ERR_CLI_MISSING_SCENE`, `ERR_CLI_MISSING_FLAG` or, for
  a name `catalog` does not know, `ERR_CLI_UNKNOWN_ITEM`. A failure under `--json` is
  `{ version: 1, ok: false, error: { code, message, fix } }`; as text it is
  `error <code>: <message>` and a `fix:` line on stderr. Every command's body is built,
  so `ERR_CLI_NOT_IMPLEMENTED` is gone.
- `sheet` picks twelve evenly spaced frames including the first and the last by default,
  or the times, range or row it is given, labels every cell with its time and frame
  number, and scales the sheet to a width an agent's image input can take. `--ghost`
  draws one actor's motion overlaid on a single image instead.
- A check image is named `<scene>.<what>.png` beside the scene: `sit.frame-45.png`,
  `sit.sheet.png`, `sit.ghost.png` (`outputBeside` in `src/export/images.ts`). A frame's
  name carries its frame number, not its time: `1.5`, `1.5s` and `45f` then write one
  file, and a time would put a second dot in the name. The path printed is the scene's
  path as given with that name, so an agent can open it from where it ran the command.
- Evenly spaced means frame `i` of `n + 1` is `first + i × span / n` rounded to the
  nearest frame, a half up, in integers (`spreadFrames` in `src/check/sheet.ts`): 121
  frames give 0, 11, 22, 33, 44, 55, 65, 76, 87, 98, 109, 120. Rounding to nearest keeps
  the gaps within one frame of each other; flooring would bunch the error at the end. A
  span with fewer frames than cells gives every frame once, never a repeated cell.
- `sheet` selects with `--times <list>` (comma-separated `--at` values, drawn in time
  order, each once), `--from <time>` and `--to <time>` (twelve frames spread over that
  range, either end defaulting to the scene's), and `--row <index>` (each cell holds
  that row alone, at its own aspect ratio, so the figures are larger). All times go
  through `parseAt` and `frameAt`, so there is one spelling of a time. `--times` with
  `--from` or `--to`, and `--row` with `--ghost`, are `ERR_CLI_CONFLICTING_FLAGS`; more
  than 48 times is `ERR_CLI_TOO_MANY_TIMES`, since a cell would be too small to read; a
  row the scene lacks is `ERR_CLI_INVALID_ROW`, `--from` after `--to` is
  `ERR_CLI_INVALID_RANGE`, and a scene with no length and no `--times` is
  `ERR_CLI_NO_LENGTH`.
- A sheet is 1568 px wide, four cells to a row with 8 px between and a 24 px label strip
  under each cell (`sheetLayout`): 1568 px is the long edge an agent's image input keeps
  without scaling down again, and four columns leave a 16:9 cell 382 px wide, enough to
  read a pose. Fewer than four frames use as many columns as frames. When the sheet
  would be taller than 1568 px the cells shrink until it is not. A cell is drawn at the
  cell's size from the timeline, not scaled down from a full frame, so lines keep their
  weight relative to the figure; each cell is its own canvas, since `drawFrame` resets
  its context and sets absolute transforms (`Rasteriser.composite`).
- A cell's label is `<seconds> s  frame <n>`, the time to three decimals as the state
  description prints it, in `16px sans-serif`: a generic family, so no font file is
  committed and none has to be installed, and a fixed size in sheet pixels so it reads
  the same whatever the scene's size. Each cell has a 1 px outline, since a cell is
  paper on paper.
- `--ghost <actor>` takes the actor's id as findings and the state description print it
  (`row0/actor/actor/0`), or its bare name when exactly one actor has it; anything else
  is `ERR_CLI_UNKNOWN_ACTOR`, whose fix lists the ids. The flag keeps its value rather
  than defaulting to the only actor, so the command reads the same once a scene has two.
  The image is the actor's row alone, 1568 px wide, with eight ghosts spread over the
  scene (or over `--from`/`--to`, or at `--times`): eight still read apart when the
  actor crosses the row and are few enough to tell apart where it stays put. Opacity
  runs from 0.15 for the earliest to 1 for the last, so the direction of time reads from
  a still. The row's backdrop is drawn once, at the last ghost's frame; its other items
  are left out, having no single time to be drawn at. One legend line beneath names the
  actor and the frames.
- `frame` and `sheet` print `wrote <path>`, then the state description of each frame
  drawn, then the count of the scene's findings as `check` prints it; they exit 0
  whatever that count is. `--json` is `{ version, ok, paths, states, summary }`. With
  `--row` or `--ghost` a description holds the row drawn alone. A function that throws
  at a frame being drawn cannot be drawn around: the command fails with
  `ERR_SCENE_DRAWING_FAILED`, exit 2, and its fix line points at `check`. A file that
  cannot be written is `ERR_RENDER_WRITE_FAILED`; a missing folder is not created.
- `catalog` prints every item with its description, parameters, marks and moods, and the
  rig: joints, limits, effectors, face channels and conventions. Sample images are
  written only with `--images`, for all items or the one named.
- The listing is built in the check layer, `src/check/catalog.ts`: `catalogItem` reads a
  definition, `describeRig` the rig's constants, and `formatCatalog` writes the text. As
  text, a short `use:` block says how a scene calls each kind present; then one block
  per item, `<kind> <name> — <description>`, one line per parameter
  (`<name>: <type>, default <value> | required, <min>..<max> <unit> — <doc>`, an enum's
  values in brackets after its type), and for an action `marks:` and
  `moods that change the body:`, `none` when empty; then `rig`. One line per parameter
  keeps the listing short enough to read whole, which is what an agent does with it.
- `--json` is `{ version, ok, items, rig, images }`. An item is
  `{ kind, name, description, params, marks, moods, sample }`: `params` is the runtime
  specification as declared, `marks` and `moods` are empty lists for a kind that has
  none, so every item has one shape, and `sample` says whether there is one to draw.
  `rig` is `{ joints, root, effectors, face, segments, conventions }`; a joint is
  `{ name, parent, min, max }` with `null` limits for `pelvis`, since JSON has no
  infinity, and `conventions` is text by topic (`facing`, `angles`, `space`, `root`,
  `effectors`, `limits`).
- `catalog <name>` shows the items of that name and leaves the rig out. A name two kinds
  share shows both, each with its kind beside it, and `<kind>.<name>` (`prop.ball`)
  narrows to one: showing both needs no second question, and the qualified spelling is
  the image's file name. The bare name is tried first, so an item whose own name has a
  dot stays reachable. A name that matches nothing is `ERR_CLI_UNKNOWN_ITEM`, exit 2,
  whose fix and, under `--json`, `error.nearest` list the nearest items as
  `<kind>.<name>`, by the metric of `src/check/nearest.ts`; a `<kind>.` prefix keeps the
  search within that kind.
- `--images [dir]` writes into `dir`, `charade-catalog` under the current directory when
  the flag stands alone (`CATALOG_IMAGES`): built-ins have no scene file to sit beside,
  and one folder is one thing to delete. The folder and its parents are made when
  missing, unlike `-o`: nobody has made the default folder before the first run. A file
  is `<kind>.<name>.png`, the kind because two kinds may share a name; a character of
  the name outside letters, digits, `_` and `-` becomes `_`, so a name cannot leave the
  folder. `parseArgs` has no optional value, so an `--images` with nothing or a flag
  after it is rewritten to `--images=` before parsing; whatever else follows it is the
  folder, which is why the name is written before the flag.
- A sample image is the item's `sample(stage)` passed to `scene` (`sampleScene`) and
  drawn at the sample scene's own size. An action or an effect is a contact sheet of
  twelve frames spread over the sample, laid out and labelled as `sheet` does: motion
  does not read from one frame. An expression is the sample's last frame alone, full
  size: a face is too small to read in a sheet cell, and the last frame is where a blend
  into an expression has arrived, the first being the resting face. A prop or a backdrop
  is the sample's first frame alone: it draws the same at every frame it is shown, and a
  sample that gives it a duration has ended it by the last frame. An item without a
  sample is listed and gets no image; `images` in the document holds
  `{ kind, name, path }` for each one written, and the text ends with a `wrote <path>`
  line for each. A sample that throws is `ERR_DEFINE_SAMPLE_FAILED`
  (`SampleFailedError`, internal to `src/check/catalog.ts`, carrying `kind`, `item` and
  the `cause`), exit 2. `catalog` does not check the samples; `check --defs` does.
- `check` and `catalog` also accept a module of definitions, so a user's own vocabulary
  goes through the same loop as a built-in. Both take it as `--defs <module>`: `catalog`
  has its positional taken by the item's name, and one spelling on both commands is one
  thing for a skill to teach. It is loaded as a scene file is (`loadDefinitions`).
- A definitions module's items are its exports: every export, named or default, whose
  value is what a `define…` function returned (frozen, with a `kind`, a `name`, a
  `description`, `params` and its `build` or `draw`), listed by kind and then in export
  order (`definitionsFrom`). An item's module already exports it under its own name, so
  a file of items is a definitions module with no second list to keep in step. Other
  exports are passed over and a value exported twice counts once. No definition is
  `ERR_LOAD_NO_DEFINITIONS`; two of one kind under one name is
  `ERR_LOAD_DUPLICATE_DEFINITION` (carrying `kind` and `item`).
- With `--defs`, `catalog` lists the module's items in place of the built-ins, without
  the rig, and `--images` draws those alone: the loop of adding an item is about that
  item, and the built-ins are one `catalog` away. A user's item may share a built-in's
  name, since it is passed as its definition.
- `check --defs <module>` builds every item's sample and checks it as `check` checks a
  scene; a scene path beside it is `ERR_CLI_UNEXPECTED_ARGUMENT` and `--at` with it
  `ERR_CLI_CONFLICTING_FLAGS`. `--json` is `{ version, ok, items, summary }`, an item
  being `{ kind, name, ok, findings, summary }`: a finding names a row and a target but
  not an item, so the report keeps each sample's findings under its item rather than in
  one flat list. `summary` counts all of them and the exit code follows it. As text each
  item is `<kind> <name>` and its report, then a `total:` line. An item without a sample
  is the warning `ERR_DEFINE_NO_SAMPLE`, since nothing of it was checked.
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
