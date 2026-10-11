import { execFile } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { GitDocuments } from "@block-editor/git-documents"
import { createGitDocumentsServer } from "@block-editor/git-documents-host"
import { afterEach, describe, expect, it } from "vitest"

const execute = promisify(execFile)
const roots: string[] = []
const servers: Server[] = []

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "git-documents-host-"))
  roots.push(root)
  const env = { ...process.env, GIT_MASTER: "1", GIT_CONFIG_NOSYSTEM: "1" }
  const git = (...args: readonly string[]) => execute("git", args, { cwd: root, env })
  await git("init", "-b", "main")
  await git("config", "user.name", "Host Test")
  await git("config", "user.email", "host@example.test")
  await writeFile(join(root, ".gitignore"), ".runtime/\n")
  await git("add", ".gitignore")
  await git("commit", "-m", "Initialize")
  const documents = await GitDocuments.open({ repo: root, data: join(root, ".runtime") })
  const server = createGitDocumentsServer({ documents })
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Missing server address")
  return { root, documents, base: `http://127.0.0.1:${address.port}` }
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Git documents host", () => {
  it("exposes bounded document, draft, diff, commit, and history routes", async () => {
    const { base } = await setup()
    const mutate = (path: string, body: unknown, method = "POST") =>
      fetch(`${base}/api/git-documents${path}`, {
        method,
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify(body),
      })
    const created = await (
      await mutate("/documents", { path: "guide.md", content: "# Guide\n" })
    ).json()
    await mutate(
      "/draft",
      { path: "guide.md", content: "# Recovered\n", baseRevision: created.revision },
      "PUT",
    )

    const state = await (await fetch(`${base}/api/git-documents`)).json()
    const file = await (await fetch(`${base}/api/git-documents/file?path=guide.md`)).json()
    const committed = await (
      await mutate("/commit", {
        paths: ["guide.md"],
        message: "Add guide",
        expectedRevisions: { "guide.md": created.revision },
      })
    ).json()
    const history = await (await fetch(`${base}/api/git-documents/history?path=guide.md`)).json()

    expect(state).toMatchObject({ branch: "block-docs", docs: "docs" })
    expect(file.draft.content).toBe("# Recovered\n")
    expect(committed.commit).toMatch(/^[0-9a-f]{40}$/u)
    expect(history.entries[0]).toMatchObject({ subject: "Add guide" })
  })

  it("enforces same-origin mutations and has no command execution route", async () => {
    const { base } = await setup()
    const forbidden = await fetch(`${base}/api/git-documents/documents`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ path: "unsafe.md", content: "unsafe" }),
    })
    const unknown = await fetch(`${base}/api/git-documents/run`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ command: "git reset --hard" }),
    })

    expect(forbidden.status).toBe(403)
    expect(unknown.status).toBe(404)
  })
})
