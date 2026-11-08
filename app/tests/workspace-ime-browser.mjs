import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const root = await mkdtemp(join(tmpdir(), "workspace-ime-"))
const server = createApplicationServer({
  runtimeRoot: root,
  sessionSecret: "workspace-ime-browser-secret",
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

const waitForPoll = (page) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && response.url().endsWith("/api/workspace"),
    { timeout: 5_000 },
  )

const composeKoreanAcrossPoll = async (page, paragraph, editor, token, duringComposition) => {
  await paragraph.click()
  await page.keyboard.press("End")
  await editor.evaluate((element, value) => {
    element.dataset.imeOwner = value
    element.dataset.compositionStarts = "0"
    element.dataset.compositionEnds = "0"
    element.addEventListener("compositionstart", () => {
      element.dataset.compositionStarts = String(Number(element.dataset.compositionStarts) + 1)
    })
    element.addEventListener("compositionend", () => {
      element.dataset.compositionEnds = String(Number(element.dataset.compositionEnds) + 1)
    })
  }, token)
  const client = await page.context().newCDPSession(page)
  const poll = waitForPoll(page)
  await client.send("Input.imeSetComposition", {
    text: "ㅎ",
    selectionStart: 1,
    selectionEnd: 1,
  })
  await client.send("Input.imeSetComposition", {
    text: "한",
    selectionStart: 1,
    selectionEnd: 1,
  })
  if (duringComposition !== undefined) await duringComposition()
  await poll
  assert.equal(await editor.getAttribute("data-ime-owner"), token)
  assert.equal(await editor.getAttribute("data-composition-starts"), "1")
  assert.equal(await editor.getAttribute("data-composition-ends"), "0")
  await client.send("Input.imeSetComposition", {
    text: "한ㄱ",
    selectionStart: 2,
    selectionEnd: 2,
  })
  await client.send("Input.imeSetComposition", {
    text: "한글",
    selectionStart: 2,
    selectionEnd: 2,
  })
  assert.match(await paragraph.innerText(), /한글$/u)
  await client.send("Input.insertText", { text: "한글" })
  await client.detach()
  await page.getByRole("status").filter({ hasText: "Saved all changes." }).waitFor()
  assert.equal(await editor.getAttribute("data-ime-owner"), token)
  assert.equal(await editor.getAttribute("data-composition-starts"), "1")
  assert.equal(await editor.getAttribute("data-composition-ends"), "1")
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${base}/?workspace=structured-workspace`, { waitUntil: "networkidle" })
  const workspace = page.getByLabel("Documents and databases")
  await workspace.waitFor()

  const rootEditor = workspace.locator(".structured-prosemirror")
  const rootParagraph = rootEditor.locator('[data-block-id="home-p"]')
  await composeKoreanAcrossPoll(page, rootParagraph, rootEditor, "root")
  assert.match(await rootParagraph.innerText(), /한글$/u)
  await page.keyboard.press("Control+z")
  assert.doesNotMatch(await rootParagraph.innerText(), /한글$/u)
  await page.keyboard.press("Control+Shift+z")
  assert.match(await rootParagraph.innerText(), /한글$/u)
  await page.getByRole("status").filter({ hasText: "Saved all changes." }).waitFor()
  await page.reload({ waitUntil: "networkidle" })
  assert.match(await workspace.locator('[data-block-id="home-p"]').innerText(), /한글$/u)

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
            id: "local-section",
            type: "section",
            heading: "로컬 섹션",
            children: [{ id: "local-paragraph", type: "paragraph", text: "로컬 " }],
          },
        ],
      },
    },
  })
  assert.equal(seeded.status(), 200)
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "User Research", exact: true }).click()
  const localEditor = workspace.locator(".structured-prosemirror")
  const localSection = localEditor.locator('[data-block-id="local-section"]')
  await composeKoreanAcrossPoll(
    page,
    localSection.locator('[data-block-id="local-paragraph"]'),
    localEditor,
    "local",
  )
  assert.match(await localSection.innerText(), /한글/u)
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "User Research", exact: true }).click()
  assert.match(await workspace.locator('[data-block-id="local-section"]').innerText(), /한글/u)

  await workspace.getByRole("button", { name: "Product Launch", exact: true }).click()
  const sharedSection = workspace.locator(".structured-sync").first()
  const sharedEditor = sharedSection.locator(".structured-sync__editor")
  const sharedParagraph = sharedEditor.locator("p").first()
  const beforeShared = await (await page.request.get(`${base}/api/workspace`)).json()
  const project = beforeShared.documents.find((record) => record.documentId === "project")
  if (project === undefined) throw new TypeError("Missing project document")
  await composeKoreanAcrossPoll(page, sharedParagraph, sharedEditor, "shared", async () => {
    const response = await page.request.put(`${base}/api/workspace/pages/project`, {
      data: {
        expectedRevision: project.revision,
        content: { ...project.content, version: project.content.version + 1 },
      },
    })
    assert.equal(response.status(), 200)
  })
  assert.match(await sharedParagraph.innerText(), /한글$/u)
  await page.getByRole("status").filter({ hasText: "Saved all changes." }).waitFor()
  const projectedCopy = workspace.locator(".structured-sync").nth(1).locator("p").first()
  assert.match(await projectedCopy.innerText(), /한글$/u)
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "Product Launch", exact: true }).click()
  assert.match(
    await workspace.locator(".structured-sync").first().locator("p").first().innerText(),
    /한글$/u,
  )

  assert.deepEqual(errors, [])
  console.log("PASS CDP Korean IME root/local/shared composition, poll, undo, save, and reload")
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
