import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const root = await mkdtemp(join(tmpdir(), "block-editor-workflow-browser-"))
const server = createApplicationServer({
  runtimeRoot: root,
  sessionSecret: "browser-secret-with-enough-entropy",
})
server.listen(0, "127.0.0.1")
await once(server, "listening")
const address = server.address()
if (address === null || typeof address === "string") throw new TypeError("Missing server address")
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: /Shared meeting notes/ }).click()
  const workspace = page.locator(".workflow-workspace")
  const text = workspace.getByLabel("Meeting notes")
  await text.waitFor()
  await text.fill("승인이 필요한 공유 회의록입니다.")
  await workspace.getByRole("button", { name: "Save draft" }).click()
  await workspace.getByRole("button", { name: "Request review" }).click()
  await workspace.getByRole("status").filter({ hasText: "Requested a review." }).waitFor()
  await workspace.getByRole("button", { name: "Reviewer", exact: true }).click()
  await workspace.getByRole("button", { name: "Approve" }).click()
  await workspace.getByRole("status").filter({ hasText: "Approved the document." }).waitFor()
  assert.deepEqual(await workspace.locator(".workflow-audit strong").allTextContents(), [
    "Draft created",
    "Review requested",
    "Approved",
  ])
  await workspace.getByRole("button", { name: "Viewer", exact: true }).click()
  assert.equal(await text.isEditable(), false)
  assert.equal(await workspace.getByRole("button", { name: "Approve" }).isDisabled(), true)

  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      true,
    )
    await workspace.getByRole("heading", { name: "Shared meeting notes" }).waitFor()
  }
  assert.deepEqual(errors, [])
  console.log(
    "PASS durable author submission, reviewer approval, viewer readonly, and 375/768/1280 layouts",
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
