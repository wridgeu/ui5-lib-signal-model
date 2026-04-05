# Oxlint: Stricter Type Safety Rules

## Approach

Add native oxlint `typescript/*` rules to `.oxlintrc.json`. No custom JS plugins needed -- all rules are built-in.

## Rules

| Rule                                  | Severity | Rationale                                           |
| ------------------------------------- | -------- | --------------------------------------------------- |
| `typescript/no-explicit-any`          | `error`  | Disallow explicit `any` type annotations            |
| `typescript/no-non-null-assertion`    | `warn`   | Discourage `!` postfix operator                     |
| `typescript/consistent-type-imports`  | `error`  | Already followed in source -- codify the convention |
| `typescript/no-unsafe-type-assertion` | `warn`   | Catch unsafe casts like `as any`                    |

## Test Overrides

Relaxed severities in the existing `overrides` block for `packages/*/test/**/*.ts`:

| Rule                                  | Severity | Rationale                                                                               |
| ------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `typescript/no-explicit-any`          | `warn`   | Tests need `any` for upstream workarounds (`unbindElement`, `sap.ui.require` callbacks) |
| `typescript/no-non-null-assertion`    | `off`    | `ctx!` and `createBindingContext(...)!` are pervasive and harmless in tests             |
| `typescript/no-unsafe-type-assertion` | `off`    | Tests intentionally cast for invalid-input scenarios                                    |

## Source Code Changes

`SignalModel.ts` lines 404, 421, 440 -- add `// oxlint-ignore-next-line typescript/no-explicit-any` on the three `SignalModel<any>` occurrences. These are inside `as unknown as new (...)` constructor casts to work around protected constructors in UI5 type stubs.

No test file changes needed -- the overrides handle severity levels.

## Existing Config Preserved

All current rules and settings in `.oxlintrc.json` remain unchanged. The new rules are additive.
