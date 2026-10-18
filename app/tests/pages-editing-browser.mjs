import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const root = await mkdtemp(join(tmpdir(), "pages-editing-browser-"))
const server = createApplicationServer({
  runtimeRoot: root,
  sessionSecret: "pages-editing-browser-secret-value",
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
  let treeWrites = 0
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/api/workspace/trees/"))
      treeWrites += 1
  })
  await page.goto(`${base}/?workspace=structured-workspace`, { waitUntil: "networkidle" })
  const workspace = page.getByLabel("문서와 데이터베이스")
  await workspace.waitFor()

  const title = workspace.getByLabel("페이지 제목")
  await title.focus()
  await page.keyboard.press("ControlOrMeta+a")
  await title.dispatchEvent("compositionstart")
  await page.keyboard.insertText("팀 허브")
  const writesDuringComposition = treeWrites
  await page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && response.url().endsWith("/api/workspace"),
  )
  assert.equal(treeWrites, writesDuringComposition)
  const titleSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && response.url().includes("/api/workspace/trees/"),
  )
  await title.dispatchEvent("compositionend")
  assert.equal((await titleSaved).status(), 200)
  await page.reload({ waitUntil: "networkidle" })
  assert.equal(await workspace.getByLabel("페이지 제목").inputValue(), "팀 허브")

  const titleBeforeCancel = treeWrites
  const titleDraft = workspace.getByLabel("페이지 제목")
  await titleDraft.focus()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.insertText("취소할 제목")
  await page.keyboard.press("Escape")
  assert.equal(await titleDraft.inputValue(), "팀 허브")
  await page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && response.url().endsWith("/api/workspace"),
  )
  assert.equal(treeWrites, titleBeforeCancel)
  await titleDraft.focus()
  await titleDraft.dispatchEvent("compositionstart")
  await page.keyboard.press("Escape")
  assert.equal(await titleDraft.evaluate((element) => element === document.activeElement), true)
  await titleDraft.dispatchEvent("compositionend")

  const row = (id) => workspace.locator(`.structured-tree__row[data-page-id="${id}"]`)
  await page.evaluate(() => window.history.replaceState(null, "", "#focus=stale"))
  await row("project").locator(":scope > button").nth(1).click()
  assert.equal(new URL(page.url()).hash, "")
  const drag = async (sourceId, target, ratio = 0.5) => {
    const sourceRow = row(sourceId)
    await sourceRow.hover()
    const source = await sourceRow.locator(".structured-tree__grip").boundingBox()
    const destination = await target.boundingBox()
    if (source === null || destination === null) throw new TypeError("Missing page drag geometry")
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(source.x + source.width / 2 + 6, source.y + source.height / 2, {
      steps: 3,
    })
    await page.mouse.move(
      destination.x + destination.width / 2,
      destination.y + destination.height * ratio,
      { steps: 16 },
    )
    await page.mouse.up()
  }
  const savedMove = async (action) => {
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" && response.url().includes("/api/workspace/trees/"),
    )
    await action()
    assert.equal((await saved).status(), 200)
  }
  const tree = async () =>
    (await (await page.request.get(`${base}/api/workspace`)).json()).tree.content
  const preorder = () =>
    workspace
      .locator(".structured-tree__row")
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-page-id")))

  await savedMove(() => drag("research", workspace.getByRole("button", { name: "최상위로 이동" })))
  await page.reload({ waitUntil: "networkidle" })
  assert.equal((await tree()).pages.find((item) => item.id === "research")?.parentId, null)
  assert.deepEqual(await preorder(), ["home", "project", "research"])

  await savedMove(() => drag("research", row("home"), 0.08))
  assert.deepEqual(await preorder(), ["research", "home", "project"])
  await savedMove(() => drag("research", row("home"), 0.92))
  assert.deepEqual(await preorder(), ["home", "project", "research"])
  await savedMove(() => drag("research", row("project")))
  await page.reload({ waitUntil: "networkidle" })
  assert.equal((await tree()).pages.find((item) => item.id === "research")?.parentId, "project")
  assert.deepEqual(await preorder(), ["home", "project", "research"])

  const writesBeforeCycle = treeWrites
  const beforeCycle = JSON.stringify((await tree()).pages)
  await drag("project", row("research"))
  await page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && response.url().endsWith("/api/workspace"),
  )
  assert.equal(treeWrites, writesBeforeCycle)
  assert.equal(JSON.stringify((await tree()).pages), beforeCycle)

  await workspace.getByLabel("사용자 조사 이동").selectOption("root")
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()
  assert.equal((await tree()).pages.find((item) => item.id === "research")?.parentId, null)
  const writesBeforeSelfDrop = treeWrites
  await drag("research", row("research"))
  await page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && response.url().endsWith("/api/workspace"),
  )
  assert.equal(treeWrites, writesBeforeSelfDrop)

  await page.screenshot({ path: "/tmp/pages-editing-1280.png", fullPage: true })
  await page.setViewportSize({ width: 375, height: 900 })
  await workspace.getByRole("button", { name: /페이지 탐색/ }).click()
  for (const control of await workspace.locator(".structured-tree__actions button").all()) {
    const bounds = await control.boundingBox()
    assert.ok(bounds !== null && bounds.width >= 44 && bounds.height >= 44)
  }
  await page.screenshot({ path: "/tmp/pages-editing-375.png", fullPage: true })
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
    true,
  )
  assert.deepEqual(errors, [])
  console.log(
    "PASS composition-safe title reload, pointer root/before/after/inside moves, keyboard root move, cycle rejection, and responsive screenshots",
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
