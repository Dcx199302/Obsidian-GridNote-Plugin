import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, "./tests/mocks/obsidian/index.ts"),
		},
	},
	test: {
		globals: true,
		environment: "node",
		include: ["tests/**/*.test.ts"],
		exclude: ["node_modules", "dist", "demo", "reference", "coverage"],
		setupFiles: ["./tests/setup.ts"],
	},
});
