import assert from "node:assert/strict"
import { once } from "node:events"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const server = createApplicationServer()
server.listen(0, "127.0.0.1")
await once(server, "listening")
const address = server.address()
if (address === null || typeof address === "string") throw new TypeError("No test server address")
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
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(base, { waitUntil: "networkidle" })
  const editor = page.getByLabel("Block document editor", { exact: true })
  const firstBlock = editor.locator("[data-block-id]").first()

  await firstBlock.hover()
  const add = page.getByRole("button", { name: "Add a block after this one", exact: true })
  const grip = page.getByRole("button", { name: "Block menu and drag handle", exact: true })
  await assert.doesNotReject(add.waitFor({ state: "visible" }))
  await firstBlock.evaluate((element) => {
    element.style.transform = "translateY(18px)"
    window.dispatchEvent(new Event("resize"))
  })
  await page.waitForTimeout(20)
  const anchored = await page.evaluate(() => {
    const block = document.querySelector("[aria-label='Block document editor'] [data-block-id]")
    const rail = document.querySelector(".block-controls:not([hidden])")
    return block !== null && rail !== null
      ? Math.abs(block.getBoundingClientRect().top - rail.getBoundingClientRect().top) < 1
      : false
  })
  assert.equal(anchored, true)
  await firstBlock.evaluate((element) => {
    element.style.transform = ""
    window.dispatchEvent(new Event("resize"))
  })
  const countBeforeAdd = await editor.locator("[data-block-id]").count()
  await add.click()
  await page.getByRole("menuitem", { name: "Paragraph", exact: true }).click()
  assert.equal(await editor.locator("[data-block-id]").count(), countBeforeAdd + 1)

  await page.keyboard.type("/hea")
  await page.getByRole("menu", { name: "Insert block menu" }).waitFor()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  assert.ok((await editor.locator("h1, h2, h3").count()) > 0)

  await firstBlock.hover()
  const blockMenu = page.getByRole("menu", { name: "Block actions" })
  const jitterBox = await grip.boundingBox()
  if (jitterBox === null) throw new TypeError("Missing grip geometry")
  await page.mouse.move(jitterBox.x + jitterBox.width / 2, jitterBox.y + jitterBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(jitterBox.x + jitterBox.width / 2 + 3, jitterBox.y + jitterBox.height / 2)
  await page.mouse.up()
  await blockMenu.waitFor()
  await page.keyboard.press("Escape")
  await grip.click()
  await blockMenu.waitFor()
  const countBeforeDuplicate = await editor.locator("[data-block-id]").count()
  await blockMenu.getByRole("menuitem", { name: /Duplicate/ }).click()
  assert.equal(await editor.locator("[data-block-id]").count(), countBeforeDuplicate + 1)

  const countBeforeCut = await editor.locator("[data-block-id]").count()
  const cutTarget = editor.locator(":scope > [data-block-id]:not(:has([data-block-id]))").first()
  await cutTarget.hover()
  const cutTargetId = await cutTarget.getAttribute("data-block-id")
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(".block-controls:not([hidden])")
        ?.getAttribute("data-target-block-id") === id,
    cutTargetId,
  )
  await grip.click()
  await blockMenu.waitFor()
  assert.equal(
    await cutTarget.evaluate((element) => element.classList.contains("block-selected")),
    true,
  )
  assert.equal(
    await blockMenu.evaluate((element) => element.contains(element.ownerDocument.activeElement)),
    true,
  )
  await page.evaluate(() => {
    window.__blockClipboardTypes = []
    window.__originalClipboardSetData = DataTransfer.prototype.setData
    DataTransfer.prototype.setData = function recordClipboardType(type, data) {
      window.__blockClipboardTypes.push(type)
      return window.__originalClipboardSetData.call(this, type, data)
    }
  })
  await page.keyboard.press("Control+c")
  await page.waitForFunction(() => window.__blockClipboardTypes.length > 0)
  const clipboardTypes = await page.evaluate(() => {
    DataTransfer.prototype.setData = window.__originalClipboardSetData
    return window.__blockClipboardTypes
  })
  assert.ok(
    clipboardTypes.includes("application/x-block-editor+json"),
    `clipboard types: ${clipboardTypes.join(", ")}`,
  )
  assert.ok(clipboardTypes.includes("text/plain"))
  assert.equal(clipboardTypes.includes("text/html"), false)
  await page.keyboard.press("Control+x")
  assert.equal(await editor.locator("[data-block-id]").count(), countBeforeCut - 1)
  const pasteTarget = editor.locator(":scope > [data-block-id]:not(:has([data-block-id]))").first()
  const pasteTargetId = await pasteTarget.getAttribute("data-block-id")
  await pasteTarget.hover()
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(".block-controls:not([hidden])")
        ?.getAttribute("data-target-block-id") === id,
    pasteTargetId,
  )
  await grip.click()
  await blockMenu.waitFor()
  assert.equal(
    await blockMenu.evaluate((element) => element.contains(element.ownerDocument.activeElement)),
    true,
  )
  await page.keyboard.press("Control+v")
  assert.equal(await editor.locator("[data-block-id]").count(), countBeforeCut)
  const idsAfterPaste = await editor
    .locator("[data-block-id]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-block-id")))
  assert.equal(new Set(idsAfterPaste).size, idsAfterPaste.length)
  await page.keyboard.press("Control+z")
  assert.equal(await editor.locator("[data-block-id]").count(), countBeforeCut - 1)
  assert.equal(await editor.locator(`[data-block-id="${cutTargetId}"]`).count(), 0)
  await page.keyboard.press("Control+z")
  assert.equal(await editor.locator("[data-block-id]").count(), countBeforeCut)
  assert.equal(await editor.locator(`[data-block-id="${cutTargetId}"]`).count(), 1)

  const selectable = editor.locator(":scope > p[data-block-id]")
  const secondSelectable = selectable.nth(1)
  const thirdSelectable = selectable.nth(2)
  const clickWith = async (target, modifier) => {
    await target.waitFor({ state: "visible" })
    await target.click({ modifiers: [modifier] })
  }
  await clickWith(secondSelectable, "Control")
  await page.waitForFunction(
    () => document.querySelector("[aria-label='Block document editor'] .block-selected") !== null,
  )
  assert.equal(
    await editor.locator(".block-selected").count(),
    1,
    "Ctrl-click selects exactly one block",
  )
  await clickWith(thirdSelectable, "Shift")
  assert.equal(
    await editor.locator(".block-selected").count(),
    4,
    "Shift-click extends selection through document order",
  )
  assert.equal(await editor.locator(".block-selected").count(), 4)
  await clickWith(secondSelectable, "Control")
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[aria-label='Block document editor'] .block-selected").length ===
      3,
  )
  assert.equal(await editor.locator(".block-selected").count(), 3)
  await thirdSelectable.click()
  assert.equal(await editor.locator(".block-selected").count(), 0)

  const editorBox = await editor.boundingBox()
  const marqueeStart = await selectable.nth(1).boundingBox()
  const marqueeEnd = await selectable.nth(Math.min(3, (await selectable.count()) - 1)).boundingBox()
  if (editorBox === null || marqueeStart === null || marqueeEnd === null)
    throw new TypeError("Missing marquee geometry")
  const marqueeX = editorBox.x + editorBox.width - 6
  await page.mouse.move(marqueeX, marqueeStart.y + 2)
  await page.mouse.down()
  await page.mouse.move(marqueeX - 2, marqueeEnd.y + marqueeEnd.height - 2, { steps: 12 })
  await page.mouse.up()
  assert.ok((await editor.locator(".block-selected").count()) >= 2)
  assert.equal(
    await editor
      .locator(".block-selected")
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element)
        return (
          style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent"
        )
      }),
    true,
  )
  const countBeforeOutsideClick = await editor.locator("[data-block-id]").count()
  await page.locator("aside[aria-label='Example navigation']").click({ position: { x: 4, y: 4 } })
  assert.equal(await editor.locator(".block-selected").count(), 0)
  assert.equal(await editor.locator("[data-block-id]").count(), countBeforeOutsideClick)

  const movable = editor.locator("[data-block-id]").first()
  const sourceId = await movable.getAttribute("data-block-id")
  await movable.hover()
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(".block-controls:not([hidden])")
        ?.getAttribute("data-target-block-id") === id,
    sourceId,
  )
  await grip.click()
  await blockMenu.waitFor()
  await page.keyboard.press("Escape")
  assert.equal(await movable.getAttribute("data-block-selected"), "true")
  assert.equal(await movable.getAttribute("aria-current"), "true")
  const idsBeforeSingleDrag = await editor
    .locator(":scope > [data-block-id]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-block-id")))
  const destination = editor.locator("[data-block-id]").last()
  const destinationBox = await destination.boundingBox()
  if (destinationBox === null) throw new TypeError("Missing drag destination geometry")
  await grip.dragTo(destination, {
    targetPosition: { x: Math.min(20, destinationBox.width / 2), y: destinationBox.height - 2 },
  })
  const idsAfterSingleDrag = await editor
    .locator(":scope > [data-block-id]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-block-id")))
  assert.equal(idsAfterSingleDrag.length, idsBeforeSingleDrag.length)
  assert.equal(new Set(idsAfterSingleDrag).size, idsAfterSingleDrag.length)
  assert.equal(
    await editor.locator("[data-block-id]").last().getAttribute("data-block-id"),
    sourceId,
  )
  await page.keyboard.press("Control+z")
  assert.deepEqual(
    await editor
      .locator(":scope > [data-block-id]")
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-block-id"))),
    idsBeforeSingleDrag,
  )
  await page.keyboard.press("Control+Shift+z")

  const edgeSource = editor.locator("[data-block-id]").last()
  const edgeSourceId = await edgeSource.getAttribute("data-block-id")
  await edgeSource.hover()
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(".block-controls:not([hidden])")
        ?.getAttribute("data-target-block-id") === id,
    edgeSourceId,
  )
  const gripBox = await grip.boundingBox()
  const firstBox = await editor.locator("[data-block-id]").first().boundingBox()
  if (gripBox === null || firstBox === null) throw new TypeError("Missing drag geometry")
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y - 4, { steps: 5 })
  await page.mouse.up()
  assert.equal(
    await editor.locator("[data-block-id]").first().getAttribute("data-block-id"),
    edgeSourceId,
  )

  await page.keyboard.press("Escape")
  const paragraph = editor.locator("p").first()
  await paragraph.dblclick()
  await page.getByRole("toolbar", { name: "Format selected text" }).waitFor()
  await page.getByRole("button", { name: "Bold", exact: true }).last().click()
  assert.ok((await editor.locator("strong").count()) > 0)
  const linkButton = page.getByRole("button", { name: "Edit link", exact: true }).last()
  await linkButton.click()
  const linkInput = page.getByLabel("Link address", { exact: true })
  assert.equal(await linkInput.getAttribute("type"), "text")
  assert.equal(await linkInput.getAttribute("inputmode"), "url")
  await linkInput.fill("/relative")
  const countBeforeNativeCopy = await editor.locator("[data-block-id]").count()
  await linkInput.press("Control+a")
  await linkInput.press("Control+c")
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "/relative")
  assert.equal(await editor.locator("[data-block-id]").count(), countBeforeNativeCopy)
  await page.getByRole("button", { name: "Apply", exact: true }).click()
  const relativeLink = editor.locator("a[href='/relative']")
  assert.equal(await relativeLink.count(), 1)

  await page.getByRole("button", { name: "Static preview", exact: true }).click()
  const previewLink = page.locator(".static-viewer a[href='/relative']")
  assert.equal(await previewLink.count(), 1)
  let previewLinkFocused = false
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.keyboard.press("Tab")
    previewLinkFocused = await previewLink.evaluate(
      (element) => element.ownerDocument.activeElement === element,
    )
    if (previewLinkFocused) break
  }
  assert.equal(previewLinkFocused, true)
  await page.getByRole("button", { name: "Editor", exact: true }).click()

  await relativeLink.dblclick()
  await linkButton.click()
  assert.equal(await linkInput.inputValue(), "/relative")
  await linkInput.fill("mailto:reader@example.com")
  await page.getByRole("button", { name: "Apply", exact: true }).click()
  const mailLink = editor.locator("a[href='mailto:reader@example.com']")
  assert.equal(await mailLink.count(), 1)

  await mailLink.dblclick()
  await linkButton.click()
  await page.getByRole("button", { name: "Remove link", exact: true }).click()
  assert.equal(await editor.locator("a[href='mailto:reader@example.com']").count(), 0)
  await linkButton.click()
  await linkInput.fill("javascript:alert(1)")
  await page.getByRole("button", { name: "Apply", exact: true }).click()
  await page
    .getByRole("alert")
    .filter({ hasText: /safe web/ })
    .waitFor()
  assert.equal(await linkInput.isVisible(), true)
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  assert.equal(await linkInput.isVisible(), false)

  await page.getByRole("button", { name: /C · Read-only/ }).click()
  await page.getByLabel("Read-only document", { exact: true }).locator("p").first().hover()
  assert.equal(await page.locator(".block-controls:not([hidden])").count(), 0)

  await page.getByRole("button", { name: /B · Work briefing/ }).click()
  await page.locator(".task-card").first().hover()
  await grip.click()
  assert.ok(await page.getByRole("menuitem", { name: "Delete", exact: true }).isVisible())
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: /Write together/ }).click()
  const peer = page.getByLabel("Editor A collaborative editor", { exact: true })
  await peer.locator("p").first().hover()
  await assert.doesNotReject(page.locator(".block-control--grip:visible").waitFor())
  const collaborationScroller = page.locator(".collaboration-workspace")
  await collaborationScroller.evaluate((element) => {
    element.style.maxHeight = "180px"
    element.style.overflowY = "auto"
  })
  const collaborationGrip = page.locator(".block-control--grip:visible")
  const collaborationGripBox = await collaborationGrip.boundingBox()
  const collaborationBox = await collaborationScroller.boundingBox()
  if (collaborationGripBox === null || collaborationBox === null)
    throw new TypeError("Missing collaboration drag geometry")
  const initialScrollTop = await collaborationScroller.evaluate((element) => element.scrollTop)
  await page.mouse.move(
    collaborationGripBox.x + collaborationGripBox.width / 2,
    collaborationGripBox.y + collaborationGripBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(collaborationBox.x + 80, collaborationBox.y + collaborationBox.height - 2)
  await page.waitForFunction(
    ({ start }) => {
      const element = document.querySelector(".collaboration-workspace")
      return element instanceof HTMLElement && element.scrollTop > start + 24
    },
    { start: initialScrollTop },
  )
  await page.keyboard.press("Escape")
  await page.mouse.up()

  const peerParagraph = peer.locator("p").first()
  await peerParagraph.dblclick()
  const collaborationLinkButton = page
    .locator(".selection-toolbar:not([hidden])")
    .getByRole("button", {
      name: "Edit link",
    })
  await collaborationLinkButton.click()
  const collaborationLinkInput = page
    .locator(".selection-toolbar:not([hidden])")
    .getByLabel("Link address")
  await collaborationLinkInput.fill("/stale")
  const remotePeer = page.getByLabel("Editor B collaborative editor", { exact: true })
  await remotePeer.locator("p").first().click()
  await page.keyboard.type("원격")
  await page
    .locator(".selection-toolbar:not([hidden])")
    .getByRole("button", { name: "Apply" })
    .click()
  await page
    .getByRole("alert")
    .filter({ hasText: /selected text/ })
    .waitFor()
  assert.equal(await peer.locator("a[href='/stale']").count(), 0)

  await page.getByRole("button", { name: /Tables and code/ }).click()
  const composite = page.getByLabel("Structured document and table editor", { exact: true })
  await composite.locator(":scope > [data-block-id]").first().hover()
  await assert.doesNotReject(page.locator(".block-control--grip:visible").waitFor())
  await page.getByLabel("Travel preparation code editor", { exact: true }).click()
  assert.equal(await page.locator(".block-controls:not([hidden])").count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    "PASS controls, links, cut/paste bookmark, jitter drag, held-edge scroll, stale selection and readonly boundaries",
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
