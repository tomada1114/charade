# skia-canvas

skia-canvas is this package's only runtime dependency. It rasterises frames in the
export layer and nothing else imports it. It was chosen over a headless browser, which
is a non-goal, and it is a part that could be swapped without changing what a scene
author writes.

This file is the standing verdict. The pull request that first added the dependency
carried the full review record from the skill body.

## Facts

Checked 2026-11-12 against the npm registry (`npm view skia-canvas@4.0.0`) unless a URL
is given.

- Version 4.0.0, published 2026-10-12, licence MIT, `engines.node` `>=18`.
- Unpacked size about 249 kB for the package itself. The native binary arrives as one of
  eight optional dependencies, `@skia-canvas/<platform>`: macOS, Windows, and Linux with
  glibc or musl, each for x64 and arm64. Linux needs glibc 2.28 or newer
  (<https://skia-canvas.org/getting-started>).
- It has three dependencies of its own: `detect-libc`, `follow-redirects`,
  `https-proxy-agent`.
- It declares no install lifecycle script, and it installed under the unchanged
  `pnpm-workspace.yaml` in a scratch project with pnpm 11.18.0: no `allowBuilds` entry,
  past the release-age cooldown, no trust-policy failure.
- An install that omits optional dependencies has no binary and fails at first use
  (<https://skia-canvas.org/getting-started>).
- On Linux it uses the system fontconfig when `/etc/fonts` exists
  (<https://skia-canvas.org/getting-started>).

## Settled when it was added

Checked 2026-11-12 against the installed 4.0.0 (`node_modules/skia-canvas`), the
registry and the GitHub advisory database, when issue #15 added it.

- `follow-redirects` and `https-proxy-agent` are the HTTP client and proxy agent for two
  paths only. At run time, `lib/urls.js` `fetchURL`, called only from
  `lib/classes/imagery.js` when `loadImage`, `loadImageData` or `loadCanvas` is given an
  `http(s)` URL; this package never calls those. At install time, `lib/prebuild.mjs`,
  run only by the manifest's `download` script, which no package manager runs on its
  own: the manifest declares no `preinstall`, `install`, `postinstall` or `prepare`, and
  the native loader (`lib/classes/neon.js` `loadNative`) never calls it; it throws
  instead. So rasterising makes no network request. `detect-libc` picks the musl or
  glibc binary on Linux at load time.
- Transitive packages: pnpm resolves 18 under `skia-canvas`
  (`pnpm list --prod --depth Infinity`): skia-canvas, eight platform binaries, and
  `detect-libc`, `follow-redirects`, `https-proxy-agent`, `agent-base`,
  `proxy-agent-negotiate`, `debug`, `ms`, `supports-color`, `has-flag`. pnpm
  auto-installs `debug`'s optional peer `supports-color` (and its `has-flag`); npm does
  not. An npm consumer of the packed tarball gets 9 packages besides charade, one of
  them the platform binary, about 28 MB on macOS arm64; the linux-x64-glibc binary
  package is about 38 MB unpacked. Every one is MIT, except `detect-libc`, Apache-2.0.
  None of those installed here declares an install lifecycle script.
- Advisories: `pnpm audit --prod` and `npm install` of the packed tarball report none.
  The GitHub advisory database (`gh api /advisories?ecosystem=npm&affects=<name>`) has
  none for skia-canvas, `detect-libc` or `agent-base`. `follow-redirects` has advisories
  up to `<= 1.16.1` (GHSA-mrwp-f3q8-3g9p has the widest range); skia-canvas's range
  `^1.16.1` still admits 1.16.1, and the lockfile resolves 1.16.2, which none affects.
  `debug`'s advisories stop at 4.4.2; 4.4.3 is resolved.
- Provenance: `npm view <name>@4.0.0 dist.attestations` shows SLSA v1 provenance for
  skia-canvas and all eight `@skia-canvas/<platform>` binaries; skia-canvas's
  attestation names `.github/workflows/publish.yml` in
  `github.com/samizdatco/skia-canvas` at `refs/tags/v4.0.0`. None of the eight binary
  packages declares any script, and each is MIT.
- Continuity: one maintainer on npm (`samizdatco`); 3.0.8 on 2025-09-25, then 4.0.0
  release candidates from 2026-10 and 4.0.0 on 2026-10-12, `latest` and `next`.

## Consequences

- It belongs in `dependencies`, as a range.
- The consumer smoke install fetches it and its binary from the registry, in the
  published-floor job too.
- ffmpeg is not a dependency in any form. The user's ffmpeg on `PATH` is spawned, and no
  package that bundles ffmpeg is added: that would put a GPL binary in the distribution.
