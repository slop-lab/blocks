import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { GitDocuments } from "@slop-lab/blocks-git-documents"
import { createGitDocumentsServer } from "@slop-lab/blocks-git-documents-host"
import { chromium } from "playwright"

const execute = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), "block-docs-browser-"))
const env = { ...process.env, GIT_MASTER: "1", GIT_CONFIG_NOSYSTEM: "1" }
const git = (...args) => execute("git", args, { cwd: root, env })
await git("init", "-b", "main")
await git("config", "user.name", "Browser Author")
await git("config", "user.email", "browser@example.test")
await writeFile(join(root, ".gitignore"), ".runtime/\n")
await git("add", ".gitignore")
await git("commit", "-m", "Initialize")
const documents = await GitDocuments.open({ repo: root, data: join(root, ".runtime") })
await documents.createDocument("welcome.md", "# Welcome\n\nA personal document library.\n")
await documents.createDocument("z-second.md", "# Second\n\nAsync navigation target.\n")
await documents.commit(["welcome.md", "z-second.md"], "Add browser documents")
const server = createGitDocumentsServer({
  documents,
  assetsRoot: new URL("../../dist/", import.meta.url).pathname,
})
server.listen(0, "127.0.0.1")
await once(server, "listening")
const address = server.address()
if (address === null || typeof address === "string")
  throw new TypeError("Missing browser server address")
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}/?workspace=git-documents`, {
    waitUntil: "networkidle",
  })
  await page.getByRole("heading", { name: "welcome.md", exact: true }).waitFor()
  await page.route("**/api/git-documents/file?path=welcome.md", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.continue()
  })
  await page.getByRole("button", { name: "welcome.md", exact: true }).click()
  await page.getByRole("button", { name: "z-second.md", exact: true }).click()
  await page.getByRole("heading", { name: "z-second.md", exact: true }).waitFor()
  await page.waitForTimeout(120)
  await page.unroute("**/api/git-documents/file?path=welcome.md")
  await page.getByRole("button", { name: "welcome.md", exact: true }).click()
  await page.getByRole("heading", { name: "welcome.md", exact: true }).waitFor()
  await page.getByRole("tab", { name: "Markdown source" }).click()
  const source = page.getByLabel("Git Markdown source")
  await source.fill("# Browser edited\n\nDraft recovery and selective commits.\n")
  await page.getByRole("status").filter({ hasText: "Autosaved the recovery draft." }).waitFor()
  await page.route("**/api/git-documents/file", async (route) => {
    if (route.request().method() === "PUT") await new Promise((resolve) => setTimeout(resolve, 100))
    await route.continue()
  })
  await page.getByRole("button", { name: /Save to working tree/ }).click()
  await source.fill("# Browser edited\n\nNewest local edit survives the older save.\n")
  await page.waitForTimeout(150)
  assert.match(await source.inputValue(), /Newest local edit/u)
  await page.unroute("**/api/git-documents/file")
  await page.getByRole("button", { name: /Save to working tree/ }).click()
  await page.getByRole("status").filter({ hasText: "Saved to the working tree." }).waitFor()
  await page.getByLabel("Change review and history").getByRole("checkbox").check()
  await page.getByLabel("Commit message").fill("Edit welcome in browser")
  await page.getByRole("button", { name: "Commit selected documents" }).click()
  await page
    .getByRole("status")
    .filter({ hasText: "Committed the selected document changes." })
    .waitFor()
  await page.getByRole("tab", { name: "History" }).click()
  await page.getByText("Edit welcome in browser", { exact: true }).waitFor()

  page.once("dialog", (dialog) => dialog.accept("notes/new.md"))
  await page.getByRole("button", { name: "New Markdown document" }).click()
  await page.getByRole("heading", { name: "notes/new.md", exact: true }).waitFor()
  page.once("dialog", (dialog) => dialog.accept("notes/renamed.md"))
  await page.getByRole("button", { name: /Move/ }).click()
  await page.getByRole("heading", { name: "notes/renamed.md", exact: true }).waitFor()
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: /Delete/ }).click()
  await page.getByRole("heading", { name: "welcome.md", exact: true }).waitFor()

  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      true,
    )
  }
  assert.deepEqual(errors, [])
  console.log(
    "PASS Git document edit, recovered draft, save, selective commit, history, create, rename, delete, and responsive layouts",
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
