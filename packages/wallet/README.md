# @admitto/wallet

Wallet pass domain boundary (ADR 0009): the `WalletPassProvider` interface, neutral domain types,
and the PassCreator HTTP client (ADR 0041) that implements it. The rest of Admitto depends on the
`WalletPassProvider` interface, not directly on PassCreator specifics.

## Key exports

```ts
import type {
  WalletPassProvider,
  WalletPassInput,
  WalletPassResult,
  PassCreatorConfig,
} from "@admitto/wallet";
import { WalletProviderError, PassCreatorClient } from "@admitto/wallet";
```

`WalletPassProvider` operations: `createPass`, `updatePass`, `voidPass`, `restorePass`,
`findByUserProvidedId`. `WalletProviderError` carries a stable `code` — callers branch on it, never on
`.message`.
