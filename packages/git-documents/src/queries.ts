import { join } from "node:path"
import { GitDocumentsError } from "./errors.js"
import { readText } from "./files.js"
import { runGit } from "./git.js"
import type { DocumentDiff, DocumentTreeNode, HistoryEntry, SearchResult } from "./types.js"
import { documentPath } from "./validation.js"

type QueryContext = {
  readonly worktree: string
  readonly docsRoot: string
  readonly docs: string
  readonly read: (path: string) => Promise<{ readonly content: string }>
  readonly list: () => Promise<readonly DocumentTreeNode[]>
}

export class DocumentQueries {
  constructor(private readonly context: QueryContext) {}

  async history(path: string, limit = 50): Promise<readonly HistoryEntry[]> {
    const safePath = documentPath(path)
    const result = await runGit({
      cwd: this.context.worktree,
      args: [
        "log",
        "--follow",
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

  async diff(path: string): Promise<DocumentDiff> {
    const safePath = documentPath(path)
    const repositoryPath = `${this.context.docs}/${safePath}`
    const [head, staged, working] = await Promise.all([
      runGit({
        cwd: this.context.worktree,
        args: ["show", `HEAD:${repositoryPath}`],
        allowFailure: true,
      }),
      runGit({
        cwd: this.context.worktree,
        args: ["show", `:${repositoryPath}`],
        allowFailure: true,
      }),
      readText(join(this.context.docsRoot, safePath)),
    ])
    return {
      path: safePath,
      head: head.code === 0 ? head.stdout : null,
      working,
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
          const file = await this.context.read(node.path)
          for (const [index, line] of file.content.split("\n").entries()) {
            if (line.toLocaleLowerCase().includes(needle))
              results.push({ path: node.path, line: index + 1, excerpt: line.slice(0, 240) })
            if (results.length >= limit) return
          }
        }
      }
    }
    await visit(await this.context.list())
    return results
  }

  async backlinks(path: string): Promise<readonly SearchResult[]> {
    const target = documentPath(path)
    const candidates = await this.search(target.replace(/\.md$/iu, ""), 200)
    return candidates.filter((result) => result.path !== target)
  }
}
