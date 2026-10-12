import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const root = await mkdtemp(join(tmpdir(), "structured-workspace-nested-"))
const server = createApplicationServer({
  runtimeRoot: root,
  sessionSecret: "structured-nested-secret-value",
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
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${base}/?workspace=structured-workspace`, { waitUntil: "networkidle" })
  const payload = await (await page.request.get(`${base}/api/workspace`)).json()
  const research = payload.documents.find((record) => record.documentId === "research")
  if (research === undefined) throw new TypeError("Missing research document")
  const seeded = await page.request.put(`${base}/api/workspace/pages/research`, {
    data: {
      expectedRevision: research.revision,
      content: {
        pageId: "research",
        version: research.content.version + 1,
        blocks: [
          {
            id: "outer-quote",
            type: "quote",
            children: [
              {
                id: "middle-callout",
                type: "callout",
                children: [{ id: "nested-leaf", type: "paragraph", text: "abcd" }],
              },
            ],
          },
        ],
      },
    },
  })
  assert.equal(seeded.status(), 200)
  const seededRecord = await seeded.json()
  await page.reload({ waitUntil: "networkidle" })
  const pagePuts = []
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/api/workspace/pages/research"))
      pagePuts.push(request.postDataJSON())
  })

  const workspace = page.getByLabel("문서와 데이터베이스")
  await workspace.getByRole("button", { name: "사용자 조사", exact: true }).click()
  const editor = workspace.getByLabel("구조화 문서 편집기").last()
  const leaf = editor.locator('[data-block-id="nested-leaf"]')
  await leaf.hover()
  const grip = page.locator(".block-control--grip:visible")
  assert.equal(await grip.count(), 1)
  const leafId = await leaf.getAttribute("data-block-id")
  const leafBox = await leaf.boundingBox()
  const gripBox = await grip.boundingBox()
  if (leafBox === null || gripBox === null) throw new TypeError("Missing nested rail geometry")
  const blockCountBeforeBlankClick = await editor.locator("[data-block-id]").count()
  const blankPoint = await editor.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    element.style.minHeight = `${rect.height + 120}px`
    const expanded = element.getBoundingClientRect()
    return { x: expanded.left + expanded.width / 2, y: expanded.bottom - 12 }
  })
  assert.equal(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains("ProseMirror"),
      blankPoint,
    ),
    true,
  )
  await page.mouse.click(blankPoint.x, blankPoint.y)
  const outerQuote = editor.locator('[data-block-id="outer-quote"]')
  const parentBlankPoint = await outerQuote.evaluate((element) => {
    element.style.paddingBottom = "60px"
    const rect = element.getBoundingClientRect()
    return { x: rect.right - 12, y: rect.bottom - 12 }
  })
  await page.mouse.click(parentBlankPoint.x, parentBlankPoint.y)
  await workspace.getByRole("complementary", { name: "페이지 탐색", exact: true }).click({
    position: { x: 4, y: 4 },
  })
  await workspace.locator(".structured-main").click({ position: { x: 4, y: 4 } })
  await page.waitForTimeout(700)
  assert.equal(await editor.locator("[data-block-id]").count(), blockCountBeforeBlankClick)
  assert.equal(pagePuts.length, 0)
  const unchanged = await (await page.request.get(`${base}/api/workspace`)).json()
  assert.equal(
    unchanged.documents.find((record) => record.documentId === "research")?.content.version,
    seededRecord.content.version,
  )
  await editor.evaluate((element) => {
    element.style.minHeight = ""
  })
  await outerQuote.evaluate((element) => {
    element.style.paddingBottom = ""
  })
  const textDrag = await leaf.evaluate((element) => {
    const text = element.firstChild
    if (!(text instanceof Text)) throw new TypeError("Missing nested paragraph text")
    const point = (offset) => {
      const range = document.createRange()
      range.setStart(text, offset)
      range.setEnd(text, offset)
      const rect = range.getBoundingClientRect()
      return { x: rect.left, y: rect.top + rect.height / 2 }
    }
    return { start: point(1), end: point(3) }
  })
  await page.mouse.move(textDrag.start.x, textDrag.start.y)
  await page.mouse.down()
  await page.mouse.move(textDrag.end.x, textDrag.end.y, { steps: 4 })
  await page.mouse.up()
  assert.equal(await page.evaluate(() => document.getSelection()?.toString()), "bc")
  await page.mouse.move(leafBox.x + leafBox.width / 2, leafBox.y + leafBox.height / 2)
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2, {
    steps: 25,
  })
  assert.equal(
    await page.locator(".block-controls:visible").getAttribute("data-target-block-id"),
    leafId,
  )
  await grip.click()
  const menu = page.getByRole("menu", { name: "블록 작업" })
  await menu.waitFor()
  const retainedTextAfterMenuFocus = await page.evaluate(
    () => document.getSelection()?.toString() ?? "",
  )
  assert.equal(await menu.getAttribute("data-target-block-id"), leafId)
  await page.evaluate(() => {
    window.__nestedClipboardTypes = []
    window.__nestedOriginalSetData = DataTransfer.prototype.setData
    DataTransfer.prototype.setData = function recordNestedClipboard(type, data) {
      window.__nestedClipboardTypes.push(type)
      return window.__nestedOriginalSetData.call(this, type, data)
    }
  })
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.waitForTimeout(300)
  assert.equal(await leaf.getAttribute("data-block-selected"), "true")
  assert.equal(await menu.getAttribute("data-target-block-id"), leafId)
  await page.keyboard.press("Control+c")
  await page.waitForFunction(() => window.__nestedClipboardTypes.length > 0)
  const nestedClipboardTypes = await page.evaluate(() => {
    DataTransfer.prototype.setData = window.__nestedOriginalSetData
    return window.__nestedClipboardTypes
  })
  assert.deepEqual(nestedClipboardTypes.sort(), ["application/x-block-editor+json", "text/plain"])
  await page.keyboard.press("Escape")
  assert.equal(await leaf.getAttribute("data-block-selected"), "true")
  await grip.click({ modifiers: ["Control"] })
  assert.equal(await leaf.getAttribute("data-block-selected"), null)
  await grip.click({ modifiers: ["Control"] })
  assert.equal(await leaf.getAttribute("data-block-selected"), "true")
  await grip.click()
  await menu.waitFor()
  await menu.getByRole("menuitem", { name: "복제", exact: true }).click()
  assert.equal(await editor.locator('[data-block-id="outer-quote"]').count(), 1)
  assert.equal(await editor.locator('[data-block-id="middle-callout"]').count(), 1)
  assert.equal(await editor.locator('[data-block-id="middle-callout"] p[data-block-id]').count(), 2)

  await leaf.click()
  await page.keyboard.press("Home")
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("Enter")
  assert.equal(await editor.locator('[data-block-id="outer-quote"]').count(), 1)
  const paragraphIds = await editor
    .locator('[data-block-id="middle-callout"] p[data-block-id]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-block-id")))
  assert.equal(paragraphIds.length, 3)
  assert.equal(new Set(paragraphIds).size, 3)
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()

  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "사용자 조사", exact: true }).click()
  assert.equal(await editor.locator('[data-block-id="outer-quote"]').count(), 1)
  const persistedIds = await editor
    .locator('[data-block-id="middle-callout"] p[data-block-id]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-block-id")))
  assert.equal(persistedIds.length, 3)
  assert.equal(new Set(persistedIds).size, 3)
  assert.deepEqual(errors, [])
  console.log(
    `PASS nested grip ownership and quote split persistence; retained text after menu focus: ${JSON.stringify(retainedTextAfterMenuFocus)}`,
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
