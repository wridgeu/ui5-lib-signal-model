# Repository Overhaul: Documentation, Structure, and CI/CD

Restructure the repository for public consumption. Split the 530-line root README into focused documents, add a library-level README with full consumer documentation, set up CI/CD via GitHub Actions, and clean up internal workflow artifacts.

## Goals

- Root README serves as a landing page: what is this, how do I get started, how do I contribute
- Library README serves npm consumers: install, serve, configure, use, reference
- Architecture internals live in a dedicated doc
- CI runs on every PR (lint, typecheck, test), release automation via release-please
- Clean `docs/` directory with only design specs (no plans, no status tracking)

## Non-Goals

- Changing any library source code or tests
- Adding new features or fixing bugs
- Writing a separate CONTRIBUTING.md (inline in root README instead)

## 1. Root README

~100-120 lines. Follows the same pattern as [ui5-lib-guard-router](https://github.com/wridgeu/ui5-lib-guard-router).

### Structure

```
<shields: npm, npmx, license, UI5 >=1.144, TypeScript strict, CI>

<h1>ui5-lib-signal-model</h1>
<p>One-line description</p>

> CAUTION box (experimental, not production-ready)

## Quick Start
  - Requirements (Node 22, UI5 >= 1.144, signal-polyfill)
  - npm install
  - manifest.json snippet
  - tsconfig.json snippet
  - Minimal 5-line code example
  - Link to packages/lib/README.md for full docs

## Demo
  - npm run start
  - Brief list of 7 demo pages

## Repository Structure
  - packages/lib — the library (published to npm)
  - packages/demo-app — interactive showcase (private)

## Development
  - npm install, npm run start, npm run test:qunit, npm run check, npm run build
  - Commit convention (conventional commits, enforced by commitlint + husky)

## Contributing
  - Contributions welcome, PRs and issues appreciated
  - Code style: oxlint + oxfmt, enforced via pre-commit hooks
  - Link to issue tracker

## License
  - MIT
```

### Shield badges

Match guard-router style, centered paragraph with linked badges:

- npm version: `https://img.shields.io/npm/v/ui5-lib-signal-model.svg`
- npmx: `https://img.shields.io/npm/v/ui5-lib-signal-model?label=npmx.dev&color=0a0a0a`
- License: MIT badge
- OpenUI5: `1.144.0` green badge
- TypeScript: `strict` blue badge
- CI: `https://img.shields.io/github/actions/workflow/status/wridgeu/ui5-lib-signal-model/ci.yml?branch=main&label=CI`

### Content moved OUT of root README

The following sections move to other files (not deleted, relocated):

| Current root section                                        | Destination                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| Usage (drop-in, typed, declarative binding)                 | `packages/lib/README.md`                                      |
| Computed Signals (all subsections)                          | `packages/lib/README.md`                                      |
| Computed Signal Immutability                                | `packages/lib/README.md`                                      |
| Automatic Resubscription                                    | `packages/lib/README.md`                                      |
| Computed Sub-Path Traversal                                 | `packages/lib/README.md`                                      |
| Computed Re-Evaluation and Sub-Path Notifications           | `packages/lib/README.md`                                      |
| Merge Writes                                                | `packages/lib/README.md`                                      |
| Feature Comparison table                                    | `packages/lib/README.md`                                      |
| Configuration Modes                                         | `packages/lib/README.md`                                      |
| TypeScript Generics                                         | `packages/lib/README.md`                                      |
| API section                                                 | `packages/lib/README.md`                                      |
| Architecture diagram                                        | `docs/architecture.md`                                        |
| Learnings (flush queue, merge, clone, batching, scheduling) | `docs/architecture.md`                                        |
| Performance Benchmark                                       | `packages/lib/README.md` (summary + link to benchmark README) |

## 2. Library README (`packages/lib/README.md`)

Full consumer documentation. This is what npm users see. Structure:

```
## Install
  - npm install ui5-lib-signal-model
  - NOTE box about package size (ships dist/ + src/ for multiple serving options)

### TypeScript
  - Install @openui5/types
  - tsconfig.json types array
  - Import pattern: UI5 module paths

### Serving the library
  #### Option A: Pre-built (recommended)
    - Build manifest auto-discovery by UI5 Tooling v4+
    - No extra config needed

  #### Option B: Transpile from source
    - Install ui5-tooling-transpile
    - ui5.yaml customMiddleware config with transpileDependencies: true

  #### Option C: Static serving (workaround)
    - Install ui5-middleware-servestatic
    - ui5.yaml config pointing to node_modules/.../dist/resources

## Setup
  - manifest.json dependency snippet
  - Minimal code example

## Usage
  - Drop-in replacement for JSONModel
  - Typed model with generics
  - Declarative binding (XML view examples: property, list, tree, named model, expression)

## Computed Signals
  - createComputed / removeComputed API
  - Computed Signal Immutability (define-once, removeComputed + createComputed)
  - Automatic Resubscription (watcher bridge on redefinition)
  - Sub-Path Traversal (binding into computed return values)
  - Re-Evaluation and Sub-Path Notifications
    - Why Computed Signals Are Atomic (TC39 spec, SolidJS/Angular/Preact comparison)
    - Signals vs Proxy-Based Reactivity (comparison table)
    - Notification Cost (O(N) check, O(k) DOM update)
    - Dependency Granularity (replace vs in-place)

## Configuration
  - autoCreatePaths / strictLeafCheck table (with path diagram)
  - Merge Writes (mergeProperty, setData merge)

## API Reference
  - Constructor signatures (data + URL)
  - JSONModel-compatible methods
  - Extended methods (mergeProperty, createComputed, removeComputed, getSignal)
  - Binding classes table

## Feature Comparison: SignalModel vs JSONModel
  - Full comparison table
  - Algorithmic complexity legend

## TypeScript Generics
  - ModelPath<T> and PathValue<T, P> explanation

## Benchmark
  - Brief summary (1-2 paragraphs with key numbers)
  - Link to packages/lib/test/benchmark/README.md for full analysis
```

## 3. Architecture Document (`docs/architecture.md`)

Extracted from the current root README "Architecture" and "Learnings" sections.

```
# Architecture

## Overview
  - Architecture diagram (XML bindings → Binding classes → Signal Registry → SignalModel)
  - Signal registry (two Maps: state + computed)
  - Custom equality (primitives: Object.is, objects: always notify)

## Unified Microtask Flush Queue
  - One microtask per synchronous block
  - Map-based deduplication
  - Watcher re-arm protocol

## In-Place Merge
  - Eliminating deepExtend
  - O(k) payload walk vs O(n) deep clone
  - structuredClone for incoming values

## structuredClone over deepExtend
  - Native C++ implementation vs JS recursive clone
  - Used in SignalListBinding.update()

## Batching and bAsyncUpdate
  - Default: signal notifications + microtask flush
  - bAsyncUpdate=true: deferred setTimeout, matches JSONModel behavior

## Microtask vs Macrotask Scheduling
  - Event loop ordering: JS → microtasks → paint → macrotasks
  - Default path: no stale frames
  - bAsyncUpdate path: matches JSONModel's setTimeout behavior
```

## 4. Specs Cleanup

### Delete entirely

- `docs/superpowers/` — entire directory (plans and specs moved to `docs/plans/` and `docs/specs/`)

### Keep

- `docs/plans/` — stays as the plans directory; existing plan content from `docs/superpowers/plans/` moves here

### Flatten and clean specs

Move to `docs/specs/` with status tracking and issue references removed:

| Source                                                                    | Destination                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `docs/specs/2026-04-01-signal-model-design.md`                            | `docs/specs/2026-04-01-signal-model-design.md` (clean up)                |
| `docs/superpowers/specs/2026-04-05-bench-stable-multi-run-design.md`      | `docs/specs/2026-04-05-bench-stable-multi-run-design.md` (clean up)      |
| `docs/superpowers/specs/2026-04-05-oxlint-stricter-type-safety-design.md` | `docs/specs/2026-04-05-oxlint-stricter-type-safety-design.md` (clean up) |
| `docs/superpowers/specs/2026-04-05-repo-overhaul-design.md`               | `docs/specs/2026-04-05-repo-overhaul-design.md` (this spec)              |

Cleaning means:

- Remove any `**Issue:**` or `**Status:**` lines
- Remove any frontmatter with status/tracking fields
- Keep the technical content as a clean design record

### .gitignore update

The current `.gitignore` has `docs/plans/`. After cleanup:

- Keep `docs/plans/` in `.gitignore` (plans are working documents, not committed)
- Add `docs/superpowers/` to `.gitignore` (superpowers tooling may regenerate files there)

## 5. CI/CD (per issue #5)

### `.github/workflows/ci.yml`

Runs on PRs targeting `main` and pushes to `main`. Manually dispatchable.

Steps: checkout → setup-node 22 → npm ci → fmt:check → lint → typecheck → test:qunit

Action SHAs (from issue #5, verify at implementation time):

- `actions/checkout` v4.2.2: `11bd71901bbe5b1630ceea73d27597364c9af683`
- `actions/setup-node` v4.4.0: `49933ea5288caeca8642d1e84afbd3f7d6820020`

### `.github/workflows/release.yml`

Runs on pushes to `main` (after CI). Two jobs:

1. **release-please** — creates/updates release PR from conventional commits
2. **publish** — if release created, builds and publishes to npm with OIDC provenance

Action SHAs:

- `googleapis/release-please-action` v4.4.0: `16a9c90856f42705d54a6fda1823352bdc62cf38`

Permissions: `contents: write`, `pull-requests: write`, `id-token: write`

### Release-please configuration

`release-please-config.json`:

- Package: `packages/lib` → `ui5-lib-signal-model`
- Release type: `node`
- `bump-minor-pre-major: true`
- `bump-patch-for-minor-pre-major: true`

`.release-please-manifest.json`:

- `"packages/lib": "0.1.0"`

### npm environment (manual, post-PR)

Not part of this PR — requires manual GitHub repo settings:

1. Create `npm` environment in repo Settings
2. Add `NPM_TOKEN` secret
3. Optionally link npm package for OIDC trust

## 6. PR and Issue Linking

- Create a feature branch for this work
- PR references issue #5
- PR title: `chore: repository overhaul — docs, structure, CI/CD (#5)`

## Implementation Order

1. Create feature branch
2. Clean up `docs/` (delete plans, flatten specs)
3. Create `docs/architecture.md` (extract from root README)
4. Create `packages/lib/README.md` (move consumer docs from root + add serving options)
5. Rewrite root README (slim landing page with shields)
6. Add CI/CD workflows and release-please config
7. Update `.gitignore`
8. Verify: all links between docs resolve, no broken references
9. Open PR linked to issue #5
