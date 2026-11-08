import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitDocuments, initializeGitDocumentsRepository } from "@slop-lab/blocks-git-documents"
import { afterEach, expect, it, vi } from "vitest"

const roots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it.each(["GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"])(
  "isolates its repository from inherited %s while retaining author identity",
  async (name) => {
    const root = await mkdtemp(join(tmpdir(), "git-documents-hook-"))
    roots.push(root)
    await initializeGitDocumentsRepository({
      repo: root,
      author: { name: "Fixture Author", email: "fixture@example.test" },
    })
    const foreign =
      name === "GIT_INDEX_FILE" ? ".git/index" : join(root, "foreign-repository-selector")
    vi.stubEnv(name, foreign)
    vi.stubEnv("GIT_AUTHOR_NAME", "Hook Author")
    vi.stubEnv("GIT_AUTHOR_EMAIL", "hook@example.test")
    vi.stubEnv("GIT_COMMITTER_NAME", "Hook Committer")
    vi.stubEnv("GIT_COMMITTER_EMAIL", "committer@example.test")

    const documents = await GitDocuments.open({ repo: root, data: join(root, ".runtime") })
    await documents.createDocument("hook.md", "# From a hook\n")
    await documents.commit(["hook.md"], "Save from a hook")

    expect((await documents.readDocument("hook.md")).content).toBe("# From a hook\n")
    expect((await documents.history("hook.md"))[0]?.author).toBe("Hook Author")
    expect(process.env[name]).toBe(foreign)
  },
)
