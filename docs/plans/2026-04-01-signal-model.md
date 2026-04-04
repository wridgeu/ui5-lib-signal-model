# SignalModel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reactive, signal-based UI5 model (`SignalModel`) that is a drop-in replacement for JSONModel, using the TC39 Signals polyfill (`signal-polyfill`) to replace poll-based `checkUpdate()` with direct path-specific notifications.

**Architecture:** SignalModel extends `ClientModel` and maintains a `SignalRegistry` (`Map<string, Signal.State | Signal.Computed>`) alongside the raw `this.oData` object. Property and list bindings subscribe to their path's signal via `Signal.subtle.Watcher`. When `setProperty` is called, it updates `oData` then sets the corresponding signal, notifying only subscribed bindings. `checkUpdate()` is overridden to be a no-op for normal changes.

**Tech Stack:** TypeScript ~6.0, OpenUI5 1.144.0+, signal-polyfill, ui5-tooling-transpile, QUnit + WebdriverIO, Oxlint + Oxfmt

**Spec:** `docs/specs/2026-04-01-signal-model-design.md`

---

## File Structure

```
ui5-lib-signal-model/
  package.json                              # monorepo root, workspaces
  tsconfig.base.json                        # shared TS config
  .oxlintrc.json                            # linting
  .oxfmtrc.json                             # formatting
  commitlint.config.mjs                     # commit lint
  .husky/pre-commit                         # git hook
  .gitignore
  scripts/run-with-server.mjs               # test runner helper

  packages/
    lib/
      package.json                          # "ui5-lib-signal-model"
      tsconfig.json                         # lib TS config
      tsconfig.test.json                    # test TS config
      ui5.yaml                              # UI5 tooling config
      src/
        .library                            # UI5 library descriptor (XML)
        manifest.json                       # UI5 library manifest
        library.ts                          # library entry point
        types.ts                            # path utility types, options
        SignalRegistry.ts                   # Map<path, Signal>, lazy creation
        SignalModel.ts                      # extends ClientModel
        SignalPropertyBinding.ts            # extends ClientPropertyBinding
        SignalListBinding.ts                # extends ClientListBinding
      test/
        qunit/
          testsuite.qunit.html             # QUnit test runner page
          SignalRegistry.qunit.ts           # registry unit tests
          SignalModel.qunit.ts              # model core tests
          SignalPropertyBinding.qunit.ts    # property binding tests
          SignalListBinding.qunit.ts        # list binding tests
          ComputedSignals.qunit.ts          # computed signal tests
          MergeProperty.qunit.ts            # mergeProperty tests
          StrictMode.qunit.ts              # strict mode tests
        wdio-qunit.conf.ts                 # WebdriverIO QUnit config

    demo-app/
      package.json                          # "ui5-lib-signal-model-demo"
      tsconfig.json                         # demo TS config
      ui5.yaml                              # UI5 serve config
      webapp/
        manifest.json                       # app manifest
        index.html                          # app entry point
        Component.ts                        # app component
        model/
          sampleData.ts                     # shared sample data
        controller/
          PropertyBinding.controller.ts     # property binding demo
          ListBinding.controller.ts         # list binding demo
          ComputedSignals.controller.ts     # computed signals demo
          ProgrammaticAccess.controller.ts  # getSignal() demo
          StrictMode.controller.ts          # strict mode demo
          Comparison.controller.ts          # JSONModel vs SignalModel
        view/
          App.view.xml                      # shell + navigation
          PropertyBinding.view.xml
          ListBinding.view.xml
          ComputedSignals.view.xml
          ProgrammaticAccess.view.xml
          StrictMode.view.xml
          Comparison.view.xml

  README.md                                 # feature comparison with JSONModel
```

---

### Task 1: Initialize Monorepo

**Files:**

- Create: `ui5-lib-signal-model/package.json`
- Create: `ui5-lib-signal-model/tsconfig.base.json`
- Create: `ui5-lib-signal-model/.oxlintrc.json`
- Create: `ui5-lib-signal-model/.oxfmtrc.json`
- Create: `ui5-lib-signal-model/commitlint.config.mjs`
- Create: `ui5-lib-signal-model/.husky/pre-commit`
- Create: `ui5-lib-signal-model/.gitignore`

- [ ] **Step 1: Create project directory and initialize git**

```bash
mkdir -p C:/Users/m.beier/Documents/dev/ui5-lib-signal-model
cd C:/Users/m.beier/Documents/dev/ui5-lib-signal-model
git init
```

- [ ] **Step 2: Create root package.json**

Create `package.json`:

```json
{
  "name": "ui5-lib-signal-model-monorepo",
  "private": true,
  "author": "Marco Beier",
  "repository": {
    "type": "git",
    "url": "https://github.com/wridgeu/ui5-lib-signal-model.git"
  },
  "engines": {
    "node": ">=22"
  },
  "workspaces": ["packages/*"],
  "scripts": {
    "clean": "npm run clean --workspaces",
    "fmt": "oxfmt .",
    "fmt:check": "oxfmt --check .",
    "lint": "oxlint packages/ scripts/ --tsconfig tsconfig.base.json --import-plugin --deny-warnings",
    "lint:fix": "oxlint packages/ scripts/ --tsconfig tsconfig.base.json --import-plugin --fix",
    "check": "npm run fmt:check && npm run lint && npm run typecheck",
    "typecheck": "tsc --noEmit -p packages/lib/tsconfig.json && tsc --noEmit -p packages/lib/tsconfig.test.json && tsc --noEmit -p packages/demo-app/tsconfig.json",
    "build": "npm run build --workspace=packages/lib",
    "start": "npm start --workspace=packages/demo-app",
    "start:lib": "npm start --workspace=packages/lib",
    "serve:demo": "npm run serve --workspace=packages/demo-app",
    "serve:demo:test": "npm run serve --workspace=packages/demo-app -- --port 8081",
    "wdio:qunit": "wdio run packages/lib/test/wdio-qunit.conf.ts",
    "test": "npm run test:qunit",
    "test:qunit": "node ./scripts/run-with-server.mjs --ready-url http://localhost:8080 --server-script start:lib --test-script wdio:qunit",
    "commitlint": "commitlint --last",
    "prepare": "husky"
  },
  "lint-staged": {
    "{packages,scripts}/**/*.{ts,js,mjs}": [
      "oxlint --fix --tsconfig tsconfig.base.json --import-plugin --deny-warnings",
      "oxfmt"
    ],
    "*.{json,md,yaml,yml}": "oxfmt"
  },
  "devDependencies": {
    "@commitlint/cli": "^20.1.0",
    "@commitlint/config-conventional": "^20.0.0",
    "@openui5/types": "^1.144.0",
    "@types/mocha": "^10.0.0",
    "@wdio/cli": "^9.0.0",
    "@wdio/local-runner": "^9.0.0",
    "@wdio/mocha-framework": "^9.0.0",
    "@wdio/spec-reporter": "^9.0.0",
    "husky": "^9.1.7",
    "lint-staged": "^16.2.7",
    "oxfmt": "^0.41.0",
    "oxlint": "^1.56.0",
    "rimraf": "^6.0.0",
    "typescript": "~6.0.0",
    "wdio-qunit-service": "^2.0.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "strictNullChecks": true,
    "strictPropertyInitialization": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "rootDir": ".",
    "composite": true
  }
}
```

- [ ] **Step 4: Create .oxlintrc.json**

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "categories": {
    "correctness": "error",
    "suspicious": "warn",
    "perf": "warn"
  },
  "plugins": ["typescript", "oxc", "unicorn", "import"],
  "rules": {
    "no-console": "off",
    "no-await-in-loop": "off",
    "import/no-unassigned-import": "off",
    "unicorn/no-null": "off",
    "unicorn/prefer-event-target": "off",
    "unicorn/prefer-top-level-await": "off",
    "unicorn/no-static-only-class": "off",
    "unicorn/prefer-global-this": "off",
    "unicorn/consistent-function-scoping": "off",
    "typescript/no-unsafe-function-type": "error"
  },
  "overrides": [
    {
      "files": ["packages/*/test/**/*.ts"],
      "rules": {}
    }
  ],
  "ignorePatterns": ["**/dist/**", "**/node_modules/**"]
}
```

- [ ] **Step 5: Create .oxfmtrc.json**

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "trailingComma": "all",
  "experimentalSortPackageJson": false,
  "ignorePatterns": ["**/dist/**", "**/node_modules/**", "**/.claude/**", "**/CHANGELOG.md"]
}
```

- [ ] **Step 6: Create commitlint.config.mjs**

```javascript
export default {
  extends: ["@commitlint/config-conventional"],
};
```

- [ ] **Step 7: Create .husky/pre-commit**

```bash
mkdir -p .husky
```

Create `.husky/pre-commit`:

```shell
#!/bin/sh
npx lint-staged
```

- [ ] **Step 8: Create .gitignore**

```
node_modules/
dist/
.ui5/
*.js.map
```

- [ ] **Step 9: Create test runner script**

Create `scripts/run-with-server.mjs`:

```javascript
import { spawn } from "node:child_process";

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const readyUrl = getArg("--ready-url") || "http://localhost:8080";
const serverScript = getArg("--server-script") || "start:lib";
const testScript = getArg("--test-script") || "wdio:qunit";
const testBaseUrl = getArg("--test-base-url");

async function waitForServer(url, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server not ready at ${url} after ${maxAttempts}s`);
}

const server = spawn("npm", ["run", serverScript], {
  stdio: "pipe",
  shell: true,
});

server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);

try {
  await waitForServer(readyUrl);

  const testArgs = ["run", testScript];
  if (testBaseUrl) {
    testArgs.push("--", `--baseUrl=${testBaseUrl}`);
  }

  const test = spawn("npm", testArgs, {
    stdio: "inherit",
    shell: true,
  });

  const code = await new Promise((resolve) => test.on("close", resolve));
  process.exitCode = code;
} finally {
  server.kill();
}
```

- [ ] **Step 10: Commit scaffolding**

```bash
git add -A
git commit -m "chore: initialize monorepo scaffolding"
```

Note: Do NOT run `npm install` yet -- the workspace packages don't exist.

---

### Task 2: Library Package Setup

**Files:**

- Create: `packages/lib/package.json`
- Create: `packages/lib/tsconfig.json`
- Create: `packages/lib/tsconfig.test.json`
- Create: `packages/lib/ui5.yaml`
- Create: `packages/lib/src/.library`
- Create: `packages/lib/src/manifest.json`
- Create: `packages/lib/src/library.ts`

- [ ] **Step 1: Create lib package.json**

```bash
mkdir -p packages/lib/src packages/lib/test/qunit
```

Create `packages/lib/package.json`:

```json
{
  "name": "ui5-lib-signal-model",
  "version": "0.1.0",
  "license": "MIT",
  "main": "dist/resources/ui5/model/signal/library.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/resources/ui5/model/signal/library.js"
    }
  },
  "author": "Marco Beier",
  "repository": {
    "type": "git",
    "url": "https://github.com/wridgeu/ui5-lib-signal-model.git",
    "directory": "packages/lib"
  },
  "description": "Signal-based reactive UI5 model using TC39 Signals polyfill",
  "keywords": ["ui5", "openui5", "sapui5", "signals", "reactive", "model", "tc39"],
  "publishConfig": {
    "access": "public"
  },
  "type": "module",
  "files": ["dist/**/*", "src/**/*", "ui5.yaml", "tsconfig.json", "README.md", "LICENSE"],
  "scripts": {
    "clean": "rimraf dist .ui5",
    "build": "ui5 build --create-build-manifest",
    "prepublishOnly": "npm run build",
    "start": "ui5 serve",
    "test": "echo \"Run tests from monorepo root: npm run test:qunit\" && exit 1",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "signal-polyfill": "^0.2.2"
  },
  "devDependencies": {
    "@types/qunit": "^2.19.13",
    "@ui5/cli": "^4.0.0",
    "ui5-tooling-transpile": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create lib tsconfig.json**

Create `packages/lib/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "paths": {
      "ui5/model/signal/*": ["./src/*"]
    },
    "types": ["@openui5/types"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create lib tsconfig.test.json**

Create `packages/lib/tsconfig.test.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "../..",
    "paths": {
      "ui5/model/signal/*": ["./src/*"]
    },
    "types": ["@openui5/types", "@types/qunit"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 4: Create ui5.yaml**

Create `packages/lib/ui5.yaml`:

```yaml
specVersion: "4.0"
metadata:
  name: ui5.model.signal
type: library
framework:
  name: OpenUI5
  version: "1.144.0"
  libraries:
    - name: sap.ui.core
builder:
  resources:
    excludes:
      - "/test-resources/**"
  customTasks:
    - name: ui5-tooling-transpile-task
      afterTask: replaceVersion
      configuration:
        omitTSFromBuildResult: true
        transformModulesToUI5: true
server:
  customMiddleware:
    - name: ui5-tooling-transpile-middleware
      afterMiddleware: compression
      configuration:
        transformModulesToUI5: true
```

- [ ] **Step 5: Create .library**

Create `packages/lib/src/.library`:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<library xmlns="http://www.sap.com/sap.ui.library.xsd">
	<name>ui5.model.signal</name>
	<vendor>Marco</vendor>
	<version>${version}</version>
	<copyright></copyright>
	<title>Signal-based reactive UI5 model</title>
	<documentation>Drop-in replacement for JSONModel using TC39 Signals for push-based reactivity.</documentation>
	<dependencies>
		<dependency>
			<libraryName>sap.ui.core</libraryName>
		</dependency>
	</dependencies>
</library>
```

- [ ] **Step 6: Create manifest.json**

Create `packages/lib/src/manifest.json`:

```json
{
  "_version": "2.0.0",
  "sap.app": {
    "id": "ui5.model.signal",
    "type": "library",
    "applicationVersion": {
      "version": "0.1.0"
    },
    "title": "Signal-based reactive UI5 model",
    "description": "Drop-in replacement for JSONModel using TC39 Signals for push-based reactivity."
  },
  "sap.ui": {
    "technology": "UI5",
    "deviceTypes": {
      "desktop": true,
      "tablet": true,
      "phone": true
    }
  },
  "sap.ui5": {
    "contentDensities": {
      "compact": true,
      "cozy": true
    },
    "dependencies": {
      "minUI5Version": "1.144.0",
      "libs": {
        "sap.ui.core": {}
      }
    }
  }
}
```

- [ ] **Step 7: Create library.ts entry point**

Create `packages/lib/src/library.ts`:

```typescript
import Lib from "sap/ui/core/Lib";
import "sap/ui/core/library";

const library = Lib.init({
  apiVersion: 2,
  name: "ui5.model.signal",
  version: "${version}",
  dependencies: ["sap.ui.core"],
  types: [],
  interfaces: [],
  controls: [],
  elements: [],
  noLibraryCSS: true,
});

export default library;
```

- [ ] **Step 8: Install dependencies and verify build**

```bash
cd C:/Users/m.beier/Documents/dev/ui5-lib-signal-model
npm install
cd packages/lib && npx ui5 serve &
# Wait for server, then check http://localhost:8080/resources/ui5/model/signal/library.js loads
```

Expected: UI5 dev server starts and the library module is resolvable.

- [ ] **Step 9: Commit**

```bash
git add packages/lib
git commit -m "chore: scaffold library package with UI5 tooling"
```

---

### Task 3: QUnit Test Infrastructure

**Files:**

- Create: `packages/lib/test/qunit/testsuite.qunit.html`
- Create: `packages/lib/test/wdio-qunit.conf.ts`

- [ ] **Step 1: Create QUnit test runner HTML**

Create `packages/lib/test/qunit/testsuite.qunit.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>QUnit Tests - ui5-lib-signal-model</title>
    <script
      id="sap-ui-bootstrap"
      src="/resources/sap-ui-core.js"
      data-sap-ui-theme="sap_horizon"
      data-sap-ui-async="true"
      data-sap-ui-resource-roots='{
			"ui5/model/signal": "/resources/ui5/model/signal/",
			"test": "/test-resources/ui5/model/signal/qunit/"
		}'
    ></script>
    <link rel="stylesheet" href="/resources/sap/ui/thirdparty/qunit-2.css" />
    <script src="/resources/sap/ui/thirdparty/qunit-2.js"></script>
    <script>
      QUnit.config.autostart = false;
      sap.ui.require(["test/SignalRegistry.qunit"], function () {
        QUnit.start();
      });
    </script>
  </head>
  <body>
    <div id="qunit"></div>
    <div id="qunit-fixture"></div>
  </body>
</html>
```

Note: Additional test modules will be added to the `sap.ui.require` array as they are created in later tasks.

- [ ] **Step 2: Create WebdriverIO QUnit config**

Create `packages/lib/test/wdio-qunit.conf.ts`:

```typescript
export const config = {
  runner: "local",
  specs: [],
  capabilities: [
    {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless"],
      },
    },
  ],
  services: [
    [
      "qunit",
      {
        paths: ["/test-resources/ui5/model/signal/qunit/testsuite.qunit.html"],
      },
    ],
  ],
  reporters: ["spec"],
  baseUrl: process.env["TEST_BASE_URL"] || "http://localhost:8080",
};
```

- [ ] **Step 3: Create a smoke test to verify the infrastructure**

Create `packages/lib/test/qunit/SignalRegistry.qunit.ts`:

```typescript
QUnit.module("SignalRegistry - smoke test", () => {
  QUnit.test("test infrastructure works", (assert) => {
    assert.ok(true, "QUnit is loaded and running");
  });
});
```

- [ ] **Step 4: Run smoke test manually**

```bash
# Terminal 1: start the UI5 dev server
cd C:/Users/m.beier/Documents/dev/ui5-lib-signal-model
npm run start:lib

# Terminal 2: open the test page in browser
# Navigate to: http://localhost:8080/test-resources/ui5/model/signal/qunit/testsuite.qunit.html
```

Expected: QUnit shows 1 passing test "test infrastructure works".

- [ ] **Step 5: Commit**

```bash
git add packages/lib/test
git commit -m "chore: set up QUnit test infrastructure"
```

---

### Task 4: TypeScript Path Types

**Files:**

- Create: `packages/lib/src/types.ts`

- [ ] **Step 1: Create types.ts with path utility types and model options**

Create `packages/lib/src/types.ts`:

```typescript
/**
 * Recursively builds "/" separated path strings from an object type.
 * Handles nested objects and arrays with numeric indices.
 */
type PathImpl<T, Key extends keyof T> = Key extends string | number
  ? T[Key] extends Record<string, unknown>
    ? `${Key}` | `${Key}/${PathImpl<T[Key], Exclude<keyof T[Key], keyof unknown[]>>}`
    : T[Key] extends Array<infer U>
      ?
          | `${Key}`
          | `${Key}/${number}`
          | (U extends Record<string, unknown>
              ? `${Key}/${number}/${PathImpl<U, Exclude<keyof U, keyof unknown[]>>}`
              : never)
      : `${Key}`
  : never;

/**
 * All valid absolute paths for a data type T.
 * Paths start with "/" and use "/" as separator: "/customer/name"
 */
export type ModelPath<T> =
  | "/"
  | (T extends object ? `/${PathImpl<T, Exclude<keyof T, keyof unknown[]>>}` : never);

/**
 * Resolves the value type at a given path P within type T.
 */
export type PathValue<T, P extends string> = P extends "/"
  ? T
  : P extends `/${infer Rest}`
    ? PathValueImpl<T, Rest>
    : never;

type PathValueImpl<T, P extends string> = P extends `${infer Key}/${infer Rest}`
  ? Key extends keyof T
    ? PathValueImpl<T[Key], Rest>
    : Key extends `${number}`
      ? T extends Array<infer U>
        ? PathValueImpl<U, Rest>
        : never
      : never
  : P extends keyof T
    ? T[P]
    : P extends `${number}`
      ? T extends Array<infer U>
        ? U
        : never
      : never;

/**
 * Options for the SignalModel constructor.
 */
export interface SignalModelOptions {
  /** When true, setProperty on nonexistent paths throws TypeError. Default: false. */
  strict?: boolean;
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd C:/Users/m.beier/Documents/dev/ui5-lib-signal-model
npx tsc --noEmit -p packages/lib/tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/lib/src/types.ts
git commit -m "feat: add TypeScript path utility types and model options"
```

---

### Task 5: SignalRegistry

**Files:**

- Create: `packages/lib/src/SignalRegistry.ts`
- Modify: `packages/lib/test/qunit/SignalRegistry.qunit.ts`

- [ ] **Step 1: Write SignalRegistry tests**

Replace `packages/lib/test/qunit/SignalRegistry.qunit.ts`:

```typescript
import { Signal } from "signal-polyfill";
import SignalRegistry from "ui5/model/signal/SignalRegistry";

QUnit.module("SignalRegistry", () => {
  QUnit.test("getOrCreate creates a Signal.State with initial value", (assert) => {
    const registry = new SignalRegistry();
    const signal = registry.getOrCreate("/name", "Alice");

    assert.ok(signal, "signal is created");
    assert.strictEqual(signal.get(), "Alice", "initial value is 'Alice'");

    registry.destroy();
  });

  QUnit.test("getOrCreate returns same signal for same path", (assert) => {
    const registry = new SignalRegistry();
    const signal1 = registry.getOrCreate("/name", "Alice");
    const signal2 = registry.getOrCreate("/name", "Bob");

    assert.strictEqual(signal1, signal2, "same instance returned");
    assert.strictEqual(signal1.get(), "Alice", "initial value preserved");

    registry.destroy();
  });

  QUnit.test("get returns undefined for unknown path", (assert) => {
    const registry = new SignalRegistry();

    assert.strictEqual(registry.get("/unknown"), undefined, "undefined for unknown");

    registry.destroy();
  });

  QUnit.test("has returns false for unknown, true for known path", (assert) => {
    const registry = new SignalRegistry();
    assert.notOk(registry.has("/name"), "false before creation");

    registry.getOrCreate("/name", "Alice");
    assert.ok(registry.has("/name"), "true after creation");

    registry.destroy();
  });

  QUnit.test("set updates existing signal value", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/name", "Alice");

    registry.set("/name", "Bob");
    const signal = registry.get("/name") as Signal.State<unknown>;
    assert.strictEqual(signal.get(), "Bob", "value updated to Bob");

    registry.destroy();
  });

  QUnit.test("set is a no-op for unknown path", (assert) => {
    const registry = new SignalRegistry();

    registry.set("/unknown", "value");
    assert.strictEqual(registry.get("/unknown"), undefined, "no signal created");

    registry.destroy();
  });

  QUnit.test("invalidateChildren re-evaluates all child path signals", (assert) => {
    const registry = new SignalRegistry();
    const data = { name: "Alice", age: 28 };

    registry.getOrCreate("/customer/name", "Alice");
    registry.getOrCreate("/customer/age", 28);
    registry.getOrCreate("/orders", []);

    registry.invalidateChildren("/customer", (path: string) => {
      if (path === "/customer/name") return "Bob";
      if (path === "/customer/age") return 30;
      return undefined;
    });

    const nameSignal = registry.get("/customer/name") as Signal.State<unknown>;
    const ageSignal = registry.get("/customer/age") as Signal.State<unknown>;
    const ordersSignal = registry.get("/orders") as Signal.State<unknown>;

    assert.strictEqual(nameSignal.get(), "Bob", "child name updated");
    assert.strictEqual(ageSignal.get(), 30, "child age updated");
    assert.deepEqual(ordersSignal.get(), [], "orders untouched");

    registry.destroy();
  });

  QUnit.test("invalidateAll re-evaluates every signal", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/a", 1);
    registry.getOrCreate("/b", 2);

    registry.invalidateAll((path: string) => {
      if (path === "/a") return 10;
      if (path === "/b") return 20;
      return undefined;
    });

    assert.strictEqual((registry.get("/a") as Signal.State<unknown>).get(), 10, "a updated");
    assert.strictEqual((registry.get("/b") as Signal.State<unknown>).get(), 20, "b updated");

    registry.destroy();
  });

  QUnit.test("addComputed creates a computed signal", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/firstName", "Alice");
    registry.getOrCreate("/lastName", "Smith");

    const computed = registry.addComputed(
      "/fullName",
      ["/firstName", "/lastName"],
      (first, last) => {
        return `${first} ${last}`;
      },
    );

    assert.strictEqual(computed.get(), "Alice Smith", "computed value is correct");
    assert.ok(registry.isComputed("/fullName"), "path is marked as computed");

    registry.destroy();
  });

  QUnit.test("addComputed on raw data path throws", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/name", "Alice");

    assert.throws(
      () => registry.addComputed("/name", [], () => "x"),
      TypeError,
      "throws TypeError when path has raw data",
    );

    registry.destroy();
  });

  QUnit.test("addComputed on existing computed replaces it", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/a", 1);

    registry.addComputed("/sum", ["/a"], (a) => (a as number) + 10);
    assert.strictEqual(
      (registry.get("/sum") as Signal.Computed<unknown>).get(),
      11,
      "first computed",
    );

    registry.addComputed("/sum", ["/a"], (a) => (a as number) + 20);
    assert.strictEqual(
      (registry.get("/sum") as Signal.Computed<unknown>).get(),
      21,
      "replaced computed",
    );

    registry.destroy();
  });

  QUnit.test("removeComputed removes a computed signal", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/a", 1);
    registry.addComputed("/sum", ["/a"], (a) => (a as number) + 10);

    registry.removeComputed("/sum");
    assert.notOk(registry.has("/sum"), "computed removed");
    assert.notOk(registry.isComputed("/sum"), "no longer computed");

    registry.destroy();
  });

  QUnit.test("destroy clears all signals", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/a", 1);
    registry.getOrCreate("/b", 2);

    registry.destroy();
    assert.notOk(registry.has("/a"), "a removed");
    assert.notOk(registry.has("/b"), "b removed");
  });
});
```

- [ ] **Step 2: Run tests -- verify they fail**

Start `npm run start:lib` and open the test page. Expected: tests fail because `SignalRegistry` doesn't exist yet.

- [ ] **Step 3: Implement SignalRegistry**

Create `packages/lib/src/SignalRegistry.ts`:

```typescript
import { Signal } from "signal-polyfill";

type ValueResolver = (path: string) => unknown;

export default class SignalRegistry {
  private readonly signals = new Map<string, Signal.State<unknown>>();
  private readonly computeds = new Map<string, Signal.Computed<unknown>>();

  getOrCreate(path: string, initialValue: unknown): Signal.State<unknown> {
    let signal = this.signals.get(path);
    if (!signal) {
      signal = new Signal.State(initialValue);
      this.signals.set(path, signal);
    }
    return signal;
  }

  get(path: string): Signal.State<unknown> | Signal.Computed<unknown> | undefined {
    return this.computeds.get(path) ?? this.signals.get(path);
  }

  has(path: string): boolean {
    return this.signals.has(path) || this.computeds.has(path);
  }

  set(path: string, value: unknown): void {
    const signal = this.signals.get(path);
    if (signal) {
      signal.set(value);
    }
  }

  invalidateChildren(parentPath: string, resolver: ValueResolver): void {
    const prefix = parentPath.endsWith("/") ? parentPath : `${parentPath}/`;
    for (const [path, signal] of this.signals) {
      if (path.startsWith(prefix)) {
        signal.set(resolver(path));
      }
    }
  }

  invalidateAll(resolver: ValueResolver): void {
    for (const [path, signal] of this.signals) {
      signal.set(resolver(path));
    }
  }

  addComputed(
    path: string,
    deps: string[],
    fn: (...args: unknown[]) => unknown,
  ): Signal.Computed<unknown> {
    if (this.signals.has(path)) {
      throw new TypeError(
        `Cannot create computed signal at "${path}": path already holds raw data`,
      );
    }

    const existing = this.computeds.get(path);
    if (existing) {
      this.computeds.delete(path);
    }

    const computed = new Signal.Computed(() => {
      const values = deps.map((dep) => {
        const s = this.get(dep);
        return s ? s.get() : undefined;
      });
      return fn(...values);
    });

    this.computeds.set(path, computed);
    return computed;
  }

  removeComputed(path: string): void {
    this.computeds.delete(path);
  }

  isComputed(path: string): boolean {
    return this.computeds.has(path);
  }

  destroy(): void {
    this.signals.clear();
    this.computeds.clear();
  }
}
```

- [ ] **Step 4: Run tests -- verify they pass**

Reload the test page. Expected: all SignalRegistry tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/lib/src/SignalRegistry.ts packages/lib/test/qunit/SignalRegistry.qunit.ts
git commit -m "feat: implement SignalRegistry with lazy signal creation and computed support"
```

---

### Task 6: SignalPropertyBinding

**Files:**

- Create: `packages/lib/src/SignalPropertyBinding.ts`
- Create: `packages/lib/test/qunit/SignalPropertyBinding.qunit.ts`
- Modify: `packages/lib/test/qunit/testsuite.qunit.html` (add test module)

- [ ] **Step 1: Write SignalPropertyBinding tests**

Create `packages/lib/test/qunit/SignalPropertyBinding.qunit.ts`:

```typescript
import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("SignalPropertyBinding", () => {
  QUnit.test("binding reads initial value from model", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");

    assert.strictEqual(binding.getValue(), "Alice", "initial value is Alice");

    model.destroy();
  });

  QUnit.test("binding receives push notification on setProperty", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");

    binding.attachChange(() => {
      assert.strictEqual(binding.getValue(), "Bob", "value updated to Bob");
      model.destroy();
      done();
    });

    model.setProperty("/name", "Bob");
  });

  QUnit.test("binding does not fire when value is unchanged", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => {
      changeCount++;
    });

    model.setProperty("/name", "Alice");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no change event fired");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("two-way binding: setValue updates model", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");

    binding.setValue("Bob");
    assert.strictEqual(model.getProperty("/name"), "Bob", "model updated via binding");

    model.destroy();
  });

  QUnit.test("multiple bindings to same path both fire", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding1 = model.bindProperty("/name");
    const binding2 = model.bindProperty("/name");
    let count = 0;

    binding1.attachChange(() => count++);
    binding2.attachChange(() => count++);

    model.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(count, 2, "both bindings notified");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("binding to unrelated path does not fire", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice", age: 28 });
    const nameBinding = model.bindProperty("/name");
    const ageBinding = model.bindProperty("/age");
    let ageChangeCount = 0;

    ageBinding.attachChange(() => ageChangeCount++);

    model.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(ageChangeCount, 0, "age binding not notified");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("suspended binding does not fire", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.suspend();

    model.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no event while suspended");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("resume fires change for pending update", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.suspend();
    model.setProperty("/name", "Bob");

    setTimeout(() => {
      binding.resume();
      setTimeout(() => {
        assert.ok(changeCount > 0, "change fired on resume");
        assert.strictEqual(binding.getValue(), "Bob", "value is current after resume");
        model.destroy();
        done();
      }, 50);
    }, 50);
  });

  QUnit.test("destroy cleans up watcher", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    binding.attachChange(() => {});

    binding.destroy();
    assert.ok(true, "destroy completes without error");

    model.destroy();
  });
});
```

- [ ] **Step 2: Add test module to testsuite.qunit.html**

In `packages/lib/test/qunit/testsuite.qunit.html`, update the `sap.ui.require` array:

```javascript
sap.ui.require(["test/SignalRegistry.qunit", "test/SignalPropertyBinding.qunit"], function () {
  QUnit.start();
});
```

- [ ] **Step 3: Run tests -- verify SignalPropertyBinding tests fail**

Reload test page. Expected: SignalRegistry tests pass, SignalPropertyBinding tests fail (SignalModel not implemented yet).

- [ ] **Step 4: Implement SignalPropertyBinding**

Create `packages/lib/src/SignalPropertyBinding.ts`:

```typescript
import ClientPropertyBinding from "sap/ui/model/ClientPropertyBinding";
import ChangeReason from "sap/ui/model/ChangeReason";
import { Signal } from "signal-polyfill";
import type SignalModel from "./SignalModel";

/**
 * Property binding that subscribes to a signal for push-based change notification.
 * Replaces the poll-based checkUpdate pattern with direct signal watcher subscription.
 *
 * @namespace ui5.model.signal
 */
export default class SignalPropertyBinding extends ClientPropertyBinding {
  declare oModel: SignalModel;
  private watcher: Signal.subtle.Watcher | null = null;
  private needsEnqueue = true;

  override checkUpdate(bForceUpdate?: boolean): void {
    if (this.bSuspended && !bForceUpdate) {
      return;
    }

    const oValue = this._getValue();
    if (this.oValue !== oValue || bForceUpdate) {
      this.oValue = oValue;
      this.getDataState().setValue(this.oValue);
      this.checkDataState();
      this._fireChange({ reason: ChangeReason.Change });
    }
  }

  override setValue(oValue: unknown): void {
    if (this.bSuspended) {
      return;
    }

    if (this.oValue !== oValue) {
      this.oModel.setProperty(this.sPath, oValue, this.oContext, true);
      this.oValue = oValue;
      this.getDataState().setValue(this.oValue);
      this.oModel.firePropertyChange({
        reason: ChangeReason.Binding,
        path: this.sPath,
        context: this.oContext,
        value: oValue,
      });
    }
  }

  subscribe(): void {
    this.unsubscribe();

    const signal = this.oModel._getOrCreateSignal(this.getResolvedPath()!, this._getValue());

    this.needsEnqueue = true;
    this.watcher = new Signal.subtle.Watcher(() => {
      if (this.needsEnqueue) {
        this.needsEnqueue = false;
        queueMicrotask(() => {
          this.needsEnqueue = true;
          signal.get();
          this.watcher?.watch();
          this.checkUpdate();
        });
      }
    });
    this.watcher.watch(signal);
  }

  unsubscribe(): void {
    if (this.watcher) {
      this.watcher.unwatch();
      this.watcher = null;
    }
  }

  override initialize(): this {
    this.subscribe();
    this.checkUpdate(true);
    return this;
  }

  override setContext(oContext?: object): void {
    if (this.oContext !== oContext) {
      const oldResolved = this.getResolvedPath();
      super.setContext(oContext);
      const newResolved = this.getResolvedPath();
      if (oldResolved !== newResolved && newResolved) {
        this.subscribe();
      }
    }
  }

  override destroy(): void {
    this.unsubscribe();
    super.destroy();
  }
}
```

Note: This references `SignalModel._getOrCreateSignal()` which we implement in Task 7. The tests will pass once SignalModel is in place.

- [ ] **Step 5: Commit**

```bash
git add packages/lib/src/SignalPropertyBinding.ts packages/lib/test/qunit/SignalPropertyBinding.qunit.ts packages/lib/test/qunit/testsuite.qunit.html
git commit -m "feat: implement SignalPropertyBinding with watcher-based push notifications"
```

---

### Task 7: SignalModel Core

**Files:**

- Create: `packages/lib/src/SignalModel.ts`
- Create: `packages/lib/test/qunit/SignalModel.qunit.ts`
- Modify: `packages/lib/test/qunit/testsuite.qunit.html` (add test module)

- [ ] **Step 1: Write SignalModel tests**

Create `packages/lib/test/qunit/SignalModel.qunit.ts`:

```typescript
import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("SignalModel", () => {
  QUnit.test("constructor sets initial data", (assert) => {
    const data = { name: "Alice", age: 28 };
    const model = new SignalModel(data);

    assert.deepEqual(model.getData(), data, "getData returns initial data");
    model.destroy();
  });

  QUnit.test("getProperty returns value at path", (assert) => {
    const model = new SignalModel({ customer: { name: "Alice" } });

    assert.strictEqual(model.getProperty("/customer/name"), "Alice", "nested property");
    assert.strictEqual(model.getProperty("/customer"), model.getData().customer, "object property");

    model.destroy();
  });

  QUnit.test("getProperty returns undefined for missing path", (assert) => {
    const model = new SignalModel({ name: "Alice" });

    assert.strictEqual(model.getProperty("/missing"), undefined, "undefined for missing");

    model.destroy();
  });

  QUnit.test("setProperty updates data and returns true", (assert) => {
    const model = new SignalModel({ name: "Alice" });

    const result = model.setProperty("/name", "Bob");
    assert.ok(result, "returns true on success");
    assert.strictEqual(model.getProperty("/name"), "Bob", "value updated");

    model.destroy();
  });

  QUnit.test("setProperty creates intermediate paths", (assert) => {
    const model = new SignalModel({});

    model.setProperty("/customer/name", "Alice");
    assert.strictEqual(model.getProperty("/customer/name"), "Alice", "created nested path");

    model.destroy();
  });

  QUnit.test("setProperty at root uses setData", (assert) => {
    const model = new SignalModel({ old: true });
    const newData = { new: true };

    model.setProperty("/", newData);
    assert.deepEqual(model.getData(), newData, "root replaced via setData");

    model.destroy();
  });

  QUnit.test("setData replaces all data", (assert) => {
    const model = new SignalModel({ name: "Alice" });

    model.setData({ name: "Bob", extra: true });
    assert.strictEqual(model.getProperty("/name"), "Bob", "data replaced");
    assert.strictEqual(model.getProperty("/extra"), true, "new properties available");

    model.destroy();
  });

  QUnit.test("setData with merge preserves existing properties", (assert) => {
    const model = new SignalModel({ name: "Alice", age: 28 });

    model.setData({ age: 30 }, true);
    assert.strictEqual(model.getProperty("/name"), "Alice", "name preserved");
    assert.strictEqual(model.getProperty("/age"), 30, "age updated");

    model.destroy();
  });

  QUnit.test("setData fires all signals on replace", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice", age: 28 });
    const nameBinding = model.bindProperty("/name");
    const ageBinding = model.bindProperty("/age");
    let nameChanged = false;
    let ageChanged = false;

    nameBinding.attachChange(() => {
      nameChanged = true;
    });
    ageBinding.attachChange(() => {
      ageChanged = true;
    });

    model.setData({ name: "Bob", age: 30 });

    setTimeout(() => {
      assert.ok(nameChanged, "name binding notified");
      assert.ok(ageChanged, "age binding notified");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("setData with merge only fires changed signals", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice", age: 28 });
    const nameBinding = model.bindProperty("/name");
    const ageBinding = model.bindProperty("/age");
    let nameChanged = false;
    let ageChanged = false;

    nameBinding.attachChange(() => {
      nameChanged = true;
    });
    ageBinding.attachChange(() => {
      ageChanged = true;
    });

    model.setData({ age: 30 }, true);

    setTimeout(() => {
      assert.notOk(nameChanged, "name binding NOT notified");
      assert.ok(ageChanged, "age binding notified");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("bindProperty returns a SignalPropertyBinding", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");

    assert.ok(binding, "binding created");
    assert.strictEqual(binding.getValue(), "Alice", "binding has correct value");

    model.destroy();
  });

  QUnit.test("checkUpdate is a no-op (returns 0)", (assert) => {
    const model = new SignalModel({ name: "Alice" });

    const result = model.checkUpdate();
    assert.strictEqual(result, 0, "checkUpdate returns 0");

    model.destroy();
  });

  QUnit.test("getSignal returns the signal for a path", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.bindProperty("/name");

    const signal = model.getSignal("/name");
    assert.ok(signal, "signal exists");
    assert.strictEqual(signal.get(), "Alice", "signal has correct value");

    model.destroy();
  });

  QUnit.test("parent path signals fire on leaf write", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
    const customerBinding = model.bindProperty("/customer");
    let customerChanged = false;

    customerBinding.attachChange(() => {
      customerChanged = true;
    });

    model.setProperty("/customer/name", "Bob");

    setTimeout(() => {
      assert.ok(customerChanged, "parent binding notified on child change");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("branch replace fires all child signals", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
    const nameBinding = model.bindProperty("/customer/name");
    const ageBinding = model.bindProperty("/customer/age");
    let nameChanged = false;
    let ageChanged = false;

    nameBinding.attachChange(() => {
      nameChanged = true;
    });
    ageBinding.attachChange(() => {
      ageChanged = true;
    });

    model.setProperty("/customer", { name: "Bob", age: 30 });

    setTimeout(() => {
      assert.ok(nameChanged, "name binding notified on branch replace");
      assert.ok(ageChanged, "age binding notified on branch replace");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("destroy cleans up registry", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.bindProperty("/name");

    model.destroy();
    assert.ok(true, "destroy completes without error");
  });
});
```

- [ ] **Step 2: Add test module to testsuite.qunit.html**

Update the `sap.ui.require` array in `testsuite.qunit.html`:

```javascript
sap.ui.require(
  ["test/SignalRegistry.qunit", "test/SignalPropertyBinding.qunit", "test/SignalModel.qunit"],
  function () {
    QUnit.start();
  },
);
```

- [ ] **Step 3: Implement SignalModel**

Create `packages/lib/src/SignalModel.ts`:

```typescript
import ClientModel from "sap/ui/model/ClientModel";
import Context from "sap/ui/model/Context";
import deepExtend from "sap/base/util/deepExtend";
import SignalRegistry from "./SignalRegistry";
import SignalPropertyBinding from "./SignalPropertyBinding";
import SignalListBinding from "./SignalListBinding";
import type { SignalModelOptions } from "./types";
import type { Signal } from "signal-polyfill";

/**
 * Reactive UI5 model using TC39 Signals for push-based change notification.
 * Drop-in replacement for JSONModel.
 *
 * @namespace ui5.model.signal
 */
export default class SignalModel extends ClientModel {
  private registry: SignalRegistry;
  private strict: boolean;
  declare oData: Record<string, unknown>;

  constructor(oData?: Record<string, unknown>, mOptions?: SignalModelOptions) {
    super();
    this.oData = oData || {};
    this.registry = new SignalRegistry();
    this.strict = mOptions?.strict ?? false;
  }

  setData(oData: Record<string, unknown>, bMerge?: boolean): void {
    if (bMerge) {
      this.oData = deepExtend(Array.isArray(this.oData) ? [] : {}, this.oData, oData) as Record<
        string,
        unknown
      >;
      this.registry.invalidateAll((path: string) => this._getObject(path));
    } else {
      this.oData = oData;
      this.registry.invalidateAll((path: string) => this._getObject(path));
    }
  }

  getData(): Record<string, unknown> {
    return this.oData;
  }

  override getProperty(sPath: string, oContext?: Context): unknown {
    return this._getObject(sPath, oContext);
  }

  setProperty(sPath: string, oValue: unknown, oContext?: Context, bAsyncUpdate?: boolean): boolean {
    const sResolvedPath = this.resolve(sPath, oContext);
    if (!sResolvedPath) {
      return false;
    }

    if (sResolvedPath === "/") {
      this.setData(oValue as Record<string, unknown>);
      return true;
    }

    if (this.registry.isComputed(sResolvedPath)) {
      throw new TypeError(
        `Cannot set value at "${sResolvedPath}": path is a computed signal (read-only)`,
      );
    }

    const iLastSlash = sResolvedPath.lastIndexOf("/");
    const sObjectPath = sResolvedPath.substring(0, iLastSlash || 1);
    const sPropertyName = sResolvedPath.substring(iLastSlash + 1);

    let oObject = this._getObject(sObjectPath) as Record<string, unknown> | undefined;

    if (!oObject) {
      if (this.strict) {
        throw new TypeError(
          `Cannot set property at "${sResolvedPath}": path does not exist (strict mode)`,
        );
      }
      oObject = this._createPath(sObjectPath);
    }

    if (oObject) {
      oObject[sPropertyName] = oValue;

      this.registry.set(sResolvedPath, oValue);

      this._invalidateParentSignals(sResolvedPath);

      if (typeof oValue === "object" && oValue !== null) {
        this.registry.invalidateChildren(sResolvedPath, (path: string) => this._getObject(path));
      }

      return true;
    }
    return false;
  }

  mergeProperty(sPath: string, oValue: unknown, oContext?: Context): boolean {
    const sResolvedPath = this.resolve(sPath, oContext);
    if (!sResolvedPath) {
      return false;
    }

    const existing = this._getObject(sResolvedPath);
    if (existing && typeof existing === "object" && typeof oValue === "object" && oValue !== null) {
      const merged = deepExtend(Array.isArray(existing) ? [] : {}, existing, oValue) as Record<
        string,
        unknown
      >;

      const oParent = this._getObject(
        sResolvedPath.substring(0, sResolvedPath.lastIndexOf("/") || 1),
      ) as Record<string, unknown>;
      const prop = sResolvedPath.substring(sResolvedPath.lastIndexOf("/") + 1);
      oParent[prop] = merged;

      this._invalidateMergedPaths(sResolvedPath, existing as Record<string, unknown>, merged);
      this._invalidateParentSignals(sResolvedPath);

      return true;
    }

    return this.setProperty(sPath, oValue, oContext);
  }

  override bindProperty(
    sPath: string,
    oContext?: Context,
    mParameters?: object,
  ): SignalPropertyBinding {
    return new SignalPropertyBinding(this, sPath, oContext, mParameters);
  }

  override bindList(
    sPath: string,
    oContext?: Context,
    aSorters?: object | object[],
    aFilters?: object | object[],
    mParameters?: object,
  ): SignalListBinding {
    return new SignalListBinding(this, sPath, oContext, aSorters, aFilters, mParameters);
  }

  override checkUpdate(_bForceUpdate?: boolean, _bAsync?: boolean): number {
    return 0;
  }

  getSignal(sPath: string): Signal.State<unknown> {
    return this.registry.getOrCreate(sPath, this._getObject(sPath));
  }

  createComputed(
    sPath: string,
    aDeps: string[],
    fn: (...args: unknown[]) => unknown,
  ): Signal.Computed<unknown> {
    return this.registry.addComputed(sPath, aDeps, fn);
  }

  removeComputed(sPath: string): void {
    this.registry.removeComputed(sPath);
  }

  /**
   * @internal Used by SignalPropertyBinding and SignalListBinding to get or create a signal.
   */
  _getOrCreateSignal(sPath: string, initialValue: unknown): Signal.State<unknown> {
    return this.registry.getOrCreate(sPath, initialValue);
  }

  _getObject(sPath: string, oContext?: Context): unknown {
    let oNode: unknown = this.oData;

    const sResolvedPath = this.resolve(sPath, oContext);
    if (!sResolvedPath) {
      return undefined;
    }

    if (sResolvedPath === "/") {
      return this.oData;
    }

    const aParts = sResolvedPath.substring(1).split("/");
    for (const sPart of aParts) {
      if (oNode === null || oNode === undefined) {
        return undefined;
      }
      oNode = (oNode as Record<string, unknown>)[sPart];
    }
    return oNode;
  }

  private _createPath(sPath: string): Record<string, unknown> {
    let oNode: Record<string, unknown> = this.oData;
    const aParts = sPath.substring(1).split("/");

    for (const sPart of aParts) {
      if (sPart === "") continue;
      if (!(sPart in oNode) || oNode[sPart] === null || oNode[sPart] === undefined) {
        oNode[sPart] = {};
      }
      oNode = oNode[sPart] as Record<string, unknown>;
    }
    return oNode;
  }

  private _invalidateParentSignals(sPath: string): void {
    const parts = sPath.split("/");
    for (let i = parts.length - 1; i >= 1; i--) {
      const parentPath = parts.slice(0, i).join("/") || "/";
      if (this.registry.has(parentPath)) {
        this.registry.set(parentPath, this._getObject(parentPath));
      }
    }
  }

  private _invalidateMergedPaths(
    basePath: string,
    oldData: Record<string, unknown>,
    newData: Record<string, unknown>,
  ): void {
    for (const key of Object.keys(newData)) {
      const childPath = `${basePath}/${key}`;
      if (oldData[key] !== newData[key]) {
        this.registry.set(childPath, newData[key]);
      }
    }
    this.registry.set(basePath, newData);
  }

  override destroy(): void {
    this.registry.destroy();
    super.destroy();
  }
}
```

- [ ] **Step 4: Run tests -- verify SignalModel and SignalPropertyBinding tests pass**

Reload the test page. Expected: all tests pass across SignalRegistry, SignalPropertyBinding, and SignalModel modules.

- [ ] **Step 5: Commit**

```bash
git add packages/lib/src/SignalModel.ts packages/lib/test/qunit/SignalModel.qunit.ts packages/lib/test/qunit/testsuite.qunit.html
git commit -m "feat: implement SignalModel core with setProperty, setData, and signal registry"
```

---

### Task 8: SignalListBinding

**Files:**

- Create: `packages/lib/src/SignalListBinding.ts`
- Create: `packages/lib/test/qunit/SignalListBinding.qunit.ts`
- Modify: `packages/lib/test/qunit/testsuite.qunit.html` (add test module)

- [ ] **Step 1: Write SignalListBinding tests**

Create `packages/lib/test/qunit/SignalListBinding.qunit.ts`:

```typescript
import SignalModel from "ui5/model/signal/SignalModel";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";

QUnit.module("SignalListBinding", () => {
  QUnit.test("binding returns contexts for array data", (assert) => {
    const model = new SignalModel({
      items: [{ name: "A" }, { name: "B" }, { name: "C" }],
    });
    const binding = model.bindList("/items");

    const contexts = binding.getContexts(0, 10);
    assert.strictEqual(contexts.length, 3, "3 contexts returned");
    assert.strictEqual(model.getProperty("name", contexts[0]), "A", "first item is A");
    assert.strictEqual(model.getProperty("name", contexts[2]), "C", "third item is C");

    model.destroy();
  });

  QUnit.test("getLength returns correct count", (assert) => {
    const model = new SignalModel({
      items: [{ name: "A" }, { name: "B" }],
    });
    const binding = model.bindList("/items");

    binding.getContexts(0, 10);
    assert.strictEqual(binding.getLength(), 2, "length is 2");

    model.destroy();
  });

  QUnit.test("binding fires change when list is modified", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "A" }],
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);

    binding.attachChange(() => {
      const contexts = binding.getContexts(0, 10);
      assert.strictEqual(contexts.length, 2, "list updated to 2 items");
      model.destroy();
      done();
    });

    model.setProperty("/items", [{ name: "A" }, { name: "B" }]);
  });

  QUnit.test("filter narrows the results", (assert) => {
    const model = new SignalModel({
      items: [
        { name: "Alice", active: true },
        { name: "Bob", active: false },
        { name: "Carol", active: true },
      ],
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);

    binding.filter([new Filter("active", FilterOperator.EQ, true)]);
    const contexts = binding.getContexts(0, 10);

    assert.strictEqual(contexts.length, 2, "filtered to 2 active items");
    assert.strictEqual(model.getProperty("name", contexts[0]), "Alice", "first is Alice");
    assert.strictEqual(model.getProperty("name", contexts[1]), "Carol", "second is Carol");

    model.destroy();
  });

  QUnit.test("sort reorders the results", (assert) => {
    const model = new SignalModel({
      items: [{ name: "Carol" }, { name: "Alice" }, { name: "Bob" }],
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);

    binding.sort(new Sorter("name"));
    const contexts = binding.getContexts(0, 10);

    assert.strictEqual(model.getProperty("name", contexts[0]), "Alice", "sorted first");
    assert.strictEqual(model.getProperty("name", contexts[1]), "Bob", "sorted second");
    assert.strictEqual(model.getProperty("name", contexts[2]), "Carol", "sorted third");

    model.destroy();
  });

  QUnit.test("binding to unrelated path does not fire", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "A" }],
      other: "value",
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);
    let changed = false;

    binding.attachChange(() => {
      changed = true;
    });
    model.setProperty("/other", "newValue");

    setTimeout(() => {
      assert.notOk(changed, "list binding not notified for unrelated change");
      model.destroy();
      done();
    }, 50);
  });
});
```

- [ ] **Step 2: Add test module to testsuite.qunit.html**

Update the `sap.ui.require` array:

```javascript
sap.ui.require(
  [
    "test/SignalRegistry.qunit",
    "test/SignalPropertyBinding.qunit",
    "test/SignalModel.qunit",
    "test/SignalListBinding.qunit",
  ],
  function () {
    QUnit.start();
  },
);
```

- [ ] **Step 3: Implement SignalListBinding**

Create `packages/lib/src/SignalListBinding.ts`:

```typescript
import ClientListBinding from "sap/ui/model/ClientListBinding";
import ChangeReason from "sap/ui/model/ChangeReason";
import Context from "sap/ui/model/Context";
import deepExtend from "sap/base/util/deepExtend";
import { Signal } from "signal-polyfill";
import type SignalModel from "./SignalModel";

/**
 * List binding that subscribes to a signal for push-based change notification.
 * Reuses ClientListBinding's filter/sort/extended-change-detection.
 *
 * @namespace ui5.model.signal
 */
export default class SignalListBinding extends ClientListBinding {
  declare oModel: SignalModel;
  private watcher: Signal.subtle.Watcher | null = null;
  private needsEnqueue = true;
  declare oList: unknown[] | Record<string, unknown>;
  declare aIndices: number[];
  declare iLength: number;

  override update(): void {
    const oList = this.oModel._getObject(this.sPath, this.oContext);
    if (oList) {
      if (Array.isArray(oList)) {
        this.oList = this.bUseExtendedChangeDetection
          ? (deepExtend([], oList) as unknown[])
          : oList.slice();
      } else {
        this.oList = this.bUseExtendedChangeDetection
          ? (deepExtend({}, oList) as Record<string, unknown>)
          : Object.assign({}, oList);
      }
      this.updateIndices();
      this.applyFilter();
      this.applySort();
      this.iLength = this._getLength();
    } else {
      this.oList = [];
      this.aIndices = [];
      this.iLength = 0;
    }
  }

  override checkUpdate(bForceUpdate?: boolean): void {
    if (this.bSuspended && !bForceUpdate) {
      return;
    }
    this.update();
    this._fireChange({ reason: ChangeReason.Change });
  }

  subscribe(): void {
    this.unsubscribe();

    const resolvedPath = this.getResolvedPath();
    if (!resolvedPath) return;

    const signal = this.oModel._getOrCreateSignal(
      resolvedPath,
      this.oModel._getObject(resolvedPath),
    );

    this.needsEnqueue = true;
    this.watcher = new Signal.subtle.Watcher(() => {
      if (this.needsEnqueue) {
        this.needsEnqueue = false;
        queueMicrotask(() => {
          this.needsEnqueue = true;
          signal.get();
          this.watcher?.watch();
          this.checkUpdate();
        });
      }
    });
    this.watcher.watch(signal);
  }

  unsubscribe(): void {
    if (this.watcher) {
      this.watcher.unwatch();
      this.watcher = null;
    }
  }

  override initialize(): this {
    this.update();
    this.subscribe();
    return this;
  }

  override setContext(oContext?: object): void {
    if (this.oContext !== oContext) {
      this.oContext = oContext as Context;
      if (this.isRelative()) {
        this.update();
        this.subscribe();
        this._fireChange({ reason: ChangeReason.Context });
      }
    }
  }

  override destroy(): void {
    this.unsubscribe();
    super.destroy();
  }
}
```

- [ ] **Step 4: Run tests -- verify all tests pass**

Reload test page. Expected: all tests pass including SignalListBinding.

- [ ] **Step 5: Commit**

```bash
git add packages/lib/src/SignalListBinding.ts packages/lib/test/qunit/SignalListBinding.qunit.ts packages/lib/test/qunit/testsuite.qunit.html
git commit -m "feat: implement SignalListBinding with filter and sort support"
```

---

### Task 9: Computed Signals

**Files:**

- Create: `packages/lib/test/qunit/ComputedSignals.qunit.ts`
- Modify: `packages/lib/test/qunit/testsuite.qunit.html` (add test module)

Note: The implementation already exists in SignalModel (`createComputed`, `removeComputed`) and SignalRegistry (`addComputed`, `removeComputed`). This task adds integration tests and verifies bindings to computed paths work end-to-end.

- [ ] **Step 1: Write computed signal integration tests**

Create `packages/lib/test/qunit/ComputedSignals.qunit.ts`:

```typescript
import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("ComputedSignals", () => {
  QUnit.test("createComputed creates a derived value", (assert) => {
    const model = new SignalModel({ firstName: "Alice", lastName: "Smith" });

    model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => {
      return `${first} ${last}`;
    });

    const binding = model.bindProperty("/fullName");
    assert.strictEqual(binding.getValue(), "Alice Smith", "computed value correct");

    model.destroy();
  });

  QUnit.test("computed updates when dependency changes", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ firstName: "Alice", lastName: "Smith" });

    model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => {
      return `${first} ${last}`;
    });

    const binding = model.bindProperty("/fullName");

    binding.attachChange(() => {
      assert.strictEqual(binding.getValue(), "Bob Smith", "computed updated");
      model.destroy();
      done();
    });

    model.setProperty("/firstName", "Bob");
  });

  QUnit.test("setProperty on computed path throws", (assert) => {
    const model = new SignalModel({ a: 1 });
    model.createComputed("/doubled", ["/a"], (a) => (a as number) * 2);

    assert.throws(
      () => model.setProperty("/doubled", 99),
      TypeError,
      "throws TypeError on write to computed",
    );

    model.destroy();
  });

  QUnit.test("createComputed on raw data path throws", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.bindProperty("/name");

    assert.throws(
      () => model.createComputed("/name", [], () => "x"),
      TypeError,
      "throws when path has raw data",
    );

    model.destroy();
  });

  QUnit.test("createComputed on existing computed replaces it", (assert) => {
    const model = new SignalModel({ a: 5 });

    model.createComputed("/result", ["/a"], (a) => (a as number) + 10);
    assert.strictEqual(model.bindProperty("/result").getValue(), 15, "first computed");

    model.createComputed("/result", ["/a"], (a) => (a as number) * 2);
    assert.strictEqual(model.bindProperty("/result").getValue(), 10, "replaced computed");

    model.destroy();
  });

  QUnit.test("removeComputed removes the computed signal", (assert) => {
    const model = new SignalModel({ a: 1 });
    model.createComputed("/doubled", ["/a"], (a) => (a as number) * 2);

    model.removeComputed("/doubled");

    const binding = model.bindProperty("/doubled");
    assert.strictEqual(binding.getValue(), undefined, "computed removed, returns undefined");

    model.destroy();
  });

  QUnit.test("computed with multiple dependencies", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ price: 100, tax: 0.2 });

    model.createComputed("/total", ["/price", "/tax"], (price, tax) => {
      return (price as number) * (1 + (tax as number));
    });

    const binding = model.bindProperty("/total");
    assert.strictEqual(binding.getValue(), 120, "initial total correct");

    binding.attachChange(() => {
      assert.strictEqual(binding.getValue(), 240, "total updated when price changes");
      model.destroy();
      done();
    });

    model.setProperty("/price", 200);
  });
});
```

- [ ] **Step 2: Add test module to testsuite.qunit.html**

Update the `sap.ui.require` array to include `"test/ComputedSignals.qunit"`.

- [ ] **Step 3: Run tests -- verify all pass**

Reload test page. Expected: all computed signal tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/lib/test/qunit/ComputedSignals.qunit.ts packages/lib/test/qunit/testsuite.qunit.html
git commit -m "test: add computed signal integration tests"
```

---

### Task 10: mergeProperty

**Files:**

- Create: `packages/lib/test/qunit/MergeProperty.qunit.ts`
- Modify: `packages/lib/test/qunit/testsuite.qunit.html` (add test module)

Note: Implementation already exists in `SignalModel.mergeProperty()`. This task adds focused tests.

- [ ] **Step 1: Write mergeProperty tests**

Create `packages/lib/test/qunit/MergeProperty.qunit.ts`:

```typescript
import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("mergeProperty", () => {
  QUnit.test("merges into existing object, preserving unchanged fields", (assert) => {
    const model = new SignalModel({ customer: { name: "Alice", age: 28 } });

    const result = model.mergeProperty("/customer", { age: 30 });
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/customer/name"), "Alice", "name preserved");
    assert.strictEqual(model.getProperty("/customer/age"), 30, "age updated");

    model.destroy();
  });

  QUnit.test("only changed paths fire signals", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
    const nameBinding = model.bindProperty("/customer/name");
    const ageBinding = model.bindProperty("/customer/age");
    let nameChanged = false;
    let ageChanged = false;

    nameBinding.attachChange(() => {
      nameChanged = true;
    });
    ageBinding.attachChange(() => {
      ageChanged = true;
    });

    model.mergeProperty("/customer", { age: 30 });

    setTimeout(() => {
      assert.notOk(nameChanged, "name binding NOT notified");
      assert.ok(ageChanged, "age binding notified");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("parent signal fires on merge", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
    const customerBinding = model.bindProperty("/customer");
    let customerChanged = false;

    customerBinding.attachChange(() => {
      customerChanged = true;
    });

    model.mergeProperty("/customer", { age: 30 });

    setTimeout(() => {
      assert.ok(customerChanged, "parent binding notified on merge");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("falls back to setProperty for non-object values", (assert) => {
    const model = new SignalModel({ name: "Alice" });

    const result = model.mergeProperty("/name", "Bob");
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/name"), "Bob", "value replaced");

    model.destroy();
  });

  QUnit.test("deep merge with nested objects", (assert) => {
    const model = new SignalModel({
      config: {
        display: { theme: "dark", fontSize: 14 },
        network: { timeout: 5000 },
      },
    });

    model.mergeProperty("/config", {
      display: { fontSize: 16 },
    });

    assert.strictEqual(model.getProperty("/config/display/theme"), "dark", "theme preserved");
    assert.strictEqual(model.getProperty("/config/display/fontSize"), 16, "fontSize updated");
    assert.strictEqual(model.getProperty("/config/network/timeout"), 5000, "network preserved");

    model.destroy();
  });
});
```

- [ ] **Step 2: Add test module to testsuite.qunit.html**

Update the `sap.ui.require` array to include `"test/MergeProperty.qunit"`.

- [ ] **Step 3: Run tests -- verify all pass**

Reload test page. Expected: all mergeProperty tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/lib/test/qunit/MergeProperty.qunit.ts packages/lib/test/qunit/testsuite.qunit.html
git commit -m "test: add mergeProperty integration tests"
```

---

### Task 11: Strict Mode

**Files:**

- Create: `packages/lib/test/qunit/StrictMode.qunit.ts`
- Modify: `packages/lib/test/qunit/testsuite.qunit.html` (add test module)

Note: Strict mode check is already implemented in `SignalModel.setProperty()`. This task adds focused tests.

- [ ] **Step 1: Write strict mode tests**

Create `packages/lib/test/qunit/StrictMode.qunit.ts`:

```typescript
import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("StrictMode", () => {
  QUnit.test("strict: false (default) allows setting nonexistent paths", (assert) => {
    const model = new SignalModel({});

    const result = model.setProperty("/newProp", "value");
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/newProp"), "value", "property created");

    model.destroy();
  });

  QUnit.test("strict: true throws on nonexistent path", (assert) => {
    const model = new SignalModel({}, { strict: true });

    assert.throws(
      () => model.setProperty("/nonexistent", "value"),
      TypeError,
      "throws TypeError for missing path",
    );

    model.destroy();
  });

  QUnit.test("strict: true allows setting existing paths", (assert) => {
    const model = new SignalModel({ name: "Alice" }, { strict: true });

    const result = model.setProperty("/name", "Bob");
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/name"), "Bob", "value updated");

    model.destroy();
  });

  QUnit.test("strict: true throws on deeply nested nonexistent path", (assert) => {
    const model = new SignalModel({ customer: { name: "Alice" } }, { strict: true });

    assert.throws(
      () => model.setProperty("/customer/email", "alice@example.com"),
      TypeError,
      "throws for missing nested path",
    );

    model.destroy();
  });

  QUnit.test("strict: true allows setting existing nested paths", (assert) => {
    const model = new SignalModel({ customer: { name: "Alice" } }, { strict: true });

    const result = model.setProperty("/customer/name", "Bob");
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/customer/name"), "Bob", "nested value updated");

    model.destroy();
  });
});
```

- [ ] **Step 2: Add test module to testsuite.qunit.html**

Update the `sap.ui.require` array to include `"test/StrictMode.qunit"`.

- [ ] **Step 3: Run tests -- verify all pass**

Reload test page. Expected: all strict mode tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/lib/test/qunit/StrictMode.qunit.ts packages/lib/test/qunit/testsuite.qunit.html
git commit -m "test: add strict mode tests"
```

---

### Task 12: Demo App Scaffolding

**Files:**

- Create: `packages/demo-app/package.json`
- Create: `packages/demo-app/tsconfig.json`
- Create: `packages/demo-app/ui5.yaml`
- Create: `packages/demo-app/webapp/manifest.json`
- Create: `packages/demo-app/webapp/index.html`
- Create: `packages/demo-app/webapp/Component.ts`
- Create: `packages/demo-app/webapp/model/sampleData.ts`

- [ ] **Step 1: Create demo app package.json**

```bash
mkdir -p packages/demo-app/webapp/controller packages/demo-app/webapp/view packages/demo-app/webapp/model
```

Create `packages/demo-app/package.json`:

```json
{
  "name": "ui5-lib-signal-model-demo",
  "version": "1.0.0",
  "private": true,
  "author": "Marco Beier",
  "description": "Demo app for ui5-lib-signal-model library",
  "type": "module",
  "scripts": {
    "clean": "rimraf dist .ui5",
    "serve": "ui5 serve",
    "start": "ui5 serve --open /index.html",
    "build": "ui5 build",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@ui5/cli": "^4.0.0",
    "ui5-middleware-livereload": "^3.0.0",
    "ui5-tooling-transpile": "^3.0.0"
  },
  "dependencies": {
    "ui5-lib-signal-model": "*"
  }
}
```

- [ ] **Step 2: Create demo tsconfig.json**

Create `packages/demo-app/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "../..",
    "paths": {
      "ui5/model/signal/*": ["../lib/src/*"],
      "demo/app/*": ["./webapp/*"]
    },
    "types": ["@openui5/types"]
  },
  "include": ["webapp/**/*.ts", "../lib/src/**/*.ts"]
}
```

- [ ] **Step 3: Create demo ui5.yaml**

Create `packages/demo-app/ui5.yaml`:

```yaml
specVersion: "4.0"
metadata:
  name: demo.app
type: application
framework:
  name: OpenUI5
  version: "1.144.0"
  libraries:
    - name: sap.m
    - name: sap.ui.core
    - name: sap.ui.layout
    - name: themelib_sap_horizon
server:
  customMiddleware:
    - name: ui5-tooling-transpile-middleware
      afterMiddleware: compression
      configuration:
        transpileDependencies: true
        transformModulesToUI5: true
    - name: ui5-middleware-livereload
      afterMiddleware: compression
resources:
  configuration:
    paths:
      webapp: webapp
builder:
  customTasks:
    - name: ui5-tooling-transpile-task
      afterTask: replaceVersion
      configuration:
        transformModulesToUI5: true
```

- [ ] **Step 4: Create demo manifest.json**

Create `packages/demo-app/webapp/manifest.json`:

```json
{
  "_version": "2.0.0",
  "sap.app": {
    "id": "demo.app",
    "type": "application",
    "applicationVersion": {
      "version": "1.0.0"
    },
    "title": "SignalModel Demo"
  },
  "sap.ui": {
    "technology": "UI5",
    "deviceTypes": {
      "desktop": true,
      "tablet": true,
      "phone": true
    }
  },
  "sap.ui5": {
    "contentDensities": {
      "compact": true,
      "cozy": true
    },
    "dependencies": {
      "minUI5Version": "1.144.0",
      "libs": {
        "sap.m": {},
        "sap.ui.core": {},
        "sap.ui.layout": {},
        "ui5.model.signal": {}
      }
    },
    "rootView": {
      "viewName": "demo.app.view.App",
      "type": "XML",
      "id": "appView"
    },
    "routing": {
      "config": {
        "routerClass": "sap.m.routing.Router",
        "type": "View",
        "viewType": "XML",
        "path": "demo.app.view",
        "controlId": "appContainer",
        "controlAggregation": "pages"
      },
      "routes": [
        { "name": "propertyBinding", "pattern": "", "target": "propertyBinding" },
        { "name": "listBinding", "pattern": "list", "target": "listBinding" },
        { "name": "computed", "pattern": "computed", "target": "computed" },
        { "name": "programmatic", "pattern": "programmatic", "target": "programmatic" },
        { "name": "strict", "pattern": "strict", "target": "strict" },
        { "name": "comparison", "pattern": "comparison", "target": "comparison" }
      ],
      "targets": {
        "propertyBinding": { "name": "PropertyBinding", "id": "propertyBindingView" },
        "listBinding": { "name": "ListBinding", "id": "listBindingView" },
        "computed": { "name": "ComputedSignals", "id": "computedView" },
        "programmatic": { "name": "ProgrammaticAccess", "id": "programmaticView" },
        "strict": { "name": "StrictMode", "id": "strictModeView" },
        "comparison": { "name": "Comparison", "id": "comparisonView" }
      }
    }
  }
}
```

- [ ] **Step 5: Create index.html**

Create `packages/demo-app/webapp/index.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>SignalModel Demo</title>
    <script
      id="sap-ui-bootstrap"
      src="resources/sap-ui-core.js"
      data-sap-ui-theme="sap_horizon"
      data-sap-ui-resource-roots='{ "demo.app": "./" }'
      data-sap-ui-compat-version="edge"
      data-sap-ui-async="true"
      data-sap-ui-on-init="module:sap/ui/core/ComponentSupport"
    ></script>
  </head>
  <body class="sapUiBody" id="content">
    <div
      data-sap-ui-component
      data-name="demo.app"
      data-id="container"
      data-settings='{ "id": "demo.app" }'
    ></div>
  </body>
</html>
```

- [ ] **Step 6: Create Component.ts**

Create `packages/demo-app/webapp/Component.ts`:

```typescript
import UIComponent from "sap/ui/core/UIComponent";
import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";
import { getSampleData } from "./model/sampleData";

/**
 * @namespace demo.app
 */
export default class Component extends UIComponent {
  public static metadata = {
    manifest: "json",
    interfaces: ["sap.ui.core.IAsyncContentCreation"],
  };

  override init(): void {
    super.init();

    const signalModel = new SignalModel(getSampleData());
    this.setModel(signalModel);

    const jsonModel = new JSONModel(getSampleData());
    this.setModel(jsonModel, "json");

    this.getRouter().initialize();
  }
}
```

- [ ] **Step 7: Create sample data**

Create `packages/demo-app/webapp/model/sampleData.ts`:

```typescript
export interface SampleData {
  firstName: string;
  lastName: string;
  age: number;
  email: string;
  items: Array<{
    id: number;
    name: string;
    price: number;
    active: boolean;
  }>;
}

export function getSampleData(): SampleData {
  return {
    firstName: "Alice",
    lastName: "Smith",
    age: 28,
    email: "alice@example.com",
    items: [
      { id: 1, name: "Widget A", price: 29.99, active: true },
      { id: 2, name: "Widget B", price: 49.99, active: false },
      { id: 3, name: "Widget C", price: 19.99, active: true },
      { id: 4, name: "Gadget D", price: 99.99, active: true },
      { id: 5, name: "Gadget E", price: 14.99, active: false },
    ],
  };
}
```

- [ ] **Step 8: Create App.view.xml (shell with navigation)**

Create `packages/demo-app/webapp/view/App.view.xml`:

```xml
<mvc:View
	xmlns:mvc="sap.ui.core"
	xmlns="sap.m"
	displayBlock="true">
	<Shell>
		<App id="appContainer">
			<pages>
				<Page title="SignalModel Demo" enableScrolling="true">
					<headerContent>
						<SegmentedButton selectedKey="propertyBinding" selectionChange=".onNavChange">
							<items>
								<SegmentedButtonItem key="propertyBinding" text="Properties" />
								<SegmentedButtonItem key="listBinding" text="List" />
								<SegmentedButtonItem key="computed" text="Computed" />
								<SegmentedButtonItem key="programmatic" text="Programmatic" />
								<SegmentedButtonItem key="strict" text="Strict" />
								<SegmentedButtonItem key="comparison" text="Comparison" />
							</items>
						</SegmentedButton>
					</headerContent>
					<NavContainer id="appContainer" />
				</Page>
			</pages>
		</App>
	</Shell>
</mvc:View>
```

- [ ] **Step 9: Reinstall dependencies and verify**

```bash
cd C:/Users/m.beier/Documents/dev/ui5-lib-signal-model
npm install
npm run start
```

Expected: app loads without errors, shows the shell with navigation.

- [ ] **Step 10: Commit**

```bash
git add packages/demo-app
git commit -m "chore: scaffold demo application with navigation and sample data"
```

---

### Task 13: Demo App Views and Controllers

**Files:**

- Create: `packages/demo-app/webapp/view/PropertyBinding.view.xml`
- Create: `packages/demo-app/webapp/controller/PropertyBinding.controller.ts`
- Create: `packages/demo-app/webapp/view/ListBinding.view.xml`
- Create: `packages/demo-app/webapp/controller/ListBinding.controller.ts`
- Create: `packages/demo-app/webapp/view/ComputedSignals.view.xml`
- Create: `packages/demo-app/webapp/controller/ComputedSignals.controller.ts`
- Create: `packages/demo-app/webapp/view/ProgrammaticAccess.view.xml`
- Create: `packages/demo-app/webapp/controller/ProgrammaticAccess.controller.ts`
- Create: `packages/demo-app/webapp/view/StrictMode.view.xml`
- Create: `packages/demo-app/webapp/controller/StrictMode.controller.ts`
- Create: `packages/demo-app/webapp/view/Comparison.view.xml`
- Create: `packages/demo-app/webapp/controller/Comparison.controller.ts`

- [ ] **Step 1: Property Binding view and controller**

Create `packages/demo-app/webapp/view/PropertyBinding.view.xml`:

```xml
<mvc:View
	controllerName="demo.app.controller.PropertyBinding"
	xmlns:mvc="sap.ui.core"
	xmlns="sap.m"
	xmlns:f="sap.ui.layout.form">
	<Panel headerText="Property Binding Demo">
		<f:SimpleForm editable="true" layout="ResponsiveGridLayout">
			<Label text="First Name" />
			<Input value="{/firstName}" />
			<Label text="Last Name" />
			<Input value="{/lastName}" />
			<Label text="Age" />
			<Input value="{/age}" type="Number" />
			<Label text="Email" />
			<Input value="{/email}" />
		</f:SimpleForm>
		<Panel headerText="Live Values (read-only bindings)">
			<HBox class="sapUiSmallMargin">
				<VBox class="sapUiSmallMarginEnd">
					<Label text="First Name:" />
					<Text text="{/firstName}" />
				</VBox>
				<VBox class="sapUiSmallMarginEnd">
					<Label text="Last Name:" />
					<Text text="{/lastName}" />
				</VBox>
				<VBox class="sapUiSmallMarginEnd">
					<Label text="Age:" />
					<Text text="{/age}" />
				</VBox>
				<VBox>
					<Label text="Email:" />
					<Text text="{/email}" />
				</VBox>
			</HBox>
		</Panel>
		<Button text="Reset to defaults" press=".onReset" class="sapUiSmallMargin" />
	</Panel>
</mvc:View>
```

Create `packages/demo-app/webapp/controller/PropertyBinding.controller.ts`:

```typescript
import Controller from "sap/ui/core/mvc/Controller";
import SignalModel from "ui5/model/signal/SignalModel";
import { getSampleData } from "../model/sampleData";

/**
 * @namespace demo.app.controller
 */
export default class PropertyBinding extends Controller {
  onReset(): void {
    const model = this.getView()!.getModel() as SignalModel;
    const data = getSampleData();
    model.setProperty("/firstName", data.firstName);
    model.setProperty("/lastName", data.lastName);
    model.setProperty("/age", data.age);
    model.setProperty("/email", data.email);
  }
}
```

- [ ] **Step 2: List Binding view and controller**

Create `packages/demo-app/webapp/view/ListBinding.view.xml`:

```xml
<mvc:View
	controllerName="demo.app.controller.ListBinding"
	xmlns:mvc="sap.ui.core"
	xmlns="sap.m">
	<Panel headerText="List Binding Demo">
		<Toolbar>
			<SearchField placeholder="Filter by name..." liveChange=".onFilter" width="300px" />
			<ToolbarSpacer />
			<Button text="Sort by Name" press=".onSortName" />
			<Button text="Sort by Price" press=".onSortPrice" />
			<Button text="Clear Sort" press=".onClearSort" />
		</Toolbar>
		<Table items="{/items}">
			<columns>
				<Column><Text text="ID" /></Column>
				<Column><Text text="Name" /></Column>
				<Column><Text text="Price" /></Column>
				<Column><Text text="Active" /></Column>
			</columns>
			<items>
				<ColumnListItem>
					<Text text="{id}" />
					<Text text="{name}" />
					<ObjectNumber number="{price}" unit="EUR" />
					<Switch state="{active}" />
				</ColumnListItem>
			</items>
		</Table>
		<Button text="Add Item" press=".onAddItem" class="sapUiSmallMargin" />
	</Panel>
</mvc:View>
```

Create `packages/demo-app/webapp/controller/ListBinding.controller.ts`:

```typescript
import Controller from "sap/ui/core/mvc/Controller";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";
import SignalModel from "ui5/model/signal/SignalModel";
import type Table from "sap/m/Table";
import type SearchField from "sap/m/SearchField";

/**
 * @namespace demo.app.controller
 */
export default class ListBinding extends Controller {
  onFilter(oEvent: { getSource: () => SearchField }): void {
    const sQuery = oEvent.getSource().getValue();
    const table = this.byId("table") as Table;
    const binding = table.getBinding("items")!;

    const filters = sQuery ? [new Filter("name", FilterOperator.Contains, sQuery)] : [];
    binding.filter(filters);
  }

  onSortName(): void {
    const table = this.byId("table") as Table;
    table.getBinding("items")!.sort(new Sorter("name"));
  }

  onSortPrice(): void {
    const table = this.byId("table") as Table;
    table.getBinding("items")!.sort(new Sorter("price"));
  }

  onClearSort(): void {
    const table = this.byId("table") as Table;
    table.getBinding("items")!.sort([]);
  }

  onAddItem(): void {
    const model = this.getView()!.getModel() as SignalModel;
    const items = model.getProperty("/items") as unknown[];
    const newId = items.length + 1;
    items.push({ id: newId, name: `New Item ${newId}`, price: 9.99, active: true });
    model.setProperty("/items", [...items]);
  }
}
```

- [ ] **Step 3: Computed Signals view and controller**

Create `packages/demo-app/webapp/view/ComputedSignals.view.xml`:

```xml
<mvc:View
	controllerName="demo.app.controller.ComputedSignals"
	xmlns:mvc="sap.ui.core"
	xmlns="sap.m"
	xmlns:f="sap.ui.layout.form">
	<Panel headerText="Computed Signals Demo">
		<f:SimpleForm editable="true" layout="ResponsiveGridLayout">
			<Label text="First Name" />
			<Input value="{/firstName}" />
			<Label text="Last Name" />
			<Input value="{/lastName}" />
			<Label text="Full Name (computed)" />
			<Text text="{/fullName}" />
			<Label text="Age" />
			<Input value="{/age}" type="Number" />
			<Label text="Birth Year (computed)" />
			<Text text="{/birthYear}" />
		</f:SimpleForm>
		<MessageStrip
			text="fullName and birthYear are computed signals -- they update automatically when their dependencies change."
			type="Information"
			class="sapUiSmallMargin" />
	</Panel>
</mvc:View>
```

Create `packages/demo-app/webapp/controller/ComputedSignals.controller.ts`:

```typescript
import Controller from "sap/ui/core/mvc/Controller";
import SignalModel from "ui5/model/signal/SignalModel";

/**
 * @namespace demo.app.controller
 */
export default class ComputedSignals extends Controller {
  override onInit(): void {
    const model = this.getView()!.getModel() as SignalModel;

    model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => {
      return `${first} ${last}`;
    });

    model.createComputed("/birthYear", ["/age"], (age) => {
      return new Date().getFullYear() - (age as number);
    });
  }
}
```

- [ ] **Step 4: Programmatic Access view and controller**

Create `packages/demo-app/webapp/view/ProgrammaticAccess.view.xml`:

```xml
<mvc:View
	controllerName="demo.app.controller.ProgrammaticAccess"
	xmlns:mvc="sap.ui.core"
	xmlns="sap.m">
	<Panel headerText="Programmatic Signal Access">
		<VBox class="sapUiSmallMargin">
			<Label text="Current firstName signal value:" />
			<Text id="signalValue" text="(click Read Signal)" />
			<HBox class="sapUiSmallMarginTop">
				<Button text="Read Signal" press=".onReadSignal" class="sapUiSmallMarginEnd" />
				<Button text="Write Signal" press=".onWriteSignal" class="sapUiSmallMarginEnd" />
				<Input id="writeInput" placeholder="New value..." width="200px" />
			</HBox>
		</VBox>
		<MessageStrip
			text="getSignal() returns the underlying Signal.State object for direct programmatic access, bypassing the binding layer."
			type="Information"
			class="sapUiSmallMargin" />
	</Panel>
</mvc:View>
```

Create `packages/demo-app/webapp/controller/ProgrammaticAccess.controller.ts`:

```typescript
import Controller from "sap/ui/core/mvc/Controller";
import SignalModel from "ui5/model/signal/SignalModel";
import type Text from "sap/m/Text";
import type Input from "sap/m/Input";

/**
 * @namespace demo.app.controller
 */
export default class ProgrammaticAccess extends Controller {
  onReadSignal(): void {
    const model = this.getView()!.getModel() as SignalModel;
    const signal = model.getSignal("/firstName");
    const display = this.byId("signalValue") as Text;
    display.setText(String(signal.get()));
  }

  onWriteSignal(): void {
    const model = this.getView()!.getModel() as SignalModel;
    const input = this.byId("writeInput") as Input;
    const value = input.getValue();

    if (value) {
      const signal = model.getSignal("/firstName");
      signal.set(value);
      input.setValue("");
    }
  }
}
```

- [ ] **Step 5: Strict Mode view and controller**

Create `packages/demo-app/webapp/view/StrictMode.view.xml`:

```xml
<mvc:View
	controllerName="demo.app.controller.StrictMode"
	xmlns:mvc="sap.ui.core"
	xmlns="sap.m">
	<Panel headerText="Strict Mode Demo">
		<VBox class="sapUiSmallMargin">
			<HBox>
				<Input id="pathInput" placeholder="Path (e.g. /nonexistent)" width="300px" class="sapUiSmallMarginEnd" />
				<Input id="valueInput" placeholder="Value" width="200px" class="sapUiSmallMarginEnd" />
				<Button text="Set Property (strict)" press=".onSetStrict" type="Emphasized" />
			</HBox>
			<MessageStrip id="result" text="" type="None" class="sapUiSmallMarginTop" visible="false" />
		</VBox>
		<MessageStrip
			text="In strict mode, setProperty on a nonexistent path throws a TypeError. Try setting /nonexistent to see the error."
			type="Information"
			class="sapUiSmallMargin" />
	</Panel>
</mvc:View>
```

Create `packages/demo-app/webapp/controller/StrictMode.controller.ts`:

```typescript
import Controller from "sap/ui/core/mvc/Controller";
import SignalModel from "ui5/model/signal/SignalModel";
import type Input from "sap/m/Input";
import type MessageStrip from "sap/m/MessageStrip";

/**
 * @namespace demo.app.controller
 */
export default class StrictMode extends Controller {
  private strictModel: SignalModel | null = null;

  override onInit(): void {
    this.strictModel = new SignalModel({ name: "Alice", age: 28 }, { strict: true });
    this.getView()!.setModel(this.strictModel, "strict");
  }

  onSetStrict(): void {
    const path = (this.byId("pathInput") as Input).getValue();
    const value = (this.byId("valueInput") as Input).getValue();
    const result = this.byId("result") as MessageStrip;

    try {
      this.strictModel!.setProperty(path, value);
      result.setText(`Set "${path}" = "${value}"`);
      result.setType("Success");
    } catch (e) {
      result.setText(`Error: ${(e as Error).message}`);
      result.setType("Error");
    }
    result.setVisible(true);
  }

  override onExit(): void {
    this.strictModel?.destroy();
    this.strictModel = null;
  }
}
```

- [ ] **Step 6: Comparison view and controller (JSONModel vs SignalModel side-by-side)**

Create `packages/demo-app/webapp/view/Comparison.view.xml`:

```xml
<mvc:View
	controllerName="demo.app.controller.Comparison"
	xmlns:mvc="sap.ui.core"
	xmlns="sap.m"
	xmlns:f="sap.ui.layout.form"
	xmlns:l="sap.ui.layout">
	<Panel headerText="JSONModel vs SignalModel Comparison">
		<l:Grid defaultSpan="L6 M6 S12">
			<Panel headerText="SignalModel (default model)">
				<f:SimpleForm editable="true" layout="ResponsiveGridLayout">
					<Label text="First Name" />
					<Input value="{/firstName}" />
					<Label text="Last Name" />
					<Input value="{/lastName}" />
					<Label text="Value:" />
					<Text text="{/firstName} {/lastName}" />
				</f:SimpleForm>
			</Panel>
			<Panel headerText="JSONModel (named 'json')">
				<f:SimpleForm editable="true" layout="ResponsiveGridLayout">
					<Label text="First Name" />
					<Input value="{json>/firstName}" />
					<Label text="Last Name" />
					<Input value="{json>/lastName}" />
					<Label text="Value:" />
					<Text text="{json>/firstName} {json>/lastName}" />
				</f:SimpleForm>
			</Panel>
		</l:Grid>
		<MessageStrip
			text="Both models show identical behavior. Edit either side -- bindings update the same way. The difference is internal: SignalModel uses push-based signals, JSONModel uses poll-based checkUpdate."
			type="Information"
			class="sapUiSmallMargin" />
	</Panel>
</mvc:View>
```

Create `packages/demo-app/webapp/controller/Comparison.controller.ts`:

```typescript
import Controller from "sap/ui/core/mvc/Controller";

/**
 * @namespace demo.app.controller
 */
export default class Comparison extends Controller {}
```

- [ ] **Step 7: Verify demo app runs**

```bash
cd C:/Users/m.beier/Documents/dev/ui5-lib-signal-model
npm run start
```

Expected: demo app loads, all six pages work with navigation.

- [ ] **Step 8: Commit**

```bash
git add packages/demo-app/webapp/view packages/demo-app/webapp/controller
git commit -m "feat: implement demo app with all showcase pages"
```

---

### Task 14: README

**Files:**

- Create: `README.md`

- [ ] **Step 1: Write README with JSONModel comparison**

Create `README.md` at the monorepo root:

````markdown
# ui5-lib-signal-model

A reactive, signal-based UI5 model that is a drop-in replacement for JSONModel. Uses the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) polyfill internally, replacing poll-based `checkUpdate()` with push-based, path-specific signal notifications.

## Installation

```bash
npm install ui5-lib-signal-model
```
````

Add to your `ui5.yaml` dependencies and `manifest.json`:

```json
"sap.ui5": {
  "dependencies": {
    "libs": {
      "ui5.model.signal": {}
    }
  }
}
```

## Usage

```typescript
import SignalModel from "ui5/model/signal/SignalModel";

// Drop-in replacement for JSONModel
const model = new SignalModel({
  customer: { name: "Alice", age: 28 },
  orders: [],
});

// Works with standard XML view bindings
// {/customer/name}, {/orders}, etc.
```

## Feature Comparison: SignalModel vs JSONModel

| Feature                        | JSONModel                                                         | SignalModel                                                       |
| ------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Update mechanism**           | Poll-based: `checkUpdate()` iterates all bindings on every change | Push-based: only bindings to changed paths are notified           |
| **Notification granularity**   | O(n) on total bindings per `setProperty` call                     | O(1) for leaf writes, O(k) for branch writes (k = child bindings) |
| **Change detection**           | `deepEqual` comparison on every binding                           | Signal identity: no comparison needed                             |
| **Binding API**                | `{/path}` in XML views                                            | Identical: `{/path}` in XML views                                 |
| **setProperty / getProperty**  | Standard API                                                      | Same API, same signatures                                         |
| **setData (replace)**          | Replaces data, notifies all bindings                              | Replaces data, fires all signals                                  |
| **setData (merge)**            | Merges data, notifies all bindings                                | Merges data, fires only changed signals                           |
| **mergeProperty**              | Not available                                                     | Surgical merge at any path, fires only changed signals            |
| **Computed/derived values**    | Not available (use formatters)                                    | `createComputed("/path", deps, fn)` for model-layer derived state |
| **Programmatic signal access** | Not available                                                     | `getSignal("/path")` returns underlying Signal.State              |
| **Strict mode**                | Not available                                                     | `{ strict: true }` throws on nonexistent paths                    |
| **TypeScript generics**        | Via TypedJSONModel wrapper                                        | Built-in: `new SignalModel<T>(data)` with path autocompletion     |
| **Two-way binding**            | Supported                                                         | Supported (identical behavior)                                    |
| **List binding**               | Filter + Sort via FilterProcessor/SorterProcessor                 | Same (reuses ClientListBinding internals)                         |
| **Expression binding**         | Supported                                                         | Supported (benefits from push-based dependency notification)      |
| **TC39 Signals alignment**     | N/A                                                               | Uses signal-polyfill; swap for native Signal when spec ships      |

## API

### Constructor

```typescript
new SignalModel(data, options?)
// options: { strict?: boolean }
```

### JSONModel-Compatible Methods

```typescript
model.setProperty("/path", value)
model.getProperty("/path")
model.setData(data, merge?)
model.getData()
model.bindProperty("/path")
model.bindList("/path")
```

### Extended Methods

```typescript
// Merge writes (only fire changed paths)
model.mergeProperty("/customer", { age: 30 });

// Computed signals
model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => `${first} ${last}`);
model.removeComputed("/fullName");

// Direct signal access
const signal = model.getSignal("/path");
signal.get(); // read
signal.set(v); // write
```

## Development

```bash
npm install
npm run start       # demo app
npm run start:lib   # library dev server
npm run test:qunit  # run QUnit tests
npm run check       # lint + typecheck
```

## License

MIT

````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with API docs and JSONModel comparison"
````

---

## Self-Review Checklist

1. **Spec coverage:** All spec requirements mapped to tasks:
   - Drop-in JSONModel replacement: Task 7 (SignalModel core)
   - Push-based reactivity: Tasks 5-8 (registry, bindings, model)
   - TC39 alignment: Task 2 (signal-polyfill dependency)
   - TypeScript generics: Task 4 (types)
   - Computed signals: Task 9
   - mergeProperty: Task 10
   - Strict mode: Task 11
   - getSignal: Task 7
   - Demo app: Tasks 12-13
   - README comparison: Task 14

2. **Placeholder scan:** No TBDs, TODOs, or vague instructions. All code blocks are complete.

3. **Type consistency:** Method names match across tasks:
   - `_getOrCreateSignal` in SignalModel (Task 7) matches usage in SignalPropertyBinding (Task 6) and SignalListBinding (Task 8)
   - `SignalRegistry` API (getOrCreate, get, set, has, invalidateChildren, invalidateAll, addComputed, removeComputed, isComputed, destroy) consistent between Task 5 tests and implementation
   - `SignalModelOptions` type in Task 4 matches constructor usage in Task 7
