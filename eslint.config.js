import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import astro from "eslint-plugin-astro";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    ".astro/**",
    ".lighthouse-reports/**",
    ".media-work/**",
    "coverage/**",
    "dist/**",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs["flat/recommended"],
  {
    files: ["src/**/*.{js,ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["src/**/*.tsx"],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ["scripts/**/*.{js,mjs}", "*.config.{js,mjs,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["tests/**/*.{js,ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ["**/*.{ts,tsx}", "**/*.astro/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
]);
