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

## API

- `CharadeError` is the base of every error charade throws. Branch on its stable `code`,
  never on `message`.
- `UnknownFlagError` (`ERR_CLI_UNKNOWN_FLAG`) is thrown for a flag a command does not
  have; its `path` names the flag, never the value passed with it.
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
