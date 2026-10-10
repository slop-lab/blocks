import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const root = await mkdtemp(join(tmpdir(), "block-editor-browser-"))
process.env.MARKDOWN_ROOT = root
const original = "# File notes\n\nOriginal paragraph.\n\n```custom\npreserve exactly\n```\n"
await writeFile(join(root, "notes.md"), original)
const server = createApplicationServer()
server.listen(0, "127.0.0.1")
await once(server, "listening")
const address = server.address()
if (address === null || typeof address === "string") throw new TypeError("No test server address")
const base = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${base}/?collaborationRoom=qa-${Date.now()}`, { waitUntil: "networkidle" })
  const navigate = async (name) => {
    await page
      .getByRole("button", { name: new RegExp(name) })
      .first()
      .click()
  }

  await navigate("Markdown 파일")
  const markdown = page.locator(".markdown-workspace")
  await markdown.getByRole("button", { name: /notes.md/ }).click()
  await page.waitForFunction(
    () => document.querySelector(".markdown-header h1")?.textContent === "notes.md",
  )
  const source = markdown.getByLabel("Markdown 원문", { exact: true })
  await source.fill(`Preface\n\n${original}`)
  await markdown.getByRole("tab", { name: "블록", exact: true }).click()
  const heading = markdown.getByLabel("제목 3행부터 3행", { exact: true })
  await heading.fill("# Changed title\n")
  await markdown.getByRole("tab", { name: "원문", exact: true }).click()
  assert.equal(
    await source.inputValue(),
    `Preface\n\n${original.replace("# File notes", "# Changed title")}`,
  )
  await markdown.getByRole("button", { name: "저장", exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector(".markdown-status")?.textContent?.includes("디스크에 저장했습니다"),
  )
  assert.match(await readFile(join(root, "notes.md"), "utf8"), /# Changed title/)
  assert.match(await readFile(join(root, "notes.md"), "utf8"), /```custom\npreserve exactly\n```/)
  await source.fill(`${await source.inputValue()}\nLocal draft`)
  await writeFile(join(root, "notes.md"), "# Externally changed\n")
  await markdown.getByRole("button", { name: "저장", exact: true }).click()
  await page.waitForFunction(() => document.body.textContent?.includes("디스크 파일이 바뀌어"))
  assert.match(await source.inputValue(), /Local draft/)
  assert.equal(await readFile(join(root, "notes.md"), "utf8"), "# Externally changed\n")
  const recovery = page.waitForEvent("download")
  await markdown.getByRole("button", { name: "초안 다운로드", exact: true }).click()
  const download = await recovery
  const recoveryPath = await download.path()
  assert.ok(recoveryPath)
  assert.match(await readFile(recoveryPath, "utf8"), /Local draft/)
  await markdown.getByRole("button", { name: "디스크 버전 다시 열기", exact: true }).click()
  console.log("PASS Markdown real file save, source line remap, opaque source and conflict draft")

  await navigate("함께 쓰기")
  const collaboration = page.locator(".collaboration-workspace")
  const a = collaboration.getByLabel("편집자 A 공동 편집기", { exact: true })
  const b = collaboration.getByLabel("편집자 B 공동 편집기", { exact: true })
  await a.locator("p").first().click()
  await page.keyboard.press("Home")
  await page.keyboard.insertText("PEER-A ")
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="편집자 B 공동 편집기"]')?.textContent?.includes("PEER-A"),
  )
  await b.locator("p").first().click()
  await page.keyboard.press("End")
  await page.keyboard.insertText(" PEER-B")
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="편집자 A 공동 편집기"]')?.textContent?.includes("PEER-B"),
  )
  await collaboration.getByRole("button", { name: "실행 취소", exact: true }).click()
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[aria-label="편집자 A 공동 편집기"]')
        ?.textContent?.includes("PEER-B"),
  )
  assert.match(await a.textContent(), /PEER-A/)
  await collaboration.getByRole("button", { name: "오프라인으로 전환", exact: true }).nth(1).click()
  await b.locator("p").first().click()
  await page.keyboard.insertText("OFFLINE-B ")
  assert.doesNotMatch(await a.textContent(), /OFFLINE-B/)
  await collaboration.getByRole("button", { name: "다시 연결", exact: true }).click()
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="편집자 A 공동 편집기"]')
      ?.textContent?.includes("OFFLINE-B"),
  )
  console.log("PASS live collaboration two-way convergence, local-only Undo, offline replay")

  await navigate("표와 코드")
  const composite = page.locator(".composite-workspace")
  await composite.locator("tr").first().waitFor()
  const rows = await composite.locator("tr").count()
  await composite.locator("td").first().click()
  await composite.getByRole("button", { name: "아래 행 추가", exact: true }).click()
  assert.equal(await composite.locator("tr").count(), rows + 1)
  const code = composite.locator(".cm-content")
  await code.click()
  await page.keyboard.press("Control+End")
  await page.keyboard.insertText("\n// CODE-DRAFT")
  assert.match(await code.textContent(), /CODE-DRAFT/)
  await composite.getByRole("button", { name: "활성 영역 실행 취소", exact: true }).click()
  assert.doesNotMatch(await code.textContent(), /CODE-DRAFT/)
  assert.equal(await composite.locator("tr").count(), rows + 1)
  await composite.getByRole("button", { name: "활성 영역 다시 실행", exact: true }).click()
  await code.click()
  await page.keyboard.press("Control+End")
  await page.keyboard.type(" KEYBOARD", { delay: 20 })
  assert.match(await code.textContent(), /KEYBOARD/)
  await composite.getByRole("button", { name: "문서와 코드 저장", exact: true }).click()
  const stored = await page.evaluate(() =>
    localStorage.getItem("slate-foundation/composite-workspace/v1"),
  )
  assert.match(stored, /CODE-DRAFT/)
  console.log("PASS native table rows, scoped CodeMirror Undo and whole-workspace persistence")

  await navigate("문서 보관함")
  const large = page.locator(".large-workspace")
  await large.locator(".large-row").first().waitFor()
  assert.ok((await large.locator(".large-row").count()) < 80)
  await large.getByLabel("문단 ID 또는 번호").fill("1500")
  await large.getByRole("button", { name: "열어서 편집", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("문단 내용").fill("Saved distant paragraph")
  await large.locator(".large-scroll").evaluate((element) => {
    element.scrollTop = 0
  })
  assert.equal(await dialog.getByLabel("문단 내용").inputValue(), "Saved distant paragraph")
  await dialog.getByRole("button", { name: "문단 저장", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  const response = await page.request.get(`${base}/api/large-content/block/paragraph-1499`)
  assert.equal((await response.json()).text, "Saved distant paragraph")
  const exported = await (await page.request.get(`${base}/api/large-content/export`)).json()
  assert.equal(exported.blocks.length, 1600)
  assert.ok(exported.blocks[0].text.length > 0)
  assert.ok((await large.locator(".large-row").count()) < 80)
  console.log(
    "PASS partial loading, bounded virtualization, pinned draft, CAS save and complete export",
  )
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
