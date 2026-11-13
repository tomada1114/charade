# Project Guide

This file is the source of truth for every agent working in this repository. It holds
what has to be true _before_ you know which task you are on: what this package is, how
to check a change, and which decisions need a human. `CLAUDE.md` only imports it.

Machine-enforceable rules are not written down here. `eslint.config.mjs`,
`tsconfig.json`, `.prettierrc.json`, `vitest.config.ts` and `pnpm-workspace.yaml` are
the source of truth for those, and running the gate is how you learn them. The
conventions of a particular kind of work live in `.claude/rules/` (loaded when a
matching file is opened) and `.claude/skills/` (loaded when the task matches a
description).

Everything an agent needs is in this repository. A cloud session starts with nothing
else — no personal skills, sub-agents or settings — so never rely on one being present.

## Overview

charade is an engine that lets an AI coding agent write a short 2D animation as code: a
stick figure with a face acts out an idea, so the point is carried by the picture rather
than by text. The person asks; the agent writes the scene through an Agent Skill.

The core interaction is a loop: read the vocabulary, write a scene in TypeScript, check
it, look at check images, fix it, render an MP4. An agent cannot see its own output, so
the check-and-look loop is the product. charade competes on the quality of the acting,
the range of what can be expressed, and ease of use; engine internals and render speed
are not the headline.

Non-goals: importing Rive, Lottie, Spine or other external character formats; building
on or forking another animation framework; a headless browser anywhere in the render
path; bundling ffmpeg; narration, text-to-speech, charts and diagrams; a preview editor
or any GUI; narrowing what a scene can express to make the engine simpler to build.

What it is and is not, with the reasons, is `docs/product/requirements.md`.

It ships as an ESM-only TypeScript package published to npm, with one command entry in
`src/cli.ts`; that command is not an import surface. Development and the published floor
are both Node >= 24. pnpm 11 is the package manager, used through Corepack.

## Setup

A fresh checkout (a cloud session included) runs `pnpm install` and then
`pnpm hooks:install` before its first commit. The pre-commit hook is the only layer that
blocks a secret from being committed, and it exists only once it is installed.

## Quick reference

```sh
pnpm check:quick   # format check, lint, typecheck, tests — the everyday gate
pnpm check         # the full gate, including build, docs, and packaging
pnpm fix           # ESLint autofix, then Prettier
pnpm test          # tests only
pnpm test:coverage # tests with the coverage thresholds enforced
pnpm build         # emit dist/ from src/
pnpm package:check # build and pack once, then run every artifact check
pnpm package:smoke # install the tarball into throwaway consumers and run it
pnpm docs:build    # TypeDoc into docs/api/
pnpm repo:labels   # create/update GitHub labels from .github/labels.yml
```

Run a single test file with `pnpm exec vitest run tests/<name>.test.ts`.

`pnpm check:quick` is the full local source gate, and CI runs those source/package
checks as separate steps, so a green run here means those are green too. `lefthook`'s
pre-commit hook runs a staged-file-scoped version of the same tools before every commit.
Nothing — not a hook, not a workflow — defines a check of its own; they all call these
scripts.

Development and source checks stay on Node 24. A generated `node-library` may publish a
different bare `>=N` floor through bootstrap's `--node-engines` option (default `>=24`);
the `package-floor` CI job builds and packs on Node 24, then consumes that artifact with
`pnpm --config.runtime-on-fail=ignore run package:smoke -- --pack-dir .smoke` on the
selected floor. The override is only for that compatibility check. Never relax
`devEngines.runtime`'s `onFail: error` for normal development or source checks.

## Validating a change

Run the narrowest check that can fail, then the gate. Reaching for `pnpm check` on every
edit is slow enough that it stops being run at all.

| What you changed                         | The narrowest check that can fail                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| A module under `src/`                    | `pnpm exec vitest run tests/<module>.test.ts`                                     |
| Anything reachable from `src/index.ts`   | `pnpm check` — only `package:smoke` sees the published `.d.ts` as a consumer does |
| A test                                   | `pnpm exec vitest run tests/<name>.test.ts`                                       |
| A script under `scripts/`                | `pnpm exec vitest run tests/<script>.test.ts`                                     |
| TSDoc comments                           | `pnpm docs:build`                                                                 |
| A skill, rule, or agent under `.claude/` | `pnpm exec vitest run tests/skills-frontmatter.test.ts`, then `pnpm fix`          |
| `package.json`, `pnpm-workspace.yaml`    | `pnpm install`, then `pnpm check`                                                 |
| Markdown                                 | `pnpm fix`                                                                        |

## Architecture

```
src/
├── index.ts      # the public contract: the only module consumers can import
├── cli.ts        # optional command entry; not an import surface
├── internal/     # private; never re-exported from index.ts
└── *.ts          # implementation modules, re-exported by name from index.ts
```

`src/index.ts` is the single consumer-importable entry point of the published contract.
`scripts/*.mjs` is repository automation that never ships.

The engine is built in layers: a directory under `src/` for each, except the CLI, which
is `src/cli.ts`. A pure layer never imports the export layer or the CLI; the export
layer and the CLI may import any pure layer.

| Layer      | Holds                                                               | May touch                  |
| ---------- | ------------------------------------------------------------------- | -------------------------- |
| scene      | the authoring API: `scene`, actors, the `define…` functions         | pure code only             |
| timeline   | the data a scene yields, its JSON form, the seeded random source    | pure code only             |
| rig        | joints, limits, inverse kinematics, pose interpolation              | pure code only             |
| draw       | frame `n` as drawing calls, and this package's drawing interface    | pure code only             |
| check      | findings, the recording context, check-image layout                 | pure code only             |
| vocabulary | built-in actions, expressions, props, backdrops, effects, the index | only what the root exports |
| export     | scene loading, skia-canvas, ffmpeg, files                           | Node builtins and skia     |
| cli        | argument parsing and exit codes                                     | the export layer           |

Pure code imports no `node:` module and no skia-canvas, and reads no clock and no
unseeded random number, so that a browser page can bundle it later without a change to
the published contract. Only the export layer and the CLI are Node-only, and neither is
reachable from the root entry. The boundary is a lint rule by directory in
`eslint.config.mjs`; what that rule cannot see, such as a dynamic `import()`, holds as
this instruction.

These facts hold for every change, because no config can check whether a change was
meant:

- Scene code never draws. It runs once and yields a timeline; the engine draws frame `n`
  as a pure function of that timeline and `n`.
- Built-in vocabulary is written with the same public API a user has. The engine has no
  private back door.

- Adding or removing a line in `src/index.ts`, or an entry in `package.json`'s
  `exports`/`files`, changes the published contract. Decide it deliberately.
- An error's `code` is contract; its `message` is not. Tests and callers match on the
  class and `code`, never the message.
- A public-surface change lands in one pull request with its tests, type tests, README
  example and a `Release impact:` line (`release-impact` owns the semver call).

## Rules, skills and sub-agents

The rules under `.claude/rules/` load once a matching file is opened, which is after a
design is under way: read the rule for each area a change touches before designing it.
`src.md` and `tests.md` cover all source and tests. The engine's design decisions live
in four more, each with its reasoning: `engine.md` (time, space, angles, randomness, the
drawing interface), `checks.md` (what a sample record is), `export.md` (scene loading,
rasterising, encoding and how they are tested), and `vocabulary.md` (how an item reaches
a scene, and what adding a built-in owes). A decision that changes is rewritten there,
in the same change as the code.

Each skill under `.claude/skills/` owns one kind of work; its `description` says when.
Skills are edited in place; `authoring-skills` holds how they are checked.

`.claude/agents/` defines the sub-agent tiers `executor`, `architect`, `scout` and
`worker`. Delegate by naming a tier as `subagent_type`, never with a bare `model`: each
tier file carries its model, effort and instructions, and a bare `model` drops them.
Pick the tier by its `description`. Most work needs no delegation, and a decision that
needs this conversation stays with the main session. Repository prose names tiers by
role only, never a model or an effort level.

## Security and human approval

- **Commit, push, pull request, merge, and publish need a human's go-ahead.** Nothing in
  this repository blocks the dangerous spellings mechanically; this sentence is the
  rule.
- **Standing exceptions.** When the user explicitly asks for one of these skills, that
  request is the go-ahead for the writes the skill exists to make, for that invocation
  only. A skill the model loads on its own, or reads during analysis, authorizes
  nothing.
  - `smart-commit`: commits of the working tree, and pushing them to the current branch
    when asked to push.
  - `create-pr`: pushing the current branch and creating or updating its pull request.
  - `shipping-issues`: the writes its `SKILL.md` lists — issue labels, branches, pushes,
    the pull request, merging it once CI passes, follow-up issues, and removing the
    branches and worktrees it created.

  None of them covers publishing, a release tag, `pnpm repo:labels`, a workflow
  dispatch, or a gate change. A skill that reaches one stops and asks.

- **Never bypass the hooks** — no `--no-verify`, no `LEFTHOOK=0`, no other way of
  turning the pre-commit hook off. It is the only check that stops a secret, and it
  cannot see itself being disabled.
- Never read or write `.env*` (the `.example`, `.sample` and `.template` variants are
  fine) or anything under `secrets/`. Never write a credential into a tracked file.
- Every pull request states whether a release is required; `release-impact` holds the
  two literal forms and the semver call.
- `pnpm-lock.yaml` is generated by `pnpm install`, never hand-edited;
  `managing-dependencies` holds the reasoning.
- Never weaken a gate to make a run pass: no lowered coverage threshold in
  `vitest.config.ts`, no file added to `coverage.exclude` to move a number, no deleted
  security workflow, no removed `--frozen-lockfile`, no removed or relaxed ESLint rule
  or `pnpm-workspace.yaml` supply-chain setting, no `@ts-ignore`, no blanket
  `eslint-disable`, no skipped or deleted test. If a gate is wrong, say so and let a
  human decide.
- A denied command is not re-spelled (`git -C`, `bash -c`, a wrapper). Fix what made the
  workaround look necessary, or ask.

The hook and gate rules stay here rather than in a skill, because the agent they have to
reach is looking at a red run and has classified its task as "make CI green", so no
skill fires. Which layer enforces what, and what none of them sees, is `changing-gates`.

## Conventions

- All committed code, comments, configuration, and public documentation are in English.
- **A comment carries only what the code cannot** — a non-obvious why, a trap the next
  edit would spring, an external constraint. Default to none and keep the rest to a line
  or two. TSDoc on the published surface is a contract and stays.
- Do what was asked; nothing more. Prefer editing an existing file to creating a new
  one, and do not add documentation files that were not requested.
- Note improvements you spot outside the current scope instead of making them.
