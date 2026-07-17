import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

export default defineConfig(
  ...nextVitals,
  ...tseslint.configs.recommended,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "src/generated/**",
    "coverage/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error"
    }
  }
);
