import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const root = await mkdtemp(join(tmpdir(), "ownership-browser-"))
process.env.MARKDOWN_ROOT = join(root, "markdown")
const server = createApplicationServer({ runtimeRoot: root })
server.listen(0, "127.0.0.1")
await once(server, "listening")
const address = server.address()
if (address === null || typeof address === "string") throw new TypeError("Missing address")
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
try {
  for (const width of [375, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: /소유권 예제/ }).click()
    await page.getByRole("button", { name: "프로젝트 보드", exact: true }).click()
    const board = page.getByLabel("프로젝트 보드 표현 편집기")
    await board.locator("article").first().click()
    await page.keyboard.press("End")
    await page.keyboard.insertText(" 편집됨")
    const blocksBeforeAdd = await board.locator("[data-block-id]").count()
    await board.locator("[data-block-id]").first().hover()
    await page.getByRole("button", { name: "이 블록 뒤에 문단 추가", exact: true }).click()
    assert.equal(await board.locator("[data-block-id]").count(), blocksBeforeAdd + 1)
    await page.getByRole("button", { name: "표현 저장", exact: true }).click()
    const before = await board.locator("article").count()
    await page.getByRole("button", { name: "카드 복제", exact: true }).click()
    assert.equal(
      await page.getByLabel("프로젝트 보드 표현 편집기").locator("article").count(),
      before + 1,
    )
    await page.getByRole("button", { name: "혼합 백로그", exact: true }).click()
    await page.getByRole("button", { name: "표현 편집", exact: true }).click()
    await page.getByLabel("혼합 표현 편집기").locator("p").first().click()
    await page.keyboard.press("End")
    await page.keyboard.insertText(" 수정")
    await page.getByRole("button", { name: "하위 문서 저장", exact: true }).click()
    await page.getByRole("button", { name: "작업 Markdown 열기", exact: true }).click()
    await page.getByRole("heading", { name: "tasks/TASK-104.md" }).waitFor()
    assert.equal(errors.length, 0)
    await page.close()
  }
  console.log(
    "PASS ownership canonical documents, lower editors, nested task files, and responsive layouts",
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
