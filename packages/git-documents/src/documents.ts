import { mkdir, rename, rm } from "node:fs/promises"
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
import type {
  CommitResult,
  DocumentDiff,
  DocumentFile,
  DocumentStatus,
  DocumentTreeNode,
  Draft,
  HistoryEntry,
  SearchResult,
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
  private queue: Promise<void> = Promise.resolve()
  constructor(private readonly context: Context) {}

  private documentFile(path: string): string {
    return join(this.context.docsRoot, documentPath(path))
  }

  private draftFile(path: string): string {
    return join(this.context.draftRoot, draftName(documentPath(path)))
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release = (): void => undefined
    this.queue = new Promise<void>((resolveQueue) => {
      release = resolveQueue
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
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
    const draft = { content, baseRevision, updatedAt: new Date().toISOString() }
    await atomicWrite(this.draftFile(path), JSON.stringify(draft))
    return draft
  }

  async clearDraft(path: string): Promise<void> {
    await rm(this.draftFile(path), { force: true })
  }

  async rename(from: string, to: string): Promise<DocumentFile> {
    return this.exclusive(async () => {
      const source = await this.read(from)
      const target = documentPath(to)
      if ((await readText(this.documentFile(target))) !== null)
        throw new GitDocumentsError("already_exists", `Document ${target} already exists`)
      await mkdir(dirname(this.documentFile(target)), { recursive: true })
      await rename(this.documentFile(source.path), this.documentFile(target))
      return this.read(target)
    })
  }

  async delete(path: string, expectedRevision: string): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.read(path)
      if (current.revision !== expectedRevision)
        throw new GitDocumentsError("stale_revision", "Document changed since it was opened")
      await rm(this.documentFile(current.path))
    })
  }

  async status(): Promise<readonly DocumentStatus[]> {
    const result = await runGit({
      cwd: this.context.worktree,
      args: ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", this.context.docs],
    })
    return result.stdout
      .split("\0")
      .filter((line) => line.length > 3)
      .map((line) => {
        const repositoryPath = line.slice(3).replace(/^.* -> /, "")
        const prefix = `${this.context.docs}/`
        return {
          path: repositoryPath.startsWith(prefix)
            ? repositoryPath.slice(prefix.length)
            : repositoryPath,
          staged: state(line[0] ?? " "),
          working: state(line[1] ?? " "),
          conflict: /U/u.test(line.slice(0, 2)) || ["AA", "DD"].includes(line.slice(0, 2)),
        }
      })
  }

  async commit(paths: readonly string[], message: string): Promise<CommitResult> {
    return this.exclusive(async () => {
      if (paths.length === 0 || message.trim().length === 0 || message.length > 500)
        throw new GitDocumentsError("invalid_path", "Commit requires selected paths and a message")
      const selected = [...new Set(paths.map((path) => documentPath(path)))]
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
          args: ["reset", "--quiet", "HEAD", "--", ...repositoryPaths],
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

  async history(path: string, limit = 50): Promise<readonly HistoryEntry[]> {
    const safePath = documentPath(path)
    const result = await runGit({
      cwd: this.context.worktree,
      args: [
        "log",
        `-${Math.min(Math.max(limit, 1), 100)}`,
        "--format=%H%x1f%an%x1f%aI%x1f%s",
        "--",
        `${this.context.docs}/${safePath}`,
      ],
    })
    return result.stdout.trim() === ""
      ? []
      : result.stdout
          .trim()
          .split("\n")
          .map((line) => {
            const [commit = "", author = "", authoredAt = "", subject = ""] = line.split("\x1f")
            return { commit, author, authoredAt, subject }
          })
  }

  async restore(path: string, commit: string): Promise<DocumentFile> {
    const current = await this.read(path)
    if (!/^[0-9a-f]{7,64}$/u.test(commit))
      throw new GitDocumentsError("invalid_path", "Commit identifier is invalid")
    const result = await runGit({
      cwd: this.context.worktree,
      args: ["show", `${commit}:${this.context.docs}/${current.path}`],
    })
    return this.write(current.path, result.stdout, current.revision)
  }

  async diff(path: string): Promise<DocumentDiff> {
    const current = await this.read(path)
    const repositoryPath = `${this.context.docs}/${current.path}`
    const head = await runGit({
      cwd: this.context.worktree,
      args: ["show", `HEAD:${repositoryPath}`],
      allowFailure: true,
    })
    const staged = await runGit({
      cwd: this.context.worktree,
      args: ["show", `:${repositoryPath}`],
      allowFailure: true,
    })
    return {
      path: current.path,
      head: head.code === 0 ? head.stdout : null,
      working: current.content,
      staged: staged.code === 0 ? staged.stdout : null,
    }
  }

  async search(query: string, limit = 100): Promise<readonly SearchResult[]> {
    const needle = query.trim().toLocaleLowerCase()
    if (needle.length < 2 || needle.length > 200)
      throw new GitDocumentsError("invalid_path", "Search query must contain 2 to 200 characters")
    const results: SearchResult[] = []
    const visit = async (nodes: readonly DocumentTreeNode[]): Promise<void> => {
      for (const node of nodes) {
        if (results.length >= limit) return
        if (node.kind === "directory") await visit(node.children)
        else {
          const file = await this.read(node.path)
          for (const [index, line] of file.content.split("\n").entries()) {
            if (line.toLocaleLowerCase().includes(needle))
              results.push({ path: node.path, line: index + 1, excerpt: line.slice(0, 240) })
            if (results.length >= limit) return
          }
        }
      }
    }
    await visit(await this.list())
    return results
  }

  async backlinks(path: string): Promise<readonly SearchResult[]> {
    const target = documentPath(path)
    const name = target.replace(/\.md$/iu, "")
    const candidates = await this.search(name, 200)
    return candidates.filter((result) => result.path !== target)
  }
}
