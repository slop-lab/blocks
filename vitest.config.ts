import { mergeConfig } from "vite"
import { defineConfig } from "vitest/config"
import viteConfig from "./vite.config"

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      poolOptions: {
        forks: { execArgv: ["--no-experimental-webstorage"] },
        threads: { execArgv: ["--no-experimental-webstorage"] },
      },
    },
  }),
)
