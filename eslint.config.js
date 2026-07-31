import security from "eslint-plugin-security";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    // Prisma's `prisma-client` generator emits raw, uncompiled TypeScript directly into
    // packages/db/src/generated — treat it as build output, not source to lint.
    ignores: ["packages/*/src/generated/**"],
  },
  {
    files: ["packages/*/src/**/*.ts"],
    plugins: { security },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      ...security.configs.recommended.rules,
    },
  },
  {
    // packages/ui is a React component library — same shape as apps/*/src below.
    files: ["packages/*/src/**/*.tsx"],
    plugins: {
      security,
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
      // Typed records, React state, and route params — false positives (same as apps/*).
      "security/detect-object-injection": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["apps/*/src/**/*.{ts,tsx}"],
    plugins: {
      security,
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
      // Typed records, React state, and route params — false positives (same as packages/*).
      "security/detect-object-injection": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
