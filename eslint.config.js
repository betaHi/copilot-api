import config from "@echristian/eslint-config"
import markdown from "@eslint/markdown"
import { defineConfig } from "eslint/config"

const baseConfig = config({
  prettier: {
    plugins: ["prettier-plugin-packagejson"],
  },
}).map((entry) => ({
  ...entry,
  ignores: [...(entry.ignores ?? []), "**/*.md"],
}))

export default defineConfig([...baseConfig, ...markdown.configs.recommended])
