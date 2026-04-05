<p align="center">
  <a href="https://www.npmjs.com/package/ui5-lib-signal-model"><img src="https://img.shields.io/npm/v/ui5-lib-signal-model.svg" alt="npm"></a>
  <a href="https://npmx.dev/package/ui5-lib-signal-model"><img src="https://img.shields.io/npm/v/ui5-lib-signal-model?label=npmx.dev&color=0a0a0a" alt="npmx"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
  <a href="https://openui5.org/"><img src="https://img.shields.io/badge/OpenUI5-1.144.0-green.svg" alt="UI5"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="TypeScript"></a>
  <a href="https://github.com/wridgeu/ui5-lib-signal-model/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/wridgeu/ui5-lib-signal-model/ci.yml?branch=main&label=CI" alt="CI"></a>
</p>

<h1 align="center">ui5-lib-signal-model</h1>

<p align="center">A reactive, signal-based UI5 model that replaces JSONModel as a drop-in. Uses the <a href="https://github.com/tc39/proposal-signals">TC39 Signals proposal</a> polyfill internally, replacing poll-based <code>checkUpdate()</code> with push-based, path-specific signal notifications.</p>

> [!CAUTION]
> This is an **experimental proof of concept** exploring reactive primitives in the UI5 ecosystem. Treat it as a technical exploration and learning exercise, not a production-ready library.
>
> A minor version may be published to npm so that others can try it out and experiment. This does **not** indicate production readiness. The API surface may change without notice between releases.

## Quick start

### 1. Install

```bash
npm install ui5-lib-signal-model
```

> [!NOTE]
> The npm package ships both `dist/` and `src/` to support multiple serving options (pre-built, transpile-from-source, static serving). See the [library README](packages/lib/README.md#serving-the-library) for details.

For TypeScript, add `"ui5-lib-signal-model"` to `compilerOptions.types` in your `tsconfig.json` (alongside `@openui5/types`).

### 2. Configure manifest.json

```json
{
  "sap.ui5": {
    "dependencies": {
      "libs": {
        "ui5.model.signal": {}
      }
    }
  }
}
```

### 3. Use

```typescript
import SignalModel from "ui5/model/signal/SignalModel";

const model = new SignalModel({ customer: { name: "Alice", age: 28 }, orders: [] });
// Works with standard XML view bindings: {/customer/name}, {/orders}, etc.
```

For the full API reference, usage examples, computed signals, and configuration options, see the **[library documentation](packages/lib/README.md)**.

## Demo

7 interactive showcase pages covering property bindings, list/tree bindings, computed signals, programmatic signal access, strict mode, and a side-by-side comparison. Run with `npm run start`.

## Repository structure

```
packages/
  lib/          ui5.model.signal library (SignalModel + bindings)
  demo-app/     Demo app with 7 showcase pages
docs/           Architecture notes, plans, and specs
scripts/        Benchmark runners and CI helpers
```

## Development

### Prerequisites

- Node.js >= 22
- npm >= 9 (workspaces)

### Install and run

```bash
npm install         # install all dependencies
npm start           # demo app
npm run start:lib   # library dev server
npm run start:bench # benchmark page
```

### Tests

```bash
npm run test:qunit  # QUnit via WDIO + headless Chrome
```

### Quality checks

```bash
npm run typecheck  # TypeScript strict mode
npm run lint       # oxlint
npm run fmt:check  # oxfmt
npm run check      # fmt:check + lint + typecheck
npm run fmt        # auto-format
npm run lint:fix   # auto-fix lint issues
```

### Build

```bash
npm run build  # library → packages/lib/dist/
npm run clean  # remove dist and .ui5 caches
```

### Benchmark

```bash
npm run bench                                    # CLI -- headless
npm run bench -- --bindings 1000 --json out.json  # custom config
npm run bench:stable                              # multi-run stability
```

### Commits

This repo uses [Conventional Commits](https://www.conventionalcommits.org/). [commitlint](https://commitlint.js.org/) and [husky](https://typicode.github.io/husky/) enforce the format. Pre-commit hooks run `oxlint --fix` and `oxfmt` on staged files.

## Contributing

Issues and pull requests are always welcome. If you spot a bug or want to propose an improvement, please [file an issue](https://github.com/niclas-nicoco/ui5-lib-signal-model/issues) or open a PR directly.

## License

[MIT](LICENSE)
