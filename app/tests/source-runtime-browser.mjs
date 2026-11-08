import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const root = await mkdtemp(join(tmpdir(), "source-runtime-browser-"))
const server = createApplicationServer({
  runtimeRoot: root,
  sessionSecret: "source-runtime-browser-secret",
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
  const first = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  first.on("pageerror", (error) => {
    errors.push(error.message)
    console.error("PAGEERROR", error.stack)
  })
  await first.goto(`${base}/?workspace=structured-workspace`, { waitUntil: "networkidle" })
  const firstWorkspace = first.getByLabel("Documents and databases")
  await firstWorkspace.getByRole("button", { name: "Product Launch", exact: true }).click()
  const occurrences = firstWorkspace.locator(".structured-sync")
  assert.equal(await occurrences.count(), 2)
  assert.equal(await occurrences.locator(".structured-sync__projection").count(), 2)
  assert.equal(await occurrences.locator(".structured-sync__projection [data-block-id]").count(), 0)
  assert.ok(
    (await occurrences.locator(".structured-sync__projection [data-source-block-id]").count()) > 0,
  )
  await occurrences
    .first()
    .locator(".structured-sync__projection p")
    .evaluate((element) => element.setAttribute("data-render-sentinel", "stable"))
  await first.waitForTimeout(2_200)
  assert.equal(
    await occurrences
      .first()
      .locator(".structured-sync__projection p")
      .getAttribute("data-render-sentinel"),
    "stable",
  )

  const historySaved = first.waitForResponse(
    (response) => response.request().method() === "PUT" && response.url().includes("/sources/"),
  )
  await occurrences.first().locator("p").click()
  assert.equal(await occurrences.locator(".structured-sync__editor.ProseMirror").count(), 1)
  assert.equal(await occurrences.locator(".structured-sync__projection").count(), 1)
  assert.equal(
    await firstWorkspace
      .getByLabel("Structured document editor")
      .locator(".structured-sync__projection [data-block-id]")
      .count(),
    0,
  )
  await first.keyboard.press("ControlOrMeta+a")
  await first.keyboard.insertText("페이지 전환 뒤에도 남는 기록")
  assert.equal((await historySaved).status(), 200)
  await first.getByRole("status").filter({ hasText: "Saved all changes." }).waitFor()
  await firstWorkspace.getByRole("button", { name: "User Research", exact: true }).click()
  await firstWorkspace.getByRole("button", { name: "Product Launch", exact: true }).click()
  assert.equal(await occurrences.locator(".structured-sync__editor.ProseMirror").count(), 0)
  await occurrences.nth(1).locator("p").click()
  assert.equal(await occurrences.locator(".structured-sync__editor.ProseMirror").count(), 1)
  await first.keyboard.press("ControlOrMeta+z")
  assert.notEqual(
    await occurrences.nth(1).locator("p").textContent(),
    "페이지 전환 뒤에도 남는 기록",
  )
  await first.keyboard.press("ControlOrMeta+Shift+z")
  assert.equal(await occurrences.nth(1).locator("p").textContent(), "페이지 전환 뒤에도 남는 기록")

  await first.reload({ waitUntil: "networkidle" })
  await firstWorkspace.getByRole("button", { name: "Product Launch", exact: true }).click()

  const second = await browser.newPage({ viewport: { width: 900, height: 900 } })
  second.on("pageerror", (error) => errors.push(error.message))
  await second.addInitScript(() => {
    window.__sourceRuntimeUnhandled = []
    window.addEventListener("unhandledrejection", (event) => {
      window.__sourceRuntimeUnhandled.push(String(event.reason))
    })
  })
  await second.goto(`${base}/?workspace=structured-workspace`, { waitUntil: "networkidle" })
  const secondWorkspace = second.getByLabel("Documents and databases")
  await secondWorkspace.getByRole("button", { name: "Product Launch", exact: true }).click()
  let delaySecondWrite = true
  let rejectConflictRefresh = false
  await second.route("**/api/workspace", async (route) => {
    if (rejectConflictRefresh && route.request().method() === "GET") {
      rejectConflictRefresh = false
      await route.abort("failed")
      return
    }
    await route.continue()
  })
  await second.route("**/api/workspace/sources/*", async (route) => {
    if (delaySecondWrite && route.request().method() === "PUT") {
      delaySecondWrite = false
      rejectConflictRefresh = true
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    await route.continue()
  })

  const firstSaved = first.waitForResponse(
    (response) => response.request().method() === "PUT" && response.url().includes("/sources/"),
  )
  await occurrences.first().locator("p").click()
  await first.keyboard.press("ControlOrMeta+a")
  await first.keyboard.insertText("원격 승자")
  assert.equal((await firstSaved).status(), 200)

  const secondOccurrences = secondWorkspace.locator(".structured-sync")
  const rejected = second.waitForResponse(
    (response) => response.request().method() === "PUT" && response.url().includes("/sources/"),
  )
  await secondOccurrences.first().locator("p").click()
  await second.keyboard.press("ControlOrMeta+a")
  await second.keyboard.insertText("보존할 로컬 초안")
  assert.equal((await rejected).status(), 409)
  assert.equal(await secondOccurrences.first().locator("p").textContent(), "보존할 로컬 초안")
  const remote = await (await second.request.get(`${base}/api/workspace`)).json()
  assert.equal(remote.sources[0].content.section.children[0].text, "원격 승자")
  const accept = secondOccurrences.first().getByRole("button", { name: "Accept server changes" })
  await accept.waitFor()
  await accept.click()
  assert.equal(await secondOccurrences.first().locator("p").textContent(), "원격 승자")
  assert.deepEqual(await second.evaluate(() => window.__sourceRuntimeUnhandled), [])
  assert.deepEqual(errors, [])
  await second.close()
  console.log("PASS source runtime lifetime, one active view, history, and explicit CAS recovery")
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
