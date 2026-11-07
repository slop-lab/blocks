import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const root = await mkdtemp(join(tmpdir(), "agent-browser-"))
const previousMarkdownRoot = process.env.MARKDOWN_ROOT
process.env.MARKDOWN_ROOT = join(root, "markdown")
await mkdir(process.env.MARKDOWN_ROOT, { recursive: true })
await writeFile(
  join(process.env.MARKDOWN_ROOT, "README.md"),
  "# Browser baseline\r\n\r\n<!-- preserve -->\r\n",
  "utf8",
)
const server = createApplicationServer({ runtimeRoot: root })
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
  await page.getByRole("button", { name: /Agent tools example/ }).click()
  await page.getByRole("heading", { name: "Agent tools examples" }).waitFor()
  assert.equal(await page.getByLabel("Run model").inputValue(), "fixture/deterministic")

  const runStory = async (tab, instruction, artifactKind) => {
    await page.getByRole("tab", { name: new RegExp(tab) }).click()
    await page.getByLabel("Request").fill(instruction)
    await page.getByRole("button", { name: "Start run" }).click()
    await page.getByText(artifactKind, { exact: true }).waitFor()
    await page.getByText("run.completed", { exact: true }).waitFor()
    const apply = page.getByRole("button", { name: "Apply reviewed operation" })
    await apply.waitFor()
    assert.equal(await apply.isEnabled(), true)
    await apply.click()
    await page
      .getByRole("status")
      .filter({ hasText: "Saved the reviewed changes to the source." })
      .waitFor()
  }

  await runStory("Markdown", "Browser Markdown proposal", "markdown-replacement")
  const markdownState = await page.request.get(
    `http://127.0.0.1:${address.port}/api/markdown/file?name=README.md`,
  )
  const markdown = await markdownState.json()
  assert.match(markdown.content, /Browser Markdown proposal/)
  assert.match(markdown.content, /<!-- preserve -->/)
  assert.match(markdown.content, /\r\n/)

  await runStory("Database", "첫 작업을 완료 상태로 검토", "workspace-row-status")
  const workspaceState = await page.request.get(`http://127.0.0.1:${address.port}/api/workspace`)
  assert.equal((await workspaceState.json()).databases[0].content.rows[0].values.status, "Done")

  await runStory("Mixed backlog", "Browser mixed proposal", "mixed-task-plan")
  const mixedState = await page.request.get(`http://127.0.0.1:${address.port}/api/ownership/mixed`)
  assert.match(JSON.stringify((await mixedState.json()).proposals), /Browser mixed proposal/)

  await page.getByRole("tab", { name: /Markdown/ }).click()
  await page.getByLabel("Request").fill("Stale browser proposal")
  await page.getByRole("button", { name: "Start run" }).click()
  await page.getByText("markdown-replacement", { exact: true }).waitFor()
  const current = await (
    await page.request.get(`http://127.0.0.1:${address.port}/api/markdown/file?name=README.md`)
  ).json()
  await page.request.put(`http://127.0.0.1:${address.port}/api/markdown/file`, {
    data: {
      name: "README.md",
      expectedRevision: current.revision,
      content: `${current.content}Concurrent edit\r\n`,
    },
  })
  await page.getByRole("button", { name: "Apply reviewed operation" }).click()
  await page.getByRole("status").filter({ hasText: "The source changed" }).waitFor()
  await page.screenshot({ path: "/tmp/opencode/agent-workbench-1280.png", fullPage: true })
  await page.locator(".agent-timeline").scrollIntoViewIfNeeded()
  await page.screenshot({
    path: "/tmp/opencode/agent-workbench-1280-timeline.png",
    fullPage: true,
  })

  for (const width of [768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    const heading = page.getByRole("heading", { name: "Agent tools examples" })
    assert.equal(await heading.isVisible(), true)
    const bounds = await heading.boundingBox()
    assert.ok(bounds !== null && bounds.x >= 0 && bounds.x + bounds.width <= width)
    await page.screenshot({
      path: `/tmp/opencode/agent-workbench-${width}.png`,
      fullPage: true,
    })
    await page.locator(".agent-review-panel").scrollIntoViewIfNeeded()
    await page.getByRole("button", { name: "Apply reviewed operation" }).focus()
    await page.screenshot({
      path: `/tmp/opencode/agent-workbench-${width}-review.png`,
      fullPage: true,
    })
    await page.locator(".agent-timeline").scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `/tmp/opencode/agent-workbench-${width}-timeline.png`,
      fullPage: true,
    })
  }
  assert.deepEqual(errors, [])
  console.log("PASS visible typed Part workflows, stale conflict, and responsive workbench")
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
  if (previousMarkdownRoot === undefined) delete process.env.MARKDOWN_ROOT
  else process.env.MARKDOWN_ROOT = previousMarkdownRoot
}
