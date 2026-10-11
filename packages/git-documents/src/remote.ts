import { GitDocumentsError } from "./errors.js"
import { runGit } from "./git.js"
import type { MergeResult, RemoteStatus } from "./types.js"

type RemoteContext = {
  readonly worktree: string
  readonly branch: string
  readonly remote: "origin"
  readonly isClean: () => Promise<boolean>
  readonly conflicts: () => Promise<readonly string[]>
  readonly author?: { readonly name: string; readonly email: string }
  readonly docs: string
}

export class RemoteOperations {
  constructor(private readonly context: RemoteContext) {}

  async fetch(): Promise<void> {
    const remote = await runGit({
      cwd: this.context.worktree,
      args: ["remote", "get-url", this.context.remote],
      allowFailure: true,
    })
    if (remote.code !== 0)
      throw new GitDocumentsError("remote_unavailable", "Configured origin remote is unavailable")
    await runGit({ cwd: this.context.worktree, args: ["fetch", "--prune", this.context.remote] })
  }

  async status(): Promise<RemoteStatus> {
    const tracking = `${this.context.remote}/${this.context.branch}`
    const exists = await runGit({
      cwd: this.context.worktree,
      args: ["show-ref", "--verify", `refs/remotes/${tracking}`],
      allowFailure: true,
    })
    if (exists.code !== 0)
      return {
        remote: this.context.remote,
        branch: this.context.branch,
        ahead: 0,
        behind: 0,
        state: "untracked",
      }
    const result = await runGit({
      cwd: this.context.worktree,
      args: ["rev-list", "--left-right", "--count", `HEAD...${tracking}`],
    })
    const [aheadText = "0", behindText = "0"] = result.stdout.trim().split(/\s+/u)
    const ahead = Number(aheadText)
    const behind = Number(behindText)
    const state =
      ahead > 0 && behind > 0 ? "diverged" : ahead > 0 ? "ahead" : behind > 0 ? "behind" : "current"
    return { remote: this.context.remote, branch: this.context.branch, ahead, behind, state }
  }

  async fastForward(): Promise<RemoteStatus> {
    if (!(await this.context.isClean()))
      throw new GitDocumentsError(
        "dirty_worktree",
        "Save or commit document changes before syncing",
      )
    const status = await this.status()
    if (status.state === "diverged")
      throw new GitDocumentsError("diverged", "Local and remote branches have diverged", {
        ahead: status.ahead,
        behind: status.behind,
      })
    if (status.state === "behind")
      await runGit({
        cwd: this.context.worktree,
        args: ["merge", "--ff-only", `${this.context.remote}/${this.context.branch}`],
      })
    return this.status()
  }

  async push(): Promise<RemoteStatus> {
    const status = await this.status()
    if (status.state === "diverged" || status.behind > 0)
      throw new GitDocumentsError("diverged", "Fetch and resolve remote changes before pushing")
    await runGit({
      cwd: this.context.worktree,
      args: ["push", "-u", this.context.remote, `HEAD:refs/heads/${this.context.branch}`],
    })
    return this.status()
  }

  async merge(): Promise<MergeResult> {
    if (!(await this.context.isClean()))
      throw new GitDocumentsError(
        "dirty_worktree",
        "Save or commit document changes before merging",
      )
    const status = await this.status()
    if (status.state !== "diverged")
      throw new GitDocumentsError("diverged", "A merge is available only for diverged branches")
    const result = await runGit({
      cwd: this.context.worktree,
      args: ["merge", "--no-commit", "--no-ff", `${this.context.remote}/${this.context.branch}`],
      allowFailure: true,
    })
    const conflicts = await this.context.conflicts()
    if (result.code !== 0 && conflicts.length === 0)
      throw new GitDocumentsError(
        "git_failed",
        result.stderr.trim() || "Merge could not be prepared",
      )
    return { state: conflicts.length === 0 ? "ready" : "conflicts", conflicts }
  }

  async completeMerge(message: string): Promise<RemoteStatus> {
    const conflicts = await this.context.conflicts()
    if (conflicts.length > 0)
      throw new GitDocumentsError("diverged", "Resolve every document conflict before committing")
    const staged = await runGit({
      cwd: this.context.worktree,
      args: ["diff", "--cached", "--name-only", "-z"],
    })
    const paths = staged.stdout.split("\0").filter(Boolean)
    if (paths.length === 0 || paths.some((path) => !path.startsWith(`${this.context.docs}/`)))
      throw new GitDocumentsError(
        "staged_changes",
        "Merge contains changes outside the documents root",
      )
    await runGit({
      cwd: this.context.worktree,
      args: ["commit", "-m", message.trim()],
      ...(this.context.author === undefined ? {} : { author: this.context.author }),
    })
    return this.status()
  }

  async abortMerge(): Promise<void> {
    await runGit({ cwd: this.context.worktree, args: ["merge", "--abort"] })
  }
}
