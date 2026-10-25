import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const root = await mkdtemp(join(tmpdir(), "structured-workspace-browser-"))
const server = createApplicationServer({
  runtimeRoot: root,
  sessionSecret: "structured-browser-secret-value",
})
server.listen(0, "127.0.0.1")
await once(server, "listening")
const address = server.address()
if (address === null || typeof address === "string") throw new TypeError("Missing address")
const base = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${base}/?workspace=structured-workspace`, { waitUntil: "networkidle" })
  const workspace = page.getByLabel("Documents and databases")
  await workspace.waitFor()

  await workspace.getByRole("button", { name: "User Research", exact: true }).click()
  const nestedHeading = workspace.locator('h3[data-semantic-depth="3"]')
  await nestedHeading.waitFor()
  assert.equal(await nestedHeading.textContent(), "Research Notes")
  await nestedHeading.click()
  await page.keyboard.press("End")
  await page.keyboard.insertText(" 편집")
  assert.equal(await nestedHeading.textContent(), "Research Notes 편집")
  await page.keyboard.press("ControlOrMeta+z")
  assert.equal(await nestedHeading.textContent(), "Research Notes")
  await page.keyboard.press("End")
  await page.keyboard.insertText(" 저장됨")
  await page.getByRole("status").filter({ hasText: "Saved all changes." }).waitFor()

  await workspace.getByRole("button", { name: "Product Launch", exact: true }).click()
  const pastePolicy = workspace.getByLabel("Paste behavior")
  assert.equal(await pastePolicy.inputValue(), "clone")
  await pastePolicy.selectOption("reference")
  assert.equal(await pastePolicy.inputValue(), "reference")
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "Product Launch", exact: true }).click()
  assert.equal(await workspace.getByLabel("Paste behavior").inputValue(), "reference")
  await pastePolicy.selectOption("clone")
  await workspace
    .getByRole("navigation", { name: "Backlinks" })
    .getByRole("button", {
      name: "Team Home",
    })
    .click()
  await workspace.locator(".structured-topbar h1", { hasText: "Team Home" }).waitFor()
  assert.equal(new URL(page.url()).hash, "#home-link")
  assert.equal(
    await workspace
      .getByRole("button", { name: /Linked page · Product Launch/ })
      .evaluate((element) => element === document.activeElement),
    true,
  )
  await workspace.getByRole("button", { name: "Product Launch", exact: true }).click()
  const occurrences = workspace.locator(".structured-sync")
  assert.equal(await occurrences.count(), 2)
  const second = await browser.newPage({ viewport: { width: 768, height: 900 } })
  await second.goto(`${base}/?workspace=structured-workspace`, { waitUntil: "networkidle" })
  await second
    .getByLabel("Documents and databases")
    .getByRole("button", { name: "Product Launch", exact: true })
    .click()
  const firstShared = occurrences.first().getByLabel(/Synced section/)
  const secondShared = occurrences.nth(1).getByLabel(/Synced section/)
  await firstShared.locator("p").click()
  assert.equal(await firstShared.getAttribute("contenteditable"), "true")
  assert.equal(await secondShared.getAttribute("contenteditable"), "false")
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.insertText("두 위치에 자동으로 반영된 출시 메모")
  await page.getByRole("status").filter({ hasText: "Saved all changes." }).waitFor()
  assert.deepEqual(await occurrences.locator("p").allTextContents(), [
    "두 위치에 자동으로 반영된 출시 메모",
    "두 위치에 자동으로 반영된 출시 메모",
  ])
  await second.getByText("두 위치에 자동으로 반영된 출시 메모").first().waitFor()

  await page.route("**/api/workspace/pages/project", async (route) => {
    if (route.request().method() === "PUT")
      await new Promise((resolve) => setTimeout(resolve, 2_500))
    await route.continue()
  })
  const pageSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith("/api/workspace/pages/project"),
  )
  const databaseSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith("/api/workspace/databases/tasks"),
  )
  const projectHeading = workspace.locator('.structured-prosemirror h2[data-semantic-depth="2"]')
  await projectHeading.click()
  await page.keyboard.press("End")
  await page.keyboard.insertText(" 동시 저장")
  await workspace.getByLabel("task-2 Status").selectOption("In progress")
  assert.equal((await databaseSaved).status(), 200)
  await page.waitForTimeout(1_600)
  assert.match(await projectHeading.textContent(), /동시 저장/u)
  assert.equal((await pageSaved).status(), 200)
  await page.unroute("**/api/workspace/pages/project")

  await occurrences.first().getByRole("button", { name: "Duplicate", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "Saved all changes." }).waitFor()
  assert.equal(await occurrences.count(), 3)
  const occurrenceIds = await occurrences.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-occurrence-id")),
  )
  assert.equal(new Set(occurrenceIds).size, 3)
  await occurrences.first().getByRole("button", { name: "Unlink", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "Saved all changes." }).waitFor()
  await page.waitForFunction(() => document.querySelectorAll(".structured-sync").length === 2)
  assert.equal(await occurrences.count(), 2)
  const sourceAfterUnlink = await (await page.request.get(`${base}/api/workspace`)).json()
  assert.equal(
    sourceAfterUnlink.sources[0].content.section.children[0].text,
    "두 위치에 자동으로 반영된 출시 메모",
  )

  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "User Research", exact: true }).click()
  assert.equal(
    await workspace.locator('h3[data-semantic-depth="3"]').textContent(),
    "Research Notes 저장됨",
  )
  await workspace.getByRole("button", { name: "Product Launch", exact: true }).click()
  assert.equal(await workspace.getByLabel("task-2 Status").inputValue(), "In progress")
  assert.equal(
    await occurrences.first().locator("p").textContent(),
    "두 위치에 자동으로 반영된 출시 메모",
  )

  await workspace.getByRole("button", { name: "Favorite Product Launch" }).click()
  assert.equal(
    await workspace
      .getByRole("button", { name: "Favorite Product Launch" })
      .getAttribute("aria-pressed"),
    "true",
  )
  await workspace.getByRole("button", { name: "Archive User Research" }).click()
  await workspace.getByRole("button", { name: "Restore User Research" }).click()
  const newPageButton = workspace.getByRole("button", { name: "New page" })
  await newPageButton.click()
  const createTitle = page.getByRole("dialog").getByLabel("Page title")
  assert.equal(await createTitle.evaluate((element) => element === document.activeElement), true)
  await page.keyboard.press("Escape")
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  assert.equal(await newPageButton.evaluate((element) => element === document.activeElement), true)
  await newPageButton.click()
  await page.getByRole("dialog").getByLabel("Page title").fill("출시 회고")
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click()
  await workspace.locator(".structured-topbar h1", { hasText: "출시 회고" }).waitFor()
  const newPageEditor = workspace.getByLabel("Structured document editor").last()
  const emptyParagraph = newPageEditor.locator("p").last()
  await emptyParagraph.click()
  await page.keyboard.insertText("첫째")
  await page.keyboard.press("Enter")
  await page.keyboard.insertText("둘째")
  await page.keyboard.press("Enter")
  await page.keyboard.insertText("셋째")
  const wrapParagraphs = newPageEditor.locator("p[data-block-id]")
  await wrapParagraphs.first().click({ modifiers: ["Control"] })
  await wrapParagraphs.nth(2).click({ modifiers: ["Control"] })
  await wrapParagraphs.nth(2).hover()
  const workspaceGrip = page.locator(".block-control--grip:visible")
  await workspaceGrip.click()
  const blockMenu = page.getByRole("menu", { name: "Block actions" })
  await blockMenu
    .getByRole("menuitem", { name: "Expand selection (include 1 intermediate blocks)" })
    .click()
  assert.equal(await newPageEditor.locator(".block-selected").count(), 3)
  await page.getByRole("status").filter({ hasText: "3 blocks selected" }).waitFor()
  await wrapParagraphs.nth(2).hover()
  await workspaceGrip.click()
  await blockMenu.getByRole("menuitem", { name: "Wrap selection → Section" }).click()
  const wrappedSection = newPageEditor.locator(".structured-section").last()
  await wrappedSection.waitFor()
  assert.deepEqual(await wrappedSection.locator("p").allTextContents(), ["첫째", "둘째", "셋째"])
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".structured-section"))
        .at(-1)
        ?.getAttribute("data-block-selected") === "true",
  )
  assert.equal(await wrappedSection.getAttribute("data-block-selected"), "true")
  await page.keyboard.press("ControlOrMeta+z")
  assert.equal(await newPageEditor.locator("p[data-block-id]").count(), 3)
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await wrappedSection.waitFor()
  await page.getByRole("status").filter({ hasText: "Saved all changes." }).waitFor()
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "출시 회고", exact: true }).click()
  await workspace.locator(".structured-section", { hasText: "둘째" }).last().waitFor()

  await second.close()

  await page.setViewportSize({ width: 375, height: 900 })
  const treeToggle = workspace.getByRole("button", { name: /Page navigation/ })
  assert.equal(await treeToggle.getAttribute("aria-expanded"), "false")
  await treeToggle.click()
  assert.equal(await treeToggle.getAttribute("aria-expanded"), "true")
  assert.equal(
    await workspace
      .getByRole("button", { name: "출시 회고", exact: true })
      .getAttribute("aria-current"),
    "page",
  )
  assert.ok(
    (await workspace
      .getByRole("button", { name: "Favorite 출시 회고" })
      .evaluate((element) => element.getBoundingClientRect().height)) >= 44,
  )
  assert.ok(
    (await workspace
      .getByLabel("Search pages")
      .evaluate((element) => element.getBoundingClientRect().height)) >= 44,
  )
  await workspace.getByRole("button", { name: "Product Launch", exact: true }).click()
  await page.setViewportSize({ width: 1280, height: 900 })
  const localVisualBlock = workspace
    .locator(".structured-prosemirror > .structured-section")
    .first()
  const localVisualId = await localVisualBlock.getAttribute("data-block-id")
  const localVisualBox = await localVisualBlock.boundingBox()
  if (localVisualBox === null) throw new TypeError("Missing local visual block geometry")
  await page.mouse.move(localVisualBox.x + 2, localVisualBox.y + localVisualBox.height / 2)
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(".block-controls:not([hidden])")
        ?.getAttribute("data-target-block-id") === id,
    localVisualId,
  )
  const visualGrip = page.locator(".block-control--grip:visible")
  await visualGrip.click()
  await page.getByRole("menu", { name: "Block actions" }).waitFor()
  await page.keyboard.press("Escape")
  assert.equal(await localVisualBlock.getAttribute("data-block-selected"), "true")
  const syncedVisualBlock = occurrences.first()
  await syncedVisualBlock
    .locator("header > span:not([data-sync-label])")
    .click({ modifiers: ["Control"] })
  assert.equal(await localVisualBlock.getAttribute("data-block-selected"), null)
  assert.equal(await syncedVisualBlock.getAttribute("data-block-selected"), "true")
  const combinedColors = await syncedVisualBlock.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      background: style.backgroundColor,
      strip: style.borderInlineStartColor,
      outline: style.outlineColor,
    }
  })
  assert.notEqual(combinedColors.strip, combinedColors.outline)
  assert.notEqual(combinedColors.background, "rgba(0, 0, 0, 0)")
  await page.screenshot({
    path: "/tmp/structured-workspace-selected-sync-1280.png",
    fullPage: true,
  })
  await page.keyboard.press("Escape")
  await page.setViewportSize({ width: 375, height: 900 })
  assert.ok(
    (await workspace
      .getByRole("button", { name: "Add row" })
      .evaluate((element) => element.getBoundingClientRect().height)) >= 44,
  )
  assert.ok(
    (await workspace
      .getByLabel("task-2 Status")
      .evaluate((element) => element.getBoundingClientRect().height)) >= 44,
  )
  await workspace.getByText("Scroll the table horizontally to view all properties.").waitFor()
  await workspace.getByRole("region", { name: "Launch Tasks table" }).waitFor()
  assert.equal(
    await occurrences
      .first()
      .locator("p")
      .evaluate((element) => getComputedStyle(element).overflowWrap),
    "anywhere",
  )
  await treeToggle.click()

  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      true,
    )
    await page.screenshot({ path: `/tmp/structured-workspace-${width}.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log(
    "PASS nested headings, paste policy, backlinks, durable edits, synced occurrences, expanded wrapping with undo/redo, page creation, and responsive screenshots",
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
