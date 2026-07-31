// Post-process: orval regenerates api-zod/src/index.ts with a stale
// `export * from './generated/types'` line. After removing the `schemas`
// option from orval.config.ts the types/ folder is gone, so we overwrite
// the barrel with the correct single-export.
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(__dirname, "../api-zod/src/index.ts");

writeFileSync(
  indexPath,
  `// Auto-fixed by fix-zod-index.mjs after orval codegen.
// Export only Zod validators. TypeScript types are inferred via z.infer<typeof Schema>.
// Do NOT re-export from ./generated/types — that folder is intentionally absent.
export * from "./generated/api";
`,
);
console.log("✔ Fixed lib/api-zod/src/index.ts");
