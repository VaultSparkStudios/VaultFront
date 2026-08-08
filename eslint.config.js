import { includeIgnoreFile } from "@eslint/compat";
import pluginJs from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");

/** @type {import('eslint').Linter.Config[]} */
export default [
  includeIgnoreFile(gitignorePath),
  {
    ignores: [
      "src/server/gatekeeper/**",
      "tests/pathfinding/playground/**",
      "e2e/**",
    ],
  },
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "__mocks__/fileMock.js",
            "eslint.config.js",
            "scripts/sync-assets.mjs",
            "public/stats-theme.js",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Disable rules that would fail. The failures should be fixed, and the entries here removed.
      "@typescript-eslint/no-explicit-any": "off",
      "no-unused-vars": "off",
    },
  },
  {
    rules: {
      // Enable rules
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      eqeqeq: "error",
      "no-case-declarations": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "none",
          caughtErrors: "none",
        },
      ],
    },
  },
  // Require that new TODO/FIXME comments reference a GitHub issue number.
  // Pattern: "TODO(#123):" or "FIXME(#123):"
  // Legacy upstream TODOs without issue refs are grandfathered — only VaultFront-owned files enforce this.
  {
    files: [
      "src/core/execution/Vault*.ts",
      "src/client/graphics/layers/VaultFront*.ts",
      "src/client/BrandTheme.ts",
    ],
    rules: {
      "no-warning-comments": [
        "warn",
        {
          terms: ["TODO", "FIXME", "HACK", "XXX"],
          location: "anywhere",
          decoration: ["/", "*"],
        },
      ],
    },
  },
  // VaultFront-owned files: enforce strict typing rules upstream files are exempt from
  {
    files: [
      "src/core/execution/VaultFrontExecution.ts",
      "src/core/execution/VaultConvoyCommandExecution.ts",
      "src/core/execution/VaultRolePingExecution.ts",
      "src/client/graphics/layers/VaultFrontLayer.ts",
      "src/client/BrandTheme.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/shared/**/*.mjs"],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      "@typescript-eslint/prefer-nullish-coalescing": "off",
    },
  },
  {
    files: ["scripts/**/*.{mjs,cjs}"],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      // Ops scripts are not subject to strict style rules
      "no-empty": "off",
      "no-useless-escape": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      eqeqeq: "off",
    },
  },
];
