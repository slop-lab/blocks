import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { GitDocuments, GitDocumentsError } from "@block-editor/git-documents"
import { afterEach, describe, expect, it } from "vitest"

const execute = promisify(execFile)
const roots: string[] = []
const gitEnvironment = {
  ...process.env,
  GIT_MASTER: "1",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
}

const git = async (cwd: string, ...args: readonly string[]) =>
  execute("git", args, { cwd, env: gitEnvironment })

const repository = async () => {
  const root = await mkdtemp(join(tmpdir(), "git-documents-"))
  roots.push(root)
  await git(root, "init", "-b", "main")
  await git(root, "config", "user.name", "Document Author")
  await git(root, "config", "user.email", "author@example.test")
  await writeFile(join(root, ".gitignore"), ".runtime/\n")
  await writeFile(join(root, "README.md"), "primary worktree\n")
  await git(root, "add", ".gitignore", "README.md")
  await git(root, "commit", "-m", "Initialize repository")
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Git documents", () => {
  it("creates and reuses a managed worktree without touching the primary worktree", async () => {
    const root = await repository()
    const options = { repo: root, docs: "docs", branch: "documents", data: join(root, ".runtime") }

    const first = await GitDocuments.open(options)
    await first.createDocument("notes/welcome.md", "# Welcome\n")
    const reopened = await GitDocuments.open(options)

    expect(reopened.worktree).toBe(first.worktree)
    expect(await reopened.readDocument("notes/welcome.md")).toMatchObject({
      content: "# Welcome\n",
      draft: null,
    })
    await expect(readFile(join(root, "README.md"), "utf8")).resolves.toBe("primary worktree\n")
  })

  it("rejects unsafe paths and stale writes while preserving a recoverable draft", async () => {
    const root = await repository()
    const documents = await GitDocuments.open({
      repo: root,
      docs: "docs",
      data: join(root, ".runtime"),
    })
    const created = await documents.createDocument("safe.md", "first\n")
    await documents.saveDraft("safe.md", "recover me\n", created.revision)
    await documents.writeDocument("safe.md", "second\n", created.revision)

    await expect(
      documents.writeDocument("safe.md", "stale\n", created.revision),
    ).rejects.toMatchObject({
      code: "stale_revision",
    })
    await expect(documents.readDocument("../secret.md")).rejects.toBeInstanceOf(GitDocumentsError)
    expect((await documents.readDocument("safe.md")).draft?.content).toBe("recover me\n")
  })

  it("serializes CAS writes across instances of the same managed worktree", async () => {
    const root = await repository()
    const options = { repo: root, docs: "docs", branch: "documents", data: join(root, ".runtime") }
    const first = await GitDocuments.open(options)
    const second = await GitDocuments.open(options)
    const created = await first.createDocument("race.md", "base\n")

    const results = await Promise.allSettled([
      first.writeDocument("race.md", "first\n", created.revision),
      second.writeDocument("race.md", "second\n", created.revision),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    await expect(
      first.commit(["race.md"], "Commit reviewed version", { "race.md": created.revision }),
    ).rejects.toMatchObject({ code: "stale_revision" })
  })

  it("preserves rename status, moves drafts, and restores a deleted document", async () => {
    const root = await repository()
    const documents = await GitDocuments.open({
      repo: root,
      docs: "docs",
      data: join(root, ".runtime"),
    })
    const created = await documents.createDocument("old.md", "original\n")
    const initial = await documents.commit(["old.md"], "Add original")
    await documents.saveDraft("old.md", "draft\n", created.revision)

    const renamed = await documents.renameDocument("old.md", "new.md", created.revision)
    expect(renamed.draft?.content).toBe("draft\n")
    await git(documents.worktree, "add", "--", "docs/old.md", "docs/new.md")
    expect((await documents.status()).map((item) => item.path)).toEqual(["new.md"])
    await documents.deleteDocument("new.md", renamed.revision)
    expect(await documents.diff("new.md")).toMatchObject({ head: null, working: null })
    const restored = await documents.restoreDocument("old.md", initial.commit)
    expect(restored.content).toBe("original\n")
  })

  it("commits only selected document paths and restores history as a working-tree edit", async () => {
    const root = await repository()
    const documents = await GitDocuments.open({
      repo: root,
      docs: "docs",
      data: join(root, ".runtime"),
    })
    const first = await documents.createDocument("first.md", "one\n")
    await documents.createDocument("second.md", "two\n")
    const initial = await documents.commit(["first.md", "second.md"], "Add documents")
    await documents.writeDocument("first.md", "changed\n", first.revision)
    const second = await documents.readDocument("second.md")
    await documents.writeDocument("second.md", "uncommitted\n", second.revision)

    await documents.commit(["first.md"], "Update first")
    expect((await documents.status()).find((item) => item.path === "second.md")?.working).toBe(
      "modified",
    )
    const restored = await documents.restoreDocument("first.md", initial.commit)

    expect(restored.content).toBe("one\n")
    expect((await documents.status()).find((item) => item.path === "first.md")?.working).toBe(
      "modified",
    )
  })

  it("keeps branch worktrees and drafts isolated", async () => {
    const root = await repository()
    const data = join(root, ".runtime")
    const main = await GitDocuments.open({ repo: root, docs: "docs", branch: "documents", data })
    const created = await main.createDocument("plan.md", "main plan\n")
    await main.commit(["plan.md"], "Add plan")
    const experiment = await main.createBranch("experiment")
    await main.saveDraft("plan.md", "main draft\n", created.revision)
    await expect(main.assertSafeToSwitch()).rejects.toMatchObject({ code: "dirty_worktree" })
    const experimentFile = await experiment.readDocument("plan.md")

    expect(experimentFile.content).toBe("main plan\n")
    expect(experimentFile.draft).toBeNull()
    expect((await main.readDocument("plan.md")).draft?.content).toBe("main draft\n")
  })

  it("validates branches before Git and hashes collision-prone managed paths", async () => {
    const root = await repository()
    const documents = await GitDocuments.open({
      repo: root,
      docs: "docs",
      branch: "documents",
      data: join(root, ".runtime"),
    })

    await expect(documents.createBranch("-unsafe")).rejects.toMatchObject({
      code: "invalid_branch",
    })
    const slash = await documents.createBranch("notes/topic")
    const dashes = await documents.createBranch("notes--topic")

    expect(slash.worktree).not.toBe(dashes.worktree)
    await expect(git(root, "show-ref", "--verify", "refs/heads/-unsafe")).rejects.toBeDefined()
  })

  it("fetches, fast-forwards, pushes, and reports divergence without resetting", async () => {
    const root = await repository()
    const remote = await mkdtemp(join(tmpdir(), "git-documents-remote-"))
    const peer = await mkdtemp(join(tmpdir(), "git-documents-peer-"))
    roots.push(remote, peer)
    await git(remote, "init", "--bare")
    await git(root, "remote", "add", "origin", remote)
    await git(root, "push", "-u", "origin", "main")
    await git(peer, "clone", remote, ".")
    await git(peer, "config", "user.name", "Remote Author")
    await git(peer, "config", "user.email", "remote@example.test")
    const documents = await GitDocuments.open({
      repo: root,
      docs: "docs",
      branch: "documents",
      data: join(root, ".runtime"),
    })
    const created = await documents.createDocument("sync.md", "local\n")
    await documents.commit(["sync.md"], "Add local document")
    await documents.push()
    await git(peer, "fetch", "origin")
    await git(peer, "switch", "-c", "documents", "origin/documents")
    await writeFile(join(peer, "docs", "remote.md"), "remote\n")
    await git(peer, "add", "docs/remote.md")
    await git(peer, "commit", "-m", "Add remote document")
    await git(peer, "push")

    await documents.fetch()
    expect(await documents.remoteStatus()).toMatchObject({ ahead: 0, behind: 1, state: "behind" })
    await writeFile(join(documents.worktree, "outside.txt"), "outside\n")
    await expect(documents.fastForward()).rejects.toMatchObject({ code: "dirty_worktree" })
    await rm(join(documents.worktree, "outside.txt"))
    await documents.saveDraft("sync.md", "pending draft\n", created.revision)
    await expect(documents.fastForward()).rejects.toMatchObject({ code: "dirty_worktree" })
    await documents.clearDraft("sync.md")
    await documents.fastForward()
    expect((await documents.readDocument("remote.md")).content).toBe("remote\n")
    await documents.writeDocument("sync.md", "local divergence\n", created.revision)
    await documents.commit(["sync.md"], "Diverge locally")
    await writeFile(join(peer, "docs", "remote.md"), "remote divergence\n")
    await git(peer, "add", "docs/remote.md")
    await git(peer, "commit", "-m", "Diverge remotely")
    await git(peer, "push")
    await documents.fetch()

    await expect(documents.fastForward()).rejects.toMatchObject({ code: "diverged" })
    expect(await documents.remoteStatus()).toMatchObject({ state: "diverged" })
  })

  it("prepares an explicit merge and commits resolved document conflicts", async () => {
    const root = await repository()
    const remote = await mkdtemp(join(tmpdir(), "git-documents-conflict-remote-"))
    const peer = await mkdtemp(join(tmpdir(), "git-documents-conflict-peer-"))
    roots.push(remote, peer)
    await git(remote, "init", "--bare")
    await git(root, "remote", "add", "origin", remote)
    const documents = await GitDocuments.open({
      repo: root,
      docs: "docs",
      branch: "documents",
      data: join(root, ".runtime"),
    })
    await documents.createDocument("shared.md", "# Shared\n\nbaseline\n")
    await documents.commit(["shared.md"], "Add shared document")
    await documents.push()
    await git(peer, "clone", "--branch", "documents", remote, ".")
    await git(peer, "config", "user.name", "Remote Author")
    await git(peer, "config", "user.email", "remote@example.test")
    await writeFile(join(peer, "docs", "shared.md"), "# Shared\n\nremote edit\n")
    await git(peer, "add", "docs/shared.md")
    await git(peer, "commit", "-m", "Edit shared remotely")
    await git(peer, "push")
    const local = await documents.readDocument("shared.md")
    await documents.writeDocument("shared.md", "# Shared\n\nlocal edit\n", local.revision)
    await documents.commit(["shared.md"], "Edit shared locally")
    await documents.fetch()

    await expect(documents.prepareMerge()).resolves.toEqual({
      state: "conflicts",
      conflicts: ["shared.md"],
    })
    const conflicted = await documents.readDocument("shared.md")
    expect(conflicted.content).toContain("<<<<<<< HEAD")
    await documents.resolveConflict("shared.md", "# Shared\n\nresolved\n", conflicted.revision)
    await expect(documents.completeMerge("Resolve shared document")).resolves.toMatchObject({
      state: "ahead",
    })
    expect((await documents.readDocument("shared.md")).content).toBe("# Shared\n\nresolved\n")
  })
})
