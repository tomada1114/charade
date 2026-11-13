# charade

[![CI](https://github.com/tomada1114/charade/actions/workflows/ci.yml/badge.svg)](https://github.com/tomada1114/charade/actions/workflows/ci.yml)

Short 2D animations where stick figures act out an idea — written as code by AI agents.

## Install

```sh
pnpm add charade
```

Requires Node.js 24 or newer. The package ships ESM only. CommonJS consumers need a
Node.js version with unflagged `require(esm)` support (20.19+, 22.12+, or 24+).

## Quick start

```ts
import { CharadeError } from "charade";

function reasonOf(error: unknown): string {
  return error instanceof CharadeError ? error.code : "unknown";
}

console.log(reasonOf(new Error("not ours")));
// => "unknown"
```

All public symbols are named exports from the package root. Deep imports are private and
blocked by the package export map.

## Writing a scene

A scene file calls `scene` and exports the result. `build` runs once and records what
each actor does and when; nothing is drawn while it runs.

```ts
import { scene } from "charade";

export default scene({ rows: 2 }, (stage) => {
  const hero = stage.row(0).actor({ name: "hero" });
  const friend = stage.row(1).actor({ name: "friend" });

  // Calls without `at` play one after the other.
  hero.pose({ hipR: 1.4, kneeR: 1.5, spine: 0.3 }, { duration: 0.6 });
  const wave = hero.reach("handR", { x: 0.25, y: 0.95 }, { duration: 0.4 });
  hero.wait(0.5);

  // `at` is absolute scene time; every call returns its span in seconds.
  friend.pose({ neck: 0.3 }, { at: wave.start, anticipation: 0.1 });

  // Depth 3: motion as a function of time, on the joints it names only.
  friend.drive((t) => ({ spine: Math.sin(t * 3) * 0.1 }), {
    at: wave.end,
    duration: 1,
    mode: "add",
  });
});
```

- Time is in seconds, angles are radians, and points are in a row's own units: the
  origin on the ground at the row's centre, `y` up, a standing figure 1 unit tall.
- `pose` moves the channels it names and holds them; `reach` puts a hand or a foot on a
  point; `drive` runs channels as a function of time; `wait` moves the actor's cursor
  on. When two calls overlap, the one recorded later wins for the channels it names,
  blended in over `blend` seconds (0.2 by default).
- `stage.row(i)` names a row, 0 at the top; on a one-row scene the stage is the row.
  `stage.sync()` moves every actor's cursor to the latest end. `row.draw` records a free
  drawing on a `ShapeContext`.
- The result is frozen data: `kind: "charade.scene"`, the `timeline`, and the `findings`
  recorded while the scene ran. An unknown name or a bad value is a finding with a `fix`
  line, and the scene goes on with a placeholder, so one run reports every mistake.

## API

- `CharadeError` is the base of every error charade throws. Branch on its stable `code`,
  never on `message`.
- `UnknownFlagError` (`ERR_CLI_UNKNOWN_FLAG`) is thrown for a flag a command does not
  have; its `path` names the flag, never the value passed with it.
- `AsyncBuildError` (`ERR_SCENE_ASYNC_BUILD`) is thrown when a scene's `build` returns a
  promise, `UnknownRowError` (`ERR_SCENE_UNKNOWN_ROW`) when `stage.row(i)` names a row
  the scene does not have (its `rows` is the row count), and `SceneClosedError`
  (`ERR_SCENE_CLOSED`) when a handle is used after `scene()` returned.
- `Finding`, `Severity` and `SourceLocation` describe one problem found in a scene as
  plain data: an `ERR_<AREA>_<FAILURE>` `code`, an `error` or `warning` severity, what
  is wrong, how to fix it, and where it applies.
- `FindingCollector` records findings up to `FINDING_CAP` (20), keeping the first ones.
- `exitCodeFor` maps findings to an `ExitCode` (0 clean, 1 failing findings, with
  `strict` making warnings fail; `COULD_NOT_RUN` is 2), and `checkReport` builds the
  `CheckReport` document `{ version, ok, findings, summary }`.

```ts
import { checkReport, exitCodeFor, type Finding } from "charade";

const findings: Finding[] = [
  {
    code: "ERR_CHECK_OFF_FRAME",
    severity: "warning",
    message: "hero leaves the frame",
    fix: "Ignore it if the exit is meant",
  },
];
console.log(exitCodeFor(findings), exitCodeFor(findings, { strict: true }));
// => 0 1
console.log(checkReport(findings).summary);
// => { errors: 0, warnings: 1, truncated: false }
```

- `DrawingContext` is the drawing context the engine draws a frame on: the standard
  Canvas 2D members whose arguments and results are numbers, strings or this package's
  own `Gradient` and `TextMeasurement`. `ShapeContext` is the same without the text
  members, and is what a depth 4 drawing callback receives. Both are receive-only: you
  are handed one, never implement it.

```ts
import type { ShapeContext } from "charade";

function drawBall(ctx: ShapeContext): void {
  const shade = ctx.createRadialGradient(0, 0.1, 0, 0, 0.1, 0.1);
  shade.addColorStop(0, "#ffd166");
  shade.addColorStop(1, "#e4572e");
  ctx.beginPath();
  ctx.arc(0, 0.1, 0.1, 0, Math.PI * 2);
  ctx.fillStyle = shade;
  ctx.fill();
}
```

See the generated TypeDoc documentation from `pnpm docs:build` for the full API
reference.

## Development

```sh
corepack pnpm@11.18.0 install --frozen-lockfile
pnpm hooks:install
pnpm check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete workflow.

## License

[MIT](LICENSE) © tomada
