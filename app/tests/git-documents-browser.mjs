import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { GitDocuments } from "@block-editor/git-documents"
import { createGitDocumentsServer } from "@block-editor/git-documents-host"
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
await documents.commit(["welcome.md"], "Add welcome document")
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
  await page.getByRole("tab", { name: "Markdown 원문" }).click()
  const source = page.getByLabel("Git Markdown 원문")
  await source.fill("# Browser edited\n\nDraft recovery and selective commits.\n")
  await page.getByRole("status").filter({ hasText: "복구 초안을 자동 저장했습니다" }).waitFor()
  await page.getByRole("button", { name: /작업 트리에 저장/ }).click()
  await page.getByRole("status").filter({ hasText: "작업 트리에 저장했습니다" }).waitFor()
  await page.getByLabel("변경 검토와 기록").getByRole("checkbox").check()
  await page.getByLabel("커밋 메시지").fill("Edit welcome in browser")
  await page.getByRole("button", { name: "선택한 문서 커밋" }).click()
  await page.getByRole("status").filter({ hasText: "커밋했습니다" }).waitFor()
  await page.getByRole("tab", { name: "기록" }).click()
  await page.getByText("Edit welcome in browser", { exact: true }).waitFor()

  page.once("dialog", (dialog) => dialog.accept("notes/new.md"))
  await page.getByRole("button", { name: "새 Markdown 문서" }).click()
  await page.getByRole("heading", { name: "notes/new.md", exact: true }).waitFor()
  page.once("dialog", (dialog) => dialog.accept("notes/renamed.md"))
  await page.getByRole("button", { name: /이동/ }).click()
  await page.getByRole("heading", { name: "notes/renamed.md", exact: true }).waitFor()
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: /삭제/ }).click()
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
