import { join } from "node:path"
import { DocumentOperations } from "./documents.js"
import { runGit } from "./git.js"
import { RemoteOperations } from "./remote.js"
import type {
  BranchInfo,
  CommitResult,
  DocumentDiff,
  DocumentFile,
  DocumentStatus,
  DocumentTreeNode,
  Draft,
  GitDocumentsOptions,
  HistoryEntry,
  MergeResult,
  RemoteStatus,
  SearchResult,
} from "./types.js"
import { relativeRoot } from "./validation.js"
import { prepareWorktree } from "./worktree.js"

export { GitDocumentsError } from "./errors.js"
export { initializeGitDocumentsRepository } from "./initialize.js"
export type * from "./types.js"

export class GitDocuments {
  readonly repo: string
  readonly data: string
  readonly branch: string
  readonly worktree: string
  readonly docs: string
  private readonly author: { readonly name: string; readonly email: string } | undefined
  private readonly remote: "origin"
  private readonly files: DocumentOperations
  private readonly remotes: RemoteOperations

  private constructor(input: {
    readonly repo: string
    readonly data: string
    readonly branch: string
    readonly worktree: string
    readonly repoId: string
    readonly docs: string
    readonly remote: "origin"
    readonly author?: { readonly name: string; readonly email: string }
  }) {
    this.repo = input.repo
    this.data = input.data
    this.branch = input.branch
    this.worktree = input.worktree
    this.docs = input.docs
    this.author = input.author
    this.remote = input.remote
    this.files = new DocumentOperations({
      worktree: input.worktree,
      docsRoot: join(input.worktree, input.docs),
      docs: input.docs,
      draftRoot: join(input.data, "drafts", input.repoId, input.branch.replaceAll("/", "--")),
      ...(input.author === undefined ? {} : { author: input.author }),
    })
    this.remotes = new RemoteOperations({
      worktree: input.worktree,
      branch: input.branch,
      remote: input.remote,
      isClean: async () => (await this.status()).length === 0,
      conflicts: async () =>
        (await this.status()).filter((item) => item.conflict).map((item) => item.path),
      docs: input.docs,
      ...(input.author === undefined ? {} : { author: input.author }),
    })
  }

  static async open(options: GitDocumentsOptions): Promise<GitDocuments> {
    const managed = await prepareWorktree(options)
    return new GitDocuments({
      ...managed,
      docs: relativeRoot(options.docs ?? "docs"),
      remote: options.remote ?? "origin",
      ...(options.author === undefined ? {} : { author: options.author }),
    })
  }

  listDocuments(): Promise<readonly DocumentTreeNode[]> {
    return this.files.list()
  }
  readDocument(path: string): Promise<DocumentFile> {
    return this.files.read(path)
  }
  createDocument(path: string, content = ""): Promise<DocumentFile> {
    return this.files.create(path, content)
  }
  writeDocument(path: string, content: string, expectedRevision: string): Promise<DocumentFile> {
    return this.files.write(path, content, expectedRevision)
  }
  saveDraft(path: string, content: string, baseRevision: string): Promise<Draft> {
    return this.files.saveDraft(path, content, baseRevision)
  }
  clearDraft(path: string): Promise<void> {
    return this.files.clearDraft(path)
  }
  renameDocument(from: string, to: string): Promise<DocumentFile> {
    return this.files.rename(from, to)
  }
  deleteDocument(path: string, expectedRevision: string): Promise<void> {
    return this.files.delete(path, expectedRevision)
  }
  status(): Promise<readonly DocumentStatus[]> {
    return this.files.status()
  }
  diff(path: string): Promise<DocumentDiff> {
    return this.files.diff(path)
  }
  commit(paths: readonly string[], message: string): Promise<CommitResult> {
    return this.files.commit(paths, message)
  }
  history(path: string, limit?: number): Promise<readonly HistoryEntry[]> {
    return this.files.history(path, limit)
  }
  restoreDocument(path: string, commit: string): Promise<DocumentFile> {
    return this.files.restore(path, commit)
  }
  search(query: string): Promise<readonly SearchResult[]> {
    return this.files.search(query)
  }
  backlinks(path: string): Promise<readonly SearchResult[]> {
    return this.files.backlinks(path)
  }
  async branches(): Promise<readonly BranchInfo[]> {
    const result = await runGit({
      cwd: this.worktree,
      args: ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    })
    const worktrees = await runGit({ cwd: this.repo, args: ["worktree", "list", "--porcelain"] })
    const managedRoot = join(this.data, "worktrees")
    return result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((name) => ({
        name,
        current: name === this.branch,
        managed:
          worktrees.stdout.includes(`branch refs/heads/${name}\n`) &&
          worktrees.stdout.includes(managedRoot),
      }))
  }
  async createBranch(branch: string): Promise<GitDocuments> {
    await runGit({ cwd: this.worktree, args: ["branch", branch, "HEAD"] })
    const options: GitDocumentsOptions = {
      repo: this.repo,
      docs: this.docs,
      data: this.data,
      branch,
      remote: this.remote,
      ...(this.author === undefined ? {} : { author: this.author }),
    }
    return GitDocuments.open(options)
  }
  fetch(): Promise<void> {
    return this.remotes.fetch()
  }
  remoteStatus(): Promise<RemoteStatus> {
    return this.remotes.status()
  }
  fastForward(): Promise<RemoteStatus> {
    return this.remotes.fastForward()
  }
  push(): Promise<RemoteStatus> {
    return this.remotes.push()
  }
  prepareMerge(): Promise<MergeResult> {
    return this.remotes.merge()
  }
  async resolveConflict(
    path: string,
    content: string,
    expectedRevision: string,
  ): Promise<DocumentFile> {
    const file = await this.writeDocument(path, content, expectedRevision)
    await runGit({ cwd: this.worktree, args: ["add", "--", `${this.docs}/${file.path}`] })
    return file
  }
  completeMerge(message: string): Promise<RemoteStatus> {
    return this.remotes.completeMerge(message)
  }
  abortMerge(): Promise<void> {
    return this.remotes.abortMerge()
  }
}
