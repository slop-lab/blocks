import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const runtimeRoot = await mkdtemp(join(tmpdir(), "block-level-drag-"))
const server = createApplicationServer({ runtimeRoot })
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base })
  await page.goto(`${base}/?workspace=structured-workspace`, { waitUntil: "networkidle" })
  const editor = page.locator(
    ".ProseMirror[contenteditable='true'][aria-label='구조화 문서 편집기']",
  )
  await editor.waitFor()
  const rootBlocks = editor.locator(":scope > [data-block-id]")
  const section = rootBlocks.first()
  const targetSection = rootBlocks.last()
  const sourceId = await section.locator("p[data-block-id]").first().getAttribute("data-block-id")
  if (sourceId == null) throw new TypeError("Missing nested drag source")
  const source = section.locator(`[data-block-id="${sourceId}"]`)
  const grip = page.getByRole("button", { name: "블록 메뉴 및 드래그", exact: true })

  await source.hover()
  const gripBox = await grip.boundingBox()
  const rootTargetBox = await targetSection.boundingBox()
  if (gripBox === null || rootTargetBox === null) throw new TypeError("Missing root drag geometry")
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    rootTargetBox.x + rootTargetBox.width / 2,
    rootTargetBox.y + rootTargetBox.height + 4,
    {
      steps: 12,
    },
  )
  await page.mouse.up()
  const rootCount = await editor.locator(`:scope > [data-block-id="${sourceId}"]`).count()
  if (rootCount !== 1) {
    const location = await editor.locator(`[data-block-id="${sourceId}"]`).evaluate((element) => ({
      parentId: element.parentElement?.closest("[data-block-id]")?.getAttribute("data-block-id"),
      selected: element.getAttribute("data-block-selected"),
    }))
    throw new TypeError(`Nested-to-root drag failed: ${JSON.stringify(location)}`)
  }

  const foreignBox = await page.evaluate((id) => {
    const element = document.createElement("div")
    element.dataset.blockId = id
    element.dataset.foreignDropFixture = "true"
    Object.assign(element.style, {
      position: "fixed",
      right: "8px",
      top: "80px",
      width: "160px",
      height: "80px",
      zIndex: "9999",
    })
    document.body.append(element)
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }, sourceId)
  const rootSourceBeforeForeignDrop = editor.locator(`:scope > [data-block-id="${sourceId}"]`)
  await rootSourceBeforeForeignDrop.hover()
  const foreignGripBox = await grip.boundingBox()
  if (foreignGripBox === null) throw new TypeError("Missing foreign-target drag geometry")
  await page.mouse.move(
    foreignGripBox.x + foreignGripBox.width / 2,
    foreignGripBox.y + foreignGripBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(foreignBox.x + foreignBox.width / 2, foreignBox.y + foreignBox.height / 2, {
    steps: 8,
  })
  await page.mouse.up()
  assert.equal(await editor.locator(`:scope > [data-block-id="${sourceId}"]`).count(), 1)
  await page.locator("[data-foreign-drop-fixture]").evaluate((element) => element.remove())

  const staleSource = editor.locator(`:scope > [data-block-id="${sourceId}"]`)
  await staleSource.hover()
  const staleGripBox = await grip.boundingBox()
  const staleSectionBox = await section.boundingBox()
  if (staleGripBox === null || staleSectionBox === null)
    throw new TypeError("Missing stale-gesture geometry")
  await page.mouse.move(
    staleGripBox.x + staleGripBox.width / 2,
    staleGripBox.y + staleGripBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    staleSectionBox.x + staleSectionBox.width - 24,
    staleSectionBox.y + staleSectionBox.height - 8,
    { steps: 8 },
  )
  await page.keyboard.press("Control+z")
  await page.mouse.up()
  assert.equal(await section.locator(`[data-block-id="${sourceId}"]`).count(), 1)
  await editor.focus()
  await page.keyboard.press("Control+Shift+z")
  const rootSource = editor.locator(`:scope > [data-block-id="${sourceId}"]`)
  await rootSource.hover()
  const rootGripBox = await grip.boundingBox()
  const sectionBox = await section.boundingBox()
  if (rootGripBox === null || sectionBox === null)
    throw new TypeError("Missing nested drag geometry")
  await page.mouse.move(
    rootGripBox.x + rootGripBox.width / 2,
    rootGripBox.y + rootGripBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    sectionBox.x + sectionBox.width - 24,
    sectionBox.y + sectionBox.height - 8,
    {
      steps: 12,
    },
  )
  await page.mouse.up()
  assert.equal(await section.locator(`[data-block-id="${sourceId}"]`).count(), 1)

  await page.keyboard.press("Control+z")
  const cutTarget = editor.locator(`:scope > [data-block-id="${sourceId}"]`)
  await cutTarget.hover()
  await grip.click()
  const countBeforeCut = await rootBlocks.count()
  await page.getByRole("menuitem", { name: "잘라내기", exact: true }).click()
  await page.waitForFunction(
    ({ selector, count }) => document.querySelector(selector)?.children.length === count - 1,
    { selector: "[aria-label='구조화 문서 편집기'] [contenteditable]", count: countBeforeCut },
  )
  await page.keyboard.press("Control+z")
  assert.equal(await editor.locator(`:scope > [data-block-id="${sourceId}"]`).count(), 1)
  const countBeforeFailure = await rootBlocks.count()
  await editor.locator(`:scope > [data-block-id="${sourceId}"]`).hover()
  await grip.click()
  await page.evaluate(() => {
    window.__originalBlockSetData = DataTransfer.prototype.setData
    DataTransfer.prototype.setData = () => {
      throw new DOMException("denied", "NotAllowedError")
    }
  })
  await page.getByRole("menuitem", { name: "잘라내기", exact: true }).click()
  await page.waitForFunction(() => document.querySelector(".block-menu")?.hasAttribute("hidden"))
  assert.equal(await rootBlocks.count(), countBeforeFailure)
  await page.evaluate(() => {
    DataTransfer.prototype.setData = window.__originalBlockSetData
  })
  await page.waitForTimeout(700)
  await page.reload({ waitUntil: "networkidle" })
  assert.equal(
    await page
      .locator(".ProseMirror[contenteditable='true'][aria-label='구조화 문서 편집기']")
      .locator(`:scope > [data-block-id="${sourceId}"]`)
      .count(),
    1,
  )
  console.log(
    "PASS pointer nested/root moves, foreign/stale drag rejection, undo/redo/reload, grip Cut, and failed clipboard guard",
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(runtimeRoot, { recursive: true, force: true })
}
