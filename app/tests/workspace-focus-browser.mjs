import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const focusHash = (target) => `#focus=${encodeURIComponent(JSON.stringify(target))}`
const root = await mkdtemp(join(tmpdir(), "workspace-focus-"))
const server = createApplicationServer({
  runtimeRoot: root,
  sessionSecret: "workspace-focus-secret-value",
})
server.listen(0, "127.0.0.1")
await once(server, "listening")
const address = server.address()
if (address === null || typeof address === "string") throw new TypeError("Missing address")
const base = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
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
          { id: "outside-before", type: "paragraph", text: "Outside before" },
          {
            id: "focus-section",
            type: "section",
            heading: "Focus section",
            children: [
              {
                id: "focus-callout",
                type: "callout",
                children: [
                  { id: "focus-leaf", type: "paragraph", text: "Focused canonical text" },
                  { id: "focus-sibling", type: "paragraph", text: "Hidden sibling" },
                ],
              },
            ],
          },
          { id: "outside-after", type: "paragraph", text: "Outside after" },
        ],
      },
    },
  })
  assert.equal(seeded.status(), 200)
  await page.reload({ waitUntil: "networkidle" })
  const workspace = page.getByLabel("Documents and databases")
  await workspace.getByRole("button", { name: "User Research", exact: true }).click()
  const openBlock = async (block) => {
    await block.click()
    await block.hover()
    const blockId =
      (await block.getAttribute("data-block-id")) ??
      (await block.getAttribute("data-source-block-id"))
    assert.notEqual(blockId, null)
    const rail = page.locator(`.block-controls[data-target-block-id="${blockId}"]`)
    await rail.waitFor({ state: "visible" })
    await rail.getByRole("button", { name: "Block menu and drag handle", exact: true }).click()
    const focusAction = page.getByRole("menuitem", { name: "Focus view", exact: true })
    assert.equal(
      await focusAction.count(),
      1,
      JSON.stringify({
        blockId,
        menus: await page.locator(".block-menu").allTextContents(),
        visibleMenus: await page.locator(".block-menu:visible").count(),
        sourceEditors: await page.locator(".structured-sync__content .ProseMirror").count(),
      }),
    )
    await focusAction.click()
  }
  const selectedBlockId = () =>
    page.evaluate(() => {
      const anchor = window.getSelection()?.anchorNode
      const element = anchor instanceof Element ? anchor : anchor?.parentElement
      return (
        element
          ?.closest("[data-block-id], [data-source-block-id]")
          ?.getAttribute("data-block-id") ??
        element
          ?.closest("[data-block-id], [data-source-block-id]")
          ?.getAttribute("data-source-block-id") ??
        null
      )
    })
  const removeThroughGrip = async (block, action) => {
    await block.hover()
    const blockId =
      (await block.getAttribute("data-block-id")) ??
      (await block.getAttribute("data-source-block-id"))
    assert.notEqual(blockId, null)
    const rail = page.locator(`.block-controls[data-target-block-id="${blockId}"]`)
    await rail.waitFor({ state: "visible" })
    await rail.getByRole("button", { name: "Block menu and drag handle", exact: true }).click()
    await page.getByRole("menuitem", { name: action, exact: true }).click()
  }
  await openBlock(workspace.locator('[data-block-id="focus-leaf"]'))
  assert.equal(
    await page.evaluate(() => window.location.hash),
    focusHash({ kind: "local", blockId: "focus-leaf" }),
  )
  await page.getByRole("navigation", { name: "Focus view path" }).waitFor()
  let editor = workspace.getByLabel("Structured document editor").last()
  assert.equal(await editor.locator('[data-block-id="outside-before"]:visible').count(), 0)
  assert.equal(await editor.locator('[data-block-id="focus-leaf"]:visible').count(), 1)
  await editor.locator('[data-block-id="focus-leaf"]').click()
  await page.keyboard.press("End")
  await page.keyboard.insertText(" local-edit")
  const localHistoryLength = await page.evaluate(() => window.history.length)
  await page.keyboard.press("Enter")
  await page.keyboard.insertText("Temporary local sibling")
  const localSiblingId = await selectedBlockId()
  assert.notEqual(localSiblingId, null)
  assert.notEqual(localSiblingId, "focus-leaf")
  const localSibling = editor.locator(`[data-block-id="${localSiblingId}"]`)
  assert.equal(await localSibling.isVisible(), true)
  assert.equal(
    await page.evaluate(() => window.location.hash),
    focusHash({ kind: "local", blockId: localSiblingId }),
  )
  assert.equal(await page.evaluate(() => window.history.length), localHistoryLength)
  await removeThroughGrip(localSibling, "Delete")
  assert.equal(
    await page.evaluate(() => window.location.hash),
    focusHash({ kind: "local", blockId: "focus-callout" }),
  )
  await page.getByRole("status").filter({ hasText: "Saved all changes." }).waitFor()
  await page.reload({ waitUntil: "networkidle" })
  assert.equal(
    await page.evaluate(() => window.location.hash),
    focusHash({ kind: "local", blockId: "focus-callout" }),
  )
  await workspace.locator('[data-block-id="focus-callout"]:visible').waitFor()
  editor = workspace.getByLabel("Structured document editor").last()
  await page
    .getByRole("navigation", { name: "Focus view path" })
    .getByRole("button")
    .first()
    .click()
  assert.equal(await editor.locator('[data-block-id="outside-before"]:visible').count(), 1)

  const section = editor.locator('[data-block-id="focus-section"]')
  await section.hover()
  await section.getByRole("button", { name: "Convert to shared section", exact: true }).click()
  let synced = editor.locator(".structured-sync").first()
  await synced.waitFor()
  await page.getByRole("status").filter({ hasText: "Saved all changes." }).waitFor()
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "User Research", exact: true }).click()
  editor = workspace.getByLabel("Structured document editor").last()
  synced = editor.locator(".structured-sync").first()
  await synced.waitFor()
  const occurrenceId = await synced.getAttribute("data-occurrence-id")
  if (occurrenceId === null) throw new TypeError("Missing shared occurrence")
  const sharedPayload = await (await page.request.get(`${base}/api/workspace`)).json()
  const sharedPage = sharedPayload.documents.find(
    (record) => record.documentId === "research",
  )?.content
  const sharedOccurrence = sharedPage?.blocks.find((block) => block.id === "focus-section")
  const sharedSource = sharedPayload.sources.find(
    (record) => record.documentId === sharedOccurrence?.ref?.sourceId,
  )?.content
  const findTextBlock = (block) => {
    if (block.text?.includes("Focused canonical text")) return block
    for (const child of block.children ?? []) {
      const found = findTextBlock(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  const sharedLeafId =
    sharedSource === undefined ? undefined : findTextBlock(sharedSource.section)?.id
  if (sharedLeafId === undefined) throw new TypeError("Missing canonical shared leaf")
  await openBlock(
    synced.locator(`[data-block-id="${sharedLeafId}"], [data-source-block-id="${sharedLeafId}"]`),
  )
  await page.getByRole("navigation", { name: "Focus view path" }).waitFor()
  assert.equal(await editor.locator('[data-block-id="outside-before"]:visible').count(), 0)
  assert.equal(await editor.locator('[data-block-id="outside-after"]:visible').count(), 0)
  assert.equal(await synced.locator('[data-source-block-id="focus-sibling"]:visible').count(), 0)
  const sharedLeaf = synced.locator(
    `[data-block-id="${sharedLeafId}"], [data-source-block-id="${sharedLeafId}"]`,
  )
  await sharedLeaf.click()
  await page.keyboard.press("End")
  await page.keyboard.insertText(" shared-edit")
  const sharedHistoryLength = await page.evaluate(() => window.history.length)
  await page.keyboard.press("Enter")
  await page.keyboard.insertText("Temporary shared sibling")
  const sharedSiblingId = await selectedBlockId()
  assert.notEqual(sharedSiblingId, null)
  assert.notEqual(sharedSiblingId, sharedLeafId)
  const sharedSibling = synced.locator(
    `[data-block-id="${sharedSiblingId}"], [data-source-block-id="${sharedSiblingId}"]`,
  )
  assert.equal(await sharedSibling.isVisible(), true)
  assert.equal(
    await page.evaluate(() => window.location.hash),
    focusHash({ kind: "shared", occurrenceId, blockId: sharedSiblingId }),
  )
  assert.equal(await page.evaluate(() => window.history.length), sharedHistoryLength)
  await page.getByRole("status").filter({ hasText: "Saved all changes." }).waitFor()
  await removeThroughGrip(sharedSibling, "Cut")
  const deletedSharedHash = focusHash({ kind: "shared", occurrenceId, blockId: sharedSiblingId })
  await sharedSibling.waitFor({ state: "detached" })
  await page.getByRole("status").filter({ hasText: "Saved all changes." }).waitFor()
  await page.waitForFunction((hash) => window.location.hash !== hash, deletedSharedHash)
  const sharedFallbackHash = await page.evaluate(() => window.location.hash)
  assert.notEqual(sharedFallbackHash, deletedSharedHash)
  assert.equal(await synced.locator('[data-block-id="focus-sibling"]:visible').count(), 1)
  assert.equal(await workspace.getByLabel("Page to link").count(), 0)
  assert.equal(await workspace.getByRole("navigation", { name: "Backlinks" }).count(), 0)

  await page.reload({ waitUntil: "networkidle" })
  assert.equal(await page.evaluate(() => window.location.hash), sharedFallbackHash)
  await workspace.getByRole("navigation", { name: "Focus view path" }).waitFor()
  await page.goBack({ waitUntil: "networkidle" })
  assert.equal(await workspace.getByRole("navigation", { name: "Focus view path" }).count(), 0)
  await page.goForward({ waitUntil: "networkidle" })
  assert.equal(await page.evaluate(() => window.location.hash), sharedFallbackHash)
  await workspace.getByRole("navigation", { name: "Focus view path" }).waitFor()

  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      true,
    )
    await page.screenshot({ path: `/tmp/opencode/workspace-focus-${width}.png`, fullPage: true })
  }

  await page
    .getByRole("navigation", { name: "Focus view path" })
    .getByRole("button")
    .first()
    .click()
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "User Research", exact: true }).click()
  const persisted = await (await page.request.get(`${base}/api/workspace`)).json()
  const persistedPage = persisted.documents.find(
    (record) => record.documentId === "research",
  )?.content
  const occurrence = persistedPage?.blocks.find((block) => block.id === "focus-section")
  assert.equal(persistedPage?.blocks[0]?.text, "Outside before")
  assert.equal(persistedPage?.blocks[2]?.text, "Outside after")
  assert.equal(occurrence?.occurrenceId, occurrenceId)
  assert.equal(occurrence?.children.length, 0)
  const sourceId = occurrence?.ref?.sourceId
  const source = persisted.sources.find((record) => record.documentId === sourceId)
  assert.equal(source?.content.id, sourceId)
  assert.match(JSON.stringify(source?.content.section), /local-edit shared-edit/)
  assert.deepEqual(errors, [])
  console.log(
    `PASS focused local/shared canonical edits; occurrence ${occurrenceId}; source ${sourceId}`,
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
