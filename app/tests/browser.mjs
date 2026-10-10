import assert from "node:assert/strict"
import { once } from "node:events"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const server = process.env.QA_BASE_URL === undefined ? createApplicationServer() : null
let baseUrl = process.env.QA_BASE_URL
if (server !== null) {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Missing server address")
  baseUrl = `http://127.0.0.1:${address.port}`
}
if (baseUrl === undefined) throw new TypeError("Missing browser test base URL")

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(baseUrl, { waitUntil: "networkidle" })
  const editor = page.locator(".ProseMirror")
  const button = (name) => page.getByRole("button", { name, exact: true })
  const snapshot = async () => {
    await button("가져오기와 내보내기").click()
    const content = await page.getByRole("dialog").locator("textarea").first().inputValue()
    await button("취소").click()
    return JSON.parse(content)
  }
  await page.getByLabel("저장 방식", { exact: true }).selectOption("manual")

  await editor.locator("p").first().click()
  await page.keyboard.press("Home")
  await page.keyboard.insertText("E2E 편집 ")
  assert.match(await editor.textContent(), /E2E 편집/)
  await button("정적 미리보기").click()
  assert.match(await page.locator(".static-viewer").textContent(), /E2E 편집/)
  await button("편집기").click()
  await button("실행 취소").click()
  assert.doesNotMatch(await editor.textContent(), /E2E 편집/)
  await button("다시 실행").click()
  await button("저장").click()
  await page.reload({ waitUntil: "networkidle" })
  assert.match(await editor.textContent(), /E2E 편집/)
  console.log("PASS editing, preview lifetime, undo/redo, persistence")

  await page.getByRole("button", { name: /B · 작업 브리핑/ }).click()
  const presentation = await snapshot()
  await button("완료로 표시").first().click()
  assert.match(await page.locator(".task-card__meta").first().textContent(), /done/)
  assert.deepEqual(await snapshot(), presentation)
  await page.getByRole("button", { name: /C · 읽기 전용/ }).click()
  assert.equal(await editor.getAttribute("contenteditable"), "false")
  const readonly = await snapshot()
  await button("완료로 표시").first().click()
  assert.deepEqual(await snapshot(), readonly)
  console.log("PASS task ViewData separation and readonly host actions")

  await page.getByRole("button", { name: /A · 로컬 노트/ }).click()
  await button("검토 후보 만들기").click()
  await button("후보 JSON 편집").click()
  const candidate = page.getByRole("dialog").locator("textarea").nth(1)
  const proposed = JSON.parse(await candidate.inputValue())
  proposed.blocks.push({
    id: "browser-review",
    type: "paragraph",
    attrs: {},
    content: [{ kind: "text", text: "후보 수락 검증", marks: [] }],
  })
  await candidate.fill(JSON.stringify(proposed))
  await button("선택한 변경 수락").click()
  assert.match(await editor.textContent(), /후보 수락 검증/)
  await button("브리핑 정보 편집").click()
  await button("초안 취소").click()
  await button("가져오기와 내보내기").click()
  await page.getByRole("dialog").locator("textarea").nth(1).fill("invalid json")
  await button("검증 후 가져오기").click()
  assert.ok(await page.getByRole("alert").isVisible())
  await button("취소").click()
  await button("최신 안내 가져오기").click()
  await page.waitForFunction(() =>
    document.querySelector(".ProseMirror")?.textContent?.includes("개인 컵"),
  )
  await button("실행 취소").click()
  assert.match(await editor.textContent(), /개인 컵/)
  console.log("PASS review, draft cancel, invalid import, external history reset")

  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.equal(scrollWidth, width)
    assert.ok(await button("브리핑 정보 편집").isVisible())
  }
  assert.deepEqual(errors, [])
  const inspectorScroll = await page.locator(".inspector__body").evaluate((element) => {
    element.scrollTop = element.scrollHeight
    return { top: element.scrollTop, height: element.clientHeight, scroll: element.scrollHeight }
  })
  assert.ok(inspectorScroll.scroll <= inspectorScroll.height || inspectorScroll.top > 0)
  const touch = await browser.newPage({ viewport: { width: 375, height: 900 }, hasTouch: true })
  await touch.goto(baseUrl, { waitUntil: "networkidle" })
  assert.ok(await touch.getByRole("button", { name: /Markdown 파일/ }).isVisible())
  const targets = await touch
    .locator(".tool, .tabs button, .mini-tabs button")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      })),
    )
  assert.ok(targets.every((target) => target.width >= 44 && target.height >= 44))
  await touch.close()
  const autosave = await browser.newPage()
  await autosave.addInitScript(() => {
    globalThis.documentWrites = 0
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === "slate-foundation-document-note") globalThis.documentWrites += 1
      return original.call(this, key, value)
    }
  })
  await autosave.goto(baseUrl, {
    waitUntil: "networkidle",
  })
  await autosave.locator(".ProseMirror p").first().click()
  await autosave.keyboard.type("DEBOUNCE-BURST", { delay: 5 })
  await autosave.waitForFunction(() =>
    localStorage.getItem("slate-foundation-document-note")?.includes("DEBOUNCE-BURST"),
  )
  assert.equal(await autosave.evaluate(() => globalThis.documentWrites), 1)
  await autosave.getByLabel("저장 방식", { exact: true }).selectOption("manual")
  await autosave.locator(".ProseMirror p").first().click()
  await autosave.keyboard.insertText("SAVE-NOW")
  await autosave.getByRole("button", { name: "저장", exact: true }).click()
  assert.ok(
    await autosave.evaluate(() =>
      localStorage.getItem("slate-foundation-document-note")?.includes("SAVE-NOW"),
    ),
  )
  await autosave.getByLabel("저장 방식", { exact: true }).selectOption("blur")
  await autosave.locator(".ProseMirror p").first().click()
  await autosave.keyboard.insertText("SAVE-ON-BLUR")
  assert.equal(
    await autosave.evaluate(() =>
      localStorage.getItem("slate-foundation-document-note")?.includes("SAVE-ON-BLUR"),
    ),
    false,
  )
  await autosave.getByRole("button", { name: "가져오기와 내보내기", exact: true }).click()
  await autosave.waitForFunction(() =>
    localStorage.getItem("slate-foundation-document-note")?.includes("SAVE-ON-BLUR"),
  )
  await autosave.getByRole("button", { name: "취소", exact: true }).click()
  await autosave.getByLabel("저장 방식", { exact: true }).selectOption("throttle")
  await autosave.evaluate(() => {
    globalThis.documentWrites = 0
  })
  await autosave.locator(".ProseMirror p").first().click()
  await autosave.keyboard.type("THROTTLE-BURST", { delay: 5 })
  await autosave.waitForFunction(() =>
    localStorage.getItem("slate-foundation-document-note")?.includes("THROTTLE-BURST"),
  )
  assert.equal(await autosave.evaluate(() => globalThis.documentWrites), 1)
  await autosave.close()
  console.log("PASS manual, debounce, throttle and blur persistence policies")
  console.log("PASS responsive controls and zero page exceptions")
} finally {
  await browser.close()
  if (server !== null) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
