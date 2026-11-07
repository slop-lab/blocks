import { execFileSync } from "node:child_process"

export const gitFixtureEnvironment = (): NodeJS.ProcessEnv => {
  const localVariables = new Set(
    execFileSync("git", ["rev-parse", "--local-env-vars"], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"], GIT_MASTER: "1" },
    })
      .trim()
      .split(/\r?\n/u),
  )
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !localVariables.has(name)),
    ),
    GIT_MASTER: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  }
}
