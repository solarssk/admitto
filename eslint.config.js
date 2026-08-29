import security from "eslint-plugin-security";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

// @typescript-eslint/eslint-plugin adoption (chore/adopt-typescript-eslint-plugin): the parser was
// already a dependency (used to make ESLint understand TS/TSX syntax), but no plugin was wired in,
// so no @typescript-eslint/* rule ever actually ran — including the rule named by the repo's own
// `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments. Started on the
// non-type-checked `recommended` rule set only; `recommended-type-checked` / `strict-type-checked`
// (and therefore `no-floating-promises`) need a heavier type-aware lint setup this repo doesn't
// have yet, so those stay out of scope for now. `npm run lint` came back with 20 total violations
// under `recommended` across apps/*/src and packages/*/src, all `no-unused-vars` and all
// mechanical, so every rule ships at its recommended "error" severity — nothing had to be
// downgraded to "warn". Two `no-unused-vars` options were added (not a severity change) to match
// conventions already established in this codebase before this plugin existed:
//   - ignoreRestSiblings: covers `const { a, b, ...rest } = x` where a/b are destructured only to
//     exclude them from `rest` (e.g. omitWalletSettings in apps/web/src/admin/admin-api-routes.ts).
//   - argsIgnorePattern / varsIgnorePattern / caughtErrorsIgnorePattern: "^_" matches this repo's
//     existing prefix for intentionally-unused bindings (already used 50+ times pre-plugin).
const tsUnusedVarsOptions = {
  argsIgnorePattern: "^_",
  varsIgnorePattern: "^_",
  caughtErrorsIgnorePattern: "^_",
  ignoreRestSiblings: true,
};

// Shared by packages/ui's own *.tsx files and every apps/*/src file below — both are React/TSX,
// so the plugin set, parser options, and rule list were byte-for-byte identical two ways (only
// `files` differed), which is exactly what SonarCloud's new-code duplication gate flagged. One
// definition, two `files` globs, rather than two copies drifting apart later.
const reactTsxConfig = {
  plugins: {
    security,
    "@typescript-eslint": tsPlugin,
    "react-hooks": reactHooks,
  },
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
  rules: {
    ...security.configs.recommended.rules,
    ...tsPlugin.configs.recommended.rules,
    "@typescript-eslint/no-unused-vars": ["error", tsUnusedVarsOptions],
    // Typed records, React state, and route params — false positives.
    "security/detect-object-injection": "off",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
  },
};

export default [
  {
    // Prisma's `prisma-client` generator emits raw, uncompiled TypeScript directly into
    // packages/db/src/generated — treat it as build output, not source to lint.
    ignores: ["packages/*/src/generated/**"],
  },
  {
    files: ["packages/*/src/**/*.ts"],
    plugins: { security, "@typescript-eslint": tsPlugin },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      ...security.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", tsUnusedVarsOptions],
    },
  },
  {
    // packages/ui is a React component library — same shape as apps/*/src below.
    files: ["packages/*/src/**/*.tsx"],
    ...reactTsxConfig,
  },
  {
    files: ["apps/*/src/**/*.{ts,tsx}"],
    ...reactTsxConfig,
  },
];
