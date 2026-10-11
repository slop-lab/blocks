import { type ChildProcess, execFile, spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"

const execute = promisify(execFile)
const roots: string[] = []
const processes: ChildProcess[] = []
const cli = resolve("packages/block-docs/dist/cli.js")
const env = { ...process.env, GIT_MASTER: "1", GIT_CONFIG_NOSYSTEM: "1" }

afterEach(async () => {
  for (const child of processes.splice(0)) child.kill("SIGINT")
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("block-docs CLI", () => {
  it("prints useful help and rejects incomplete start input", async () => {
    const help = await execute(process.execPath, [cli, "--help"], { env })
    const invalid = await execute(process.execPath, [cli, "start"], { env }).catch(
      (error: unknown) => error,
    )

    expect(help.stdout).toContain("block-docs start --repo <path>")
    expect(help.stdout).toContain("block-docs init --repo <path>")
    expect(invalid).toMatchObject({ code: 1 })
  })

  it("initializes a dedicated repository and starts an HTTP workspace on an ephemeral port", async () => {
    const parent = await mkdtemp(join(tmpdir(), "block-docs-cli-"))
    roots.push(parent)
    const repo = join(parent, "library")
    await execute(
      process.execPath,
      [
        cli,
        "init",
        "--repo",
        repo,
        "--author-name",
        "Workshop Author",
        "--author-email",
        "workshop@example.test",
      ],
      { env },
    )
    const child = spawn(process.execPath, [cli, "start", "--repo", repo, "--port", "0"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    processes.push(child)
    const url = await new Promise<string>((resolveUrl, reject) => {
      child.once("exit", (code) => reject(new Error(`CLI exited before startup (${code})`)))
      child.stderr?.on("data", (chunk) => reject(new Error(String(chunk))))
      child.stdout?.on("data", (chunk) => {
        const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/u)
        if (match?.[0] !== undefined) resolveUrl(match[0])
      })
    })
    const response = await fetch(`${url}/api/git-documents`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ repository: "library", branch: "block-docs" })
    expect(await readFile(join(repo, "docs", "welcome.md"), "utf8")).toContain("Document workshop")
  })
})
