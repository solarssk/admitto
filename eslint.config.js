import security from "eslint-plugin-security";
import tsParser from "@typescript-eslint/parser";

export default [
  security.configs.recommended,
  {
    files: ["packages/*/src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
];
