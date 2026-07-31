---
name: Orval codegen zod index fix
description: Orval regenerates api-zod/src/index.ts on every codegen run, causing TS2308 duplicate-export errors
---

## Problem
Orval's `zod` output config with `mode: "split"` regenerates `lib/api-zod/src/index.ts` on every run.
It appends `export * from './generated/types'` — but the `schemas` option was removed from orval.config.ts
so that folder no longer exists, causing TS2308 / module-not-found errors.

## Fix
`lib/api-spec/fix-zod-index.mjs` runs after orval and overwrites the index to export only from `./generated/api`:
```
export * from "./generated/api";
```
The codegen script in `lib/api-spec/package.json` is:
```
orval --config ./orval.config.ts && node fix-zod-index.mjs && pnpm -w run typecheck:libs
```

**Why:** The `schemas: { path: "generated/types", type: "typescript" }` option was removed from orval.config.ts
because it generated TypeScript interface types with identical names to the Zod validators, causing TS2308
ambiguity when both were re-exported from index.ts. Zod validators already provide full type inference via z.infer.

**How to apply:** If codegen ever fails with TS2308 on `StockDetailParams` or similar, check that fix-zod-index.mjs
is still in the codegen script and that api-zod/src/index.ts only has one export line.
