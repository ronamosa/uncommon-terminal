import tsparser from "@typescript-eslint/parser";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default tseslint.config(
    { ignores: ["main.js", "version-bump.mjs", "esbuild.config.mjs"] },
    ...obsidianmd.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: { project: "./tsconfig.json" },
            globals: {
                ...globals.browser,
                ...globals.node,
                // Obsidian exposes these for pop-out windows, where `document`
                // and `window` point at the wrong one.
                activeDocument: "readonly",
                activeWindow: "readonly",
            },
        },
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "obsidianmd/ui/sentence-case": [
                "error",
                {
                    brands: ["Ghostty", "JetBrains", "Obsidian", "Python", "Uncommon Terminal"],
                    acronyms: ["PTY", "TUI", "UI"],
                    enforceCamelCaseLower: true,
                },
            ],
        },
    },
    {
        // node:test's describe/it return promises that are never meant to be
        // awaited, and test files are not Obsidian UI.
        files: ["tests/**/*.ts"],
        rules: {
            "@typescript-eslint/no-floating-promises": "off",
            "obsidianmd/ui/sentence-case": "off",
        },
    },
);
