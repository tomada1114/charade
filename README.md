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
import { normalizeIdentifier } from "charade";

console.log(normalizeIdentifier("Hello World"));
// => "hello-world"
```

All public symbols are named exports from the package root. Deep imports are private and
blocked by the package export map.

## API

- `normalizeIdentifier(input, options?)` creates a URL- and filename-safe ASCII
  identifier using `-`, `_`, `.`, or `~` as its separator.
- `withTimeout(operation, options)` runs an abortable operation with a deadline.
- `InvalidInputError` and `TimeoutError` expose stable error codes.

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
