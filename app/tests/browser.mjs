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
    await button("Import and export").click()
    const content = await page.getByRole("dialog").locator("textarea").first().inputValue()
    await button("Cancel").click()
    return JSON.parse(content)
  }
  await page.getByLabel("Save mode", { exact: true }).selectOption("manual")

  await editor.locator("p").first().click()
  await page.keyboard.press("Home")
  await page.keyboard.insertText("E2E 편집 ")
  assert.match(await editor.textContent(), /E2E 편집/)
  await button("Static preview").click()
  assert.match(await page.locator(".static-viewer").textContent(), /E2E 편집/)
  await button("Editor").click()
  await button("Undo").click()
  assert.doesNotMatch(await editor.textContent(), /E2E 편집/)
  await button("Redo").click()
  await button("Save").click()
  await page.reload({ waitUntil: "networkidle" })
  assert.match(await editor.textContent(), /E2E 편집/)
  console.log("PASS editing, preview lifetime, undo/redo, persistence")

  await page.getByRole("button", { name: /B · Work briefing/ }).click()
  const presentation = await snapshot()
  await button("Mark complete").first().click()
  assert.match(await page.locator(".task-card__meta").first().textContent(), /done/)
  assert.deepEqual(await snapshot(), presentation)
  await page.getByRole("button", { name: /C · Read-only/ }).click()
  assert.equal(await editor.getAttribute("contenteditable"), "false")
  const readonly = await snapshot()
  await button("Mark complete").first().click()
  assert.deepEqual(await snapshot(), readonly)
  console.log("PASS task ViewData separation and readonly host actions")

  await page.getByRole("button", { name: /A · Local note/ }).click()
  await button("Create review candidate").click()
  await button("Edit candidate JSON").click()
  const candidate = page.getByRole("dialog").locator("textarea").nth(1)
  const proposed = JSON.parse(await candidate.inputValue())
  proposed.blocks.push({
    id: "browser-review",
    type: "paragraph",
    attrs: {},
    content: [{ kind: "text", text: "후보 수락 검증", marks: [] }],
  })
  await candidate.fill(JSON.stringify(proposed))
  await button("Accept selected changes").click()
  assert.match(await editor.textContent(), /후보 수락 검증/)
  await button("Edit briefing details").click()
  await button("Discard draft").click()
  await button("Import and export").click()
  await page.getByRole("dialog").locator("textarea").nth(1).fill("invalid json")
  await button("Validate and import").click()
  assert.ok(await page.getByRole("alert").isVisible())
  await button("Cancel").click()
  await button("Fetch latest guide").click()
  await page.waitForFunction(() =>
    document.querySelector(".ProseMirror")?.textContent?.includes("reusable cup"),
  )
  await button("Undo").click()
  assert.match(await editor.textContent(), /reusable cup/)
  console.log("PASS review, draft cancel, invalid import, external history reset")

  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.equal(scrollWidth, width)
    assert.ok(await button("Edit briefing details").isVisible())
  }
  assert.deepEqual(errors, [])
  const inspectorScroll = await page.locator(".inspector__body").evaluate((element) => {
    element.scrollTop = element.scrollHeight
    return { top: element.scrollTop, height: element.clientHeight, scroll: element.scrollHeight }
  })
  assert.ok(inspectorScroll.scroll <= inspectorScroll.height || inspectorScroll.top > 0)
  const touch = await browser.newPage({ viewport: { width: 375, height: 900 }, hasTouch: true })
  await touch.goto(baseUrl, { waitUntil: "networkidle" })
  assert.ok(await touch.getByRole("button", { name: /Markdown files/ }).isVisible())
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
  await autosave.getByLabel("Save mode", { exact: true }).selectOption("manual")
  await autosave.locator(".ProseMirror p").first().click()
  await autosave.keyboard.insertText("SAVE-NOW")
  await autosave.getByRole("button", { name: "Save", exact: true }).click()
  assert.ok(
    await autosave.evaluate(() =>
      localStorage.getItem("slate-foundation-document-note")?.includes("SAVE-NOW"),
    ),
  )
  await autosave.getByLabel("Save mode", { exact: true }).selectOption("blur")
  await autosave.locator(".ProseMirror p").first().click()
  await autosave.keyboard.insertText("SAVE-ON-BLUR")
  assert.equal(
    await autosave.evaluate(() =>
      localStorage.getItem("slate-foundation-document-note")?.includes("SAVE-ON-BLUR"),
    ),
    false,
  )
  await autosave.getByRole("button", { name: "Import and export", exact: true }).click()
  await autosave.waitForFunction(() =>
    localStorage.getItem("slate-foundation-document-note")?.includes("SAVE-ON-BLUR"),
  )
  await autosave.getByRole("button", { name: "Cancel", exact: true }).click()
  await autosave.getByLabel("Save mode", { exact: true }).selectOption("throttle")
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
