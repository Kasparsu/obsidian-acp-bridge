import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		plugins: { obsidianmd },
		rules: {
			"obsidianmd/ui/sentence-case": ["error", {
				acronyms: [
					"ACP", "API", "CLI", "HTTP", "HTTPS", "JSON", "JSON-RPC", "RPC",
					"MCP", "SDK", "URL", "URI", "UUID", "YAML",
				],
				brands: [
					"Obsidian", "Claude", "Claude Code", "Gemini", "Codex",
					"Cursor", "OpenCode", "Goose", "Markdown",
				],
				ignoreWords: ["CLAUDE.md", "paths:", "data.json"],
			}],
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
