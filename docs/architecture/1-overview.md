# Overview

## Calling backend commands

Use the `call` helper to invoke Tauri backend commands:

```ts
import { call } from "../db/call";

const rows = await call<MyRow[]>("vehicles_list", { householdId });
```

Policy: **No direct `invoke()` outside `src/db/call.ts`.** All errors are normalised into the shared `ArkError` shape:

```ts
export type ArkError = {
  code: string;         // machine-usable e.g. "DB/NOT_FOUND", "IO/ENOENT", "VALIDATION"
  message: string;      // user-facing, safe to display
  details?: unknown;    // optional structured debug payload
};
```
