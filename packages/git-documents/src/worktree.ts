import { createHash } from "node:crypto"
import { mkdir, realpath } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { GitDocumentsError } from "./errors.js"
import { runGit } from "./git.js"
import { branchName } from "./validation.js"

type WorktreeOptions = {
  readonly repo: string
  readonly data?: string
  readonly branch?: string
}

const registeredWorktrees = (output: string) => {
  const records: { path: string; branch: string | null }[] = []
  let path: string | null = null
  let branch: string | null = null
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice(9)
    else if (line.startsWith("branch refs/heads/")) branch = line.slice(18)
    else if (line === "" && path !== null) {
      records.push({ path, branch })
      path = null
      branch = null
    }
  }
  return records
}

export const prepareWorktree = async (options: WorktreeOptions) => {
  const requestedRepo = await realpath(resolve(options.repo))
  const rootResult = await runGit({ cwd: requestedRepo, args: ["rev-parse", "--show-toplevel"] })
  const repo = await realpath(rootResult.stdout.trim())
  const bare = await runGit({ cwd: repo, args: ["rev-parse", "--is-bare-repository"] })
  if (bare.stdout.trim() !== "false")
    throw new GitDocumentsError("invalid_repository", "A non-bare source repository is required")
  const branch = branchName(options.branch ?? "block-docs")
  const data = resolve(options.data ?? join(repo, ".runtime", "git-documents"))
  const repoId = createHash("sha256").update(repo).digest("hex").slice(0, 16)
  const worktree = join(data, "worktrees", repoId, branch.replaceAll("/", "--"))
  const listing = await runGit({ cwd: repo, args: ["worktree", "list", "--porcelain"] })
  const registered = registeredWorktrees(listing.stdout).find(
    (item) => resolve(item.path) === worktree,
  )
  if (registered !== undefined) {
    if (registered.branch !== branch)
      throw new GitDocumentsError(
        "invalid_repository",
        "Managed worktree is registered to another branch",
      )
    return { repo, data, branch, worktree, repoId }
  }
  const occupied = registeredWorktrees(listing.stdout).find((item) => item.branch === branch)
  if (occupied !== undefined)
    throw new GitDocumentsError(
      "invalid_repository",
      `Branch ${branch} is already checked out outside the managed worktree`,
      { path: occupied.path },
    )
  await mkdir(dirname(worktree), { recursive: true })
  const exists = await runGit({
    cwd: repo,
    args: ["show-ref", "--verify", `refs/heads/${branch}`],
    allowFailure: true,
  })
  await runGit({
    cwd: repo,
    args:
      exists.code === 0
        ? ["worktree", "add", worktree, branch]
        : ["worktree", "add", "-b", branch, worktree, "HEAD"],
  })
  return { repo, data, branch, worktree, repoId }
}
