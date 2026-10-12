import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const root = await mkdtemp(join(tmpdir(), "structured-workspace-features-"))
const server = createApplicationServer({
  runtimeRoot: root,
  sessionSecret: "structured-features-secret-value",
})
server.listen(0, "127.0.0.1")
await once(server, "listening")
const address = server.address()
if (address === null || typeof address === "string") throw new TypeError("Missing address")
const base = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--font-render-hinting=none",
    "--disable-lcd-text",
  ],
})

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  let sourceWrites = 0
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/api/workspace/sources/"))
      sourceWrites += 1
  })
  await page.goto(`${base}/?workspace=structured-workspace`, { waitUntil: "networkidle" })
  const workspace = page.getByLabel("문서와 데이터베이스")
  await workspace.waitFor()

  await workspace.getByRole("button", { name: "사용자 조사", exact: true }).click()
  const section = workspace.locator(".structured-section").first()
  const heading = section.locator("h3").first()
  await section.hover()
  await section.getByRole("button", { name: "제목 제거", exact: true }).click()
  assert.equal(await heading.count(), 0)
  await section.getByRole("button", { name: "제목 추가", exact: true }).click()
  const restoredHeading = section.locator("h3").first()
  await restoredHeading.click()
  await page.keyboard.insertText("조사 메모")

  const paragraph = section.locator("p").first()
  await paragraph.click()
  await paragraph.selectText()
  await page.keyboard.press("ControlOrMeta+b")
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "사용자 조사", exact: true }).click()
  assert.ok((await workspace.locator(".structured-section strong").count()) > 0)

  await workspace.getByLabel("연결할 페이지").selectOption("project")
  await workspace.getByRole("button", { name: "페이지 연결 추가", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()
  await workspace.getByRole("button", { name: /연결된 페이지 · 제품 출시/ }).waitFor()
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "사용자 조사", exact: true }).click()
  await workspace.getByRole("button", { name: /연결된 페이지 · 제품 출시/ }).waitFor()

  const localSection = workspace.locator(".structured-section").first()
  await localSection.hover()
  await localSection.getByRole("button", { name: "공유 섹션으로 전환", exact: true }).click()
  await workspace.locator(".structured-sync").first().waitFor()
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "사용자 조사", exact: true }).click()
  const syncedSection = workspace.locator(".structured-sync").first()
  await syncedSection.waitFor()
  const syncedEditor = syncedSection.locator(".structured-sync__editor")
  const syncedParagraph = syncedEditor.locator("p").first()
  const sourceWritesBeforeComposition = sourceWrites
  await syncedParagraph.click()
  await syncedEditor.dispatchEvent("compositionstart")
  await page.keyboard.insertText("조합 중")
  await page.waitForTimeout(800)
  assert.equal(sourceWrites, sourceWritesBeforeComposition)
  await syncedEditor.dispatchEvent("compositionend")
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()
  assert.equal(sourceWrites, sourceWritesBeforeComposition + 1)
  assert.equal(
    await syncedEditor.evaluate((element) => element.contains(document.activeElement)),
    true,
  )
  await page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && response.url().endsWith("/api/workspace"),
  )
  assert.equal(
    await syncedEditor.evaluate((element) => element.contains(document.activeElement)),
    true,
  )
  await workspace.getByLabel("연결할 페이지").focus()
  assert.equal(await syncedEditor.getAttribute("contenteditable"), "false")
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "사용자 조사", exact: true }).click()
  assert.match(await workspace.locator(".structured-sync__editor").first().innerText(), /조합 중/)

  await workspace.getByRole("button", { name: "제품 출시", exact: true }).click()
  await workspace.getByRole("button", { name: "보드 보기", exact: true }).click()
  const board = workspace.getByRole("region", { name: "출시 작업 보드" })
  await board.waitFor()
  await board.getByLabel("task-2 상태").selectOption("완료")
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "제품 출시", exact: true }).click()
  assert.equal(await workspace.getByLabel("task-2 상태").inputValue(), "완료")

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
    "PASS rich inline reload, optional titles, page references, canonical shared conversion, kanban persistence, and responsive widths",
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
