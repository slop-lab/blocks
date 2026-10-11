import { mkdir, readdir, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { GitDocumentsError } from "./errors.js"
import {
  assertNoSymlink,
  atomicWrite,
  contentRevision,
  draftName,
  listTree,
  readDraft,
  readText,
} from "./files.js"
import { runGit } from "./git.js"
import { mutateWorktree } from "./queue.js"
import type {
  CommitResult,
  DocumentFile,
  DocumentStatus,
  DocumentTreeNode,
  Draft,
} from "./types.js"
import { documentPath } from "./validation.js"

type Context = {
  readonly worktree: string
  readonly docsRoot: string
  readonly docs: string
  readonly draftRoot: string
  readonly author?: { readonly name: string; readonly email: string }
}

const state = (value: string): DocumentStatus["working"] => {
  if (value === "?" || value === "A") return "added"
  if (value === "M") return "modified"
  if (value === "D") return "deleted"
  if (value === "R") return "renamed"
  return "unmodified"
}

export class DocumentOperations {
  constructor(private readonly context: Context) {}

  private documentFile(path: string): string {
    return join(this.context.docsRoot, documentPath(path))
  }

  private draftFile(path: string): string {
    return join(this.context.draftRoot, draftName(documentPath(path)))
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    return mutateWorktree(this.context.worktree, operation)
  }

  async list(): Promise<readonly DocumentTreeNode[]> {
    return listTree(this.context.docsRoot)
  }

  async read(path: string): Promise<DocumentFile> {
    const safePath = documentPath(path)
    await assertNoSymlink(this.context.docsRoot, safePath)
    const content = await readText(this.documentFile(safePath))
    if (content === null)
      throw new GitDocumentsError("not_found", `Document ${safePath} does not exist`)
    return {
      path: safePath,
      content,
      revision: contentRevision(content),
      draft: await readDraft(this.draftFile(safePath)),
    }
  }

  async create(path: string, content: string): Promise<DocumentFile> {
    return this.exclusive(async () => {
      const safePath = documentPath(path)
      await assertNoSymlink(this.context.docsRoot, safePath)
      if ((await readText(this.documentFile(safePath))) !== null)
        throw new GitDocumentsError("already_exists", `Document ${safePath} already exists`)
      await atomicWrite(this.documentFile(safePath), content)
      return this.read(safePath)
    })
  }

  async write(path: string, content: string, expectedRevision: string): Promise<DocumentFile> {
    return this.exclusive(async () => {
      const current = await this.read(path)
      if (current.revision !== expectedRevision)
        throw new GitDocumentsError("stale_revision", "Document changed since it was opened", {
          expectedRevision,
          actualRevision: current.revision,
        })
      await atomicWrite(this.documentFile(current.path), content)
      return this.read(current.path)
    })
  }

  async saveDraft(path: string, content: string, baseRevision: string): Promise<Draft> {
    return this.exclusive(async () => {
      const draft = { content, baseRevision, updatedAt: new Date().toISOString() }
      await atomicWrite(this.draftFile(path), JSON.stringify(draft))
      return draft
    })
  }

  async clearDraft(path: string): Promise<void> {
    await this.exclusive(async () => rm(this.draftFile(path), { force: true }))
  }

  async hasDrafts(): Promise<boolean> {
    try {
      return (await readdir(this.context.draftRoot)).some((entry) => entry.endsWith(".json"))
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
      throw error
    }
  }

  async rename(from: string, to: string, expectedRevision: string): Promise<DocumentFile> {
    return this.exclusive(async () => {
      const source = await this.read(from)
      if (source.revision !== expectedRevision)
        throw new GitDocumentsError("stale_revision", "Document changed since it was opened")
      const target = documentPath(to)
      await assertNoSymlink(this.context.docsRoot, target)
      if ((await readText(this.documentFile(target))) !== null)
        throw new GitDocumentsError("already_exists", `Document ${target} already exists`)
      await mkdir(dirname(this.documentFile(target)), { recursive: true })
      await rename(this.documentFile(source.path), this.documentFile(target))
      const draft = this.draftFile(source.path)
      if ((await readText(draft)) !== null) {
        await mkdir(dirname(this.draftFile(target)), { recursive: true })
        await rename(draft, this.draftFile(target))
      }
      return this.read(target)
    })
  }

  async delete(path: string, expectedRevision: string): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.read(path)
      if (current.revision !== expectedRevision)
        throw new GitDocumentsError("stale_revision", "Document changed since it was opened")
      await rm(this.documentFile(current.path))
      await rm(this.draftFile(current.path), { force: true })
    })
  }

  async resolveConflict(
    path: string,
    content: string,
    expectedRevision: string,
  ): Promise<DocumentFile> {
    return this.exclusive(async () => {
      const current = await this.read(path)
      if (current.revision !== expectedRevision)
        throw new GitDocumentsError("stale_revision", "Document changed since it was opened")
      await atomicWrite(this.documentFile(current.path), content)
      await runGit({
        cwd: this.context.worktree,
        args: ["add", "--", `${this.context.docs}/${current.path}`],
      })
      return this.read(current.path)
    })
  }

  async status(): Promise<readonly DocumentStatus[]> {
    const result = await runGit({
      cwd: this.context.worktree,
      args: ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", this.context.docs],
    })
    const fields = result.stdout.split("\0")
    const statuses: DocumentStatus[] = []
    for (let index = 0; index < fields.length; index += 1) {
      const line = fields[index] ?? ""
      if (line.length <= 3) continue
      const code = line.slice(0, 2)
      const renamed = code.includes("R") || code.includes("C")
      const repositoryPath = line.slice(3)
      if (renamed) index += 1
      const prefix = `${this.context.docs}/`
      statuses.push({
        path: repositoryPath.startsWith(prefix)
          ? repositoryPath.slice(prefix.length)
          : repositoryPath,
        staged: state(line[0] ?? " "),
        working: state(line[1] ?? " "),
        conflict: /U/u.test(code) || ["AA", "DD"].includes(code),
      })
    }
    return statuses
  }

  async commit(
    paths: readonly string[],
    message: string,
    expectedRevisions?: Readonly<Record<string, string | null>>,
  ): Promise<CommitResult> {
    return this.exclusive(async () => {
      if (paths.length === 0 || message.trim().length === 0 || message.length > 500)
        throw new GitDocumentsError("invalid_path", "Commit requires selected paths and a message")
      const selected = [...new Set(paths.map((path) => documentPath(path)))]
      if (expectedRevisions !== undefined) {
        for (const path of selected) {
          const content = await readText(this.documentFile(path))
          const actual = content === null ? null : contentRevision(content)
          if (expectedRevisions[path] !== actual)
            throw new GitDocumentsError("stale_revision", `Document ${path} changed after review`)
        }
      }
      const stagedBefore = await runGit({
        cwd: this.context.worktree,
        args: ["diff", "--cached", "--name-only", "-z"],
      })
      if (stagedBefore.stdout.length > 0)
        throw new GitDocumentsError(
          "staged_changes",
          "Resolve existing staged changes before committing",
        )
      const repositoryPaths = selected.map((path) => `${this.context.docs}/${path}`)
      await runGit({ cwd: this.context.worktree, args: ["add", "--", ...repositoryPaths] })
      const staged = await runGit({
        cwd: this.context.worktree,
        args: ["diff", "--cached", "--name-only", "-z", "--", ...repositoryPaths],
      })
      if (staged.stdout.length === 0)
        throw new GitDocumentsError("staged_changes", "Selected documents have no changes")
      try {
        await runGit({
          cwd: this.context.worktree,
          args: ["commit", "-m", message.trim(), "--", ...repositoryPaths],
          ...(this.context.author === undefined ? {} : { author: this.context.author }),
        })
      } catch (error) {
        await runGit({
          cwd: this.context.worktree,
          args: ["restore", "--staged", "--", ...repositoryPaths],
        })
        if (error instanceof GitDocumentsError && /identity|email|name/u.test(error.message))
          throw new GitDocumentsError(
            "missing_identity",
            "Configure a repository identity or pass an explicit author",
          )
        throw error
      }
      const head = await runGit({ cwd: this.context.worktree, args: ["rev-parse", "HEAD"] })
      return { commit: head.stdout.trim(), message: message.trim() }
    })
  }

  async restore(path: string, commit: string): Promise<DocumentFile> {
    const safePath = documentPath(path)
    if (!/^[0-9a-f]{7,64}$/u.test(commit))
      throw new GitDocumentsError("invalid_path", "Commit identifier is invalid")
    const result = await runGit({
      cwd: this.context.worktree,
      args: ["show", `${commit}:${this.context.docs}/${safePath}`],
    })
    const current = await readText(this.documentFile(safePath))
    if (current === null) return this.create(safePath, result.stdout)
    return this.write(safePath, result.stdout, contentRevision(current))
  }
}
