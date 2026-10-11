import { execFile } from "node:child_process"
import { GitDocumentsError } from "./errors.js"

type GitResult = { readonly stdout: string; readonly stderr: string; readonly code: number }
type GitOptions = {
  readonly cwd: string
  readonly args: readonly string[]
  readonly allowFailure?: boolean
  readonly author?: { readonly name: string; readonly email: string }
}

const gitArgs = ["-c", "core.hooksPath=/dev/null", "-c", "core.quotePath=false"] as const

export const runGit = async (options: GitOptions): Promise<GitResult> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    ...(options.author === undefined
      ? {}
      : {
          GIT_AUTHOR_NAME: options.author.name,
          GIT_AUTHOR_EMAIL: options.author.email,
          GIT_COMMITTER_NAME: options.author.name,
          GIT_COMMITTER_EMAIL: options.author.email,
        }),
  }
  try {
    return await new Promise((resolve, reject) => {
      execFile(
        "git",
        [...gitArgs, ...options.args],
        {
          cwd: options.cwd,
          env,
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024,
          signal: controller.signal,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ stdout, stderr, code: 0 })
            return
          }
          if (options.allowFailure === true) {
            resolve({ stdout, stderr, code: typeof error.code === "number" ? error.code : 1 })
            return
          }
          reject(
            new GitDocumentsError(
              "git_failed",
              stderr.trim() || "Git operation failed",
              { operation: options.args[0] ?? "unknown" },
              { cause: error },
            ),
          )
        },
      )
    })
  } finally {
    clearTimeout(timeout)
  }
}
