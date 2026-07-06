import security from "eslint-plugin-security";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
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
