import security from "eslint-plugin-security";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

// @typescript-eslint/eslint-plugin adoption (chore/adopt-typescript-eslint-plugin): the parser was
// already a dependency (used to make ESLint understand TS/TSX syntax), but no plugin was wired in,
// so no @typescript-eslint/* rule ever actually ran — including the rule named by the repo's own
// `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments. Started on the
// non-type-checked `recommended` rule set only. `npm run lint` came back with 20 total violations
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

// chore/eslint-type-aware: switched from `recommended` to `recommended-type-checked`, which needs
// real type info (parserOptions.projectService below) and adds real async/type-safety rules
// `recommended` couldn't run at all. The mechanical, `--fix`-able finding
// (no-unnecessary-type-assertion, 72 instances) is already fixed and stays at its recommended
// "error" severity. The rules below found real, pre-existing issues (133 errors across ~50 files:
// mostly no-misused-promises / no-floating-promises in mail/webhook/export code, plus
// no-unsafe-assignment/return/member-access/argument/call where external data crosses a type
// boundary untyped) that needed one-by-one review, not a blind bulk fix — so they first shipped as
// "warn" behind the warning baseline (scripts/eslint-warning-baseline.mjs) and each moved to
// "error" once its own findings reached zero. All of them are now "error".
const typeAwareFollowUpRules = {
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/require-await": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/only-throw-error": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/restrict-template-expressions": "error",
  "@typescript-eslint/no-base-to-string": "error",
  "@typescript-eslint/unbound-method": "error",
  "@typescript-eslint/prefer-promise-reject-errors": "error",
  "@typescript-eslint/no-unsafe-call": "error",
};

// The only remaining uses are audited, module-relative build-time assets with narrow local
// suppressions. New dynamic filesystem filenames must now fail lint rather than add debt.
// `detect-object-injection` is an error for packages/*/src/**/*.ts too (the React/TSX config
// below keeps it off): the two computed-key lookups left there read from a fixed key set and each
// carries a narrow local suppression saying which one.
const securityFollowUpRules = {
  "security/detect-non-literal-fs-filename": "error",
  "security/detect-object-injection": "error",
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
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    ...security.configs.recommended.rules,
    ...tsPlugin.configs["recommended-type-checked"].rules,
    ...typeAwareFollowUpRules,
    ...securityFollowUpRules,
    "@typescript-eslint/no-unused-vars": ["error", tsUnusedVarsOptions],
    // Typed records, React state, and route params — false positives.
    "security/detect-object-injection": "off",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "error",
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
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...security.configs.recommended.rules,
      ...tsPlugin.configs["recommended-type-checked"].rules,
      ...typeAwareFollowUpRules,
      ...securityFollowUpRules,
      "@typescript-eslint/no-unused-vars": ["error", tsUnusedVarsOptions],
    },
  },
  {
    // Importing bare "@admitto/db" runtime-executes packages/db/src/index.ts, which constructs a
    // live PrismaClient singleton at module load time — every unit test file that imports
    // @admitto/auth (even just for a type or for hasScope/isSerializationFailure) then pays that
    // construction cost, real or not. cli.ts is excluded: it's a genuine CLI entrypoint that needs
    // the actual `prisma` singleton. Type-only imports stay allowed (allowTypeImports) since they're
    // erased at compile time and never trigger the side effect regardless of source module.
    files: ["packages/auth/src/**/*.ts"],
    ignores: ["packages/auth/src/cli.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@admitto/db",
              message:
                "Use '@admitto/db/client' for Prisma types, '@admitto/db/roles' for hasScope, or '@admitto/db/errors' for isSerializationFailure — the bare barrel constructs a live PrismaClient at import time.",
              allowTypeImports: true,
            },
          ],
        },
      ],
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
