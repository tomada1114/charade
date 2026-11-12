# skia-canvas

skia-canvas is this package's only runtime dependency. It rasterises frames in the
export layer and nothing else imports it. It was chosen over a headless browser, which
is a non-goal, and it is a part that could be swapped without changing what a scene
author writes.

This file is the standing verdict. The pull request that first adds the dependency still
carries the full review record from the skill body, and settles the items marked
unchecked below.

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

## Unchecked

- What `follow-redirects` and `https-proxy-agent` are used for. Its manifest has a
  `download` script (`node lib/prebuild.mjs download --or-compile`); whether anything
  runs that path in a normal install, and so whether the package makes a network request
  outside `npm install`, is not established.
- The transitive package count beyond the three direct dependencies.
- Open security advisories and npm provenance for 4.0.0.

## Consequences

- It belongs in `dependencies`, as a range.
- The consumer smoke install fetches it and its binary from the registry, in the
  published-floor job too.
- ffmpeg is not a dependency in any form. The user's ffmpeg on `PATH` is spawned, and no
  package that bundles ffmpeg is added: that would put a GPL binary in the distribution.
