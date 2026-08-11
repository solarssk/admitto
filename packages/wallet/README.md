# @admitto/wallet

Wallet pass domain boundary (ADR 0009): the `WalletPassProvider` interface and neutral domain types.
The rest of Admitto depends only on this interface, never on a concrete provider.

No implementation lives here — the first concrete provider is PassCreator (ADR 0041), implemented as
`@admitto/passcreator` (or equivalent) in a later PR.

## Key exports

```ts
import type {
  WalletPassProvider,
  WalletPassInput,
  WalletPassResult,
} from "@admitto/wallet";
import { WalletProviderError } from "@admitto/wallet";
```

`WalletPassProvider` operations: `createPass`, `updatePass`, `voidPass`, `restorePass`,
`findByUserProvidedId`. `WalletProviderError` carries a stable `code` — callers branch on it, never on
`.message`.
