import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/**", "node_modules/**", "openapi.json"]),
  ...tseslint.configs.recommended,
  {
    rules: {
      // Nest controllers and Drizzle row objects both hand back `any` in
      // places the types cannot narrow; flag it, do not fail the build on it.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
]);
