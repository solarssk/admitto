# @admitto/shared

Neutral, dependency-free helpers shared across workspace packages. Keep this package tiny — no DB, no crypto, no framework imports.

## Exports

| Function | Purpose |
|----------|---------|
| `splitCsvLine(line)` | RFC-style CSV line split with quoted fields (used by `@admitto/import`) |

## Import

```ts
import { splitCsvLine } from "@admitto/shared";
```

## Build

```bash
npm run build -w @admitto/shared
```

Other packages depend on the compiled `dist/` output via workspace `prepare` hooks.
