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
  const workspace = page.getByLabel("문서와 데이터베이스")
  await workspace.waitFor()

  await workspace.getByRole("button", { name: "사용자 조사", exact: true }).click()
  const nestedHeading = workspace.locator('h3[data-semantic-depth="3"]')
  await nestedHeading.waitFor()
  assert.equal(await nestedHeading.textContent(), "조사 메모")
  await nestedHeading.click()
  await page.keyboard.press("End")
  await page.keyboard.insertText(" 편집")
  assert.equal(await nestedHeading.textContent(), "조사 메모 편집")
  await page.keyboard.press("ControlOrMeta+z")
  assert.equal(await nestedHeading.textContent(), "조사 메모")
  await page.keyboard.press("End")
  await page.keyboard.insertText(" 저장됨")
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()

  await workspace.getByRole("button", { name: "제품 출시", exact: true }).click()
  const pastePolicy = workspace.getByLabel("붙여넣기 방식")
  assert.equal(await pastePolicy.inputValue(), "clone")
  await pastePolicy.selectOption("reference")
  assert.equal(await pastePolicy.inputValue(), "reference")
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "제품 출시", exact: true }).click()
  assert.equal(await workspace.getByLabel("붙여넣기 방식").inputValue(), "reference")
  await pastePolicy.selectOption("clone")
  await workspace
    .getByRole("navigation", { name: "백링크" })
    .getByRole("button", {
      name: "팀 홈",
    })
    .click()
  await workspace.locator(".structured-topbar h1", { hasText: "팀 홈" }).waitFor()
  assert.equal(new URL(page.url()).hash, "#home-link")
  assert.equal(
    await workspace
      .getByRole("button", { name: /연결된 페이지 · 제품 출시/ })
      .evaluate((element) => element === document.activeElement),
    true,
  )
  await workspace.getByRole("button", { name: "제품 출시", exact: true }).click()
  const occurrences = workspace.locator(".structured-sync")
  assert.equal(await occurrences.count(), 2)
  const second = await browser.newPage({ viewport: { width: 768, height: 900 } })
  await second.goto(`${base}/?workspace=structured-workspace`, { waitUntil: "networkidle" })
  await second
    .getByLabel("문서와 데이터베이스")
    .getByRole("button", { name: "제품 출시", exact: true })
    .click()
  const firstShared = occurrences.first().getByLabel(/동기화된 섹션/)
  const secondShared = occurrences.nth(1).getByLabel(/동기화된 섹션/)
  await firstShared.locator("p").click()
  assert.equal(await firstShared.getAttribute("contenteditable"), "true")
  assert.equal(await secondShared.getAttribute("contenteditable"), "false")
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.insertText("두 위치에 자동으로 반영된 출시 메모")
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()
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
  await workspace.getByLabel("task-2 상태").selectOption("진행")
  assert.equal((await databaseSaved).status(), 200)
  await page.waitForTimeout(1_600)
  assert.match(await projectHeading.textContent(), /동시 저장/u)
  assert.equal((await pageSaved).status(), 200)
  await page.unroute("**/api/workspace/pages/project")

  await occurrences.first().getByRole("button", { name: "복제", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()
  assert.equal(await occurrences.count(), 3)
  const occurrenceIds = await occurrences.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-occurrence-id")),
  )
  assert.equal(new Set(occurrenceIds).size, 3)
  await occurrences.first().getByRole("button", { name: "연결 해제", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()
  await page.waitForFunction(() => document.querySelectorAll(".structured-sync").length === 2)
  assert.equal(await occurrences.count(), 2)
  const sourceAfterUnlink = await (await page.request.get(`${base}/api/workspace`)).json()
  assert.equal(
    sourceAfterUnlink.sources[0].content.section.children[0].text,
    "두 위치에 자동으로 반영된 출시 메모",
  )

  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "사용자 조사", exact: true }).click()
  assert.equal(
    await workspace.locator('h3[data-semantic-depth="3"]').textContent(),
    "조사 메모 저장됨",
  )
  await workspace.getByRole("button", { name: "제품 출시", exact: true }).click()
  assert.equal(await workspace.getByLabel("task-2 상태").inputValue(), "진행")
  assert.equal(
    await occurrences.first().locator("p").textContent(),
    "두 위치에 자동으로 반영된 출시 메모",
  )

  await workspace.getByRole("button", { name: "제품 출시 즐겨찾기" }).click()
  assert.equal(
    await workspace
      .getByRole("button", { name: "제품 출시 즐겨찾기" })
      .getAttribute("aria-pressed"),
    "true",
  )
  await workspace.getByRole("button", { name: "사용자 조사 보관" }).click()
  await workspace.getByRole("button", { name: "사용자 조사 복원" }).click()
  const newPageButton = workspace.getByRole("button", { name: "새 페이지" })
  await newPageButton.click()
  const createTitle = page.getByRole("dialog").getByLabel("페이지 제목")
  assert.equal(await createTitle.evaluate((element) => element === document.activeElement), true)
  await page.keyboard.press("Escape")
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  assert.equal(await newPageButton.evaluate((element) => element === document.activeElement), true)
  await newPageButton.click()
  await page.getByRole("dialog").getByLabel("페이지 제목").fill("출시 회고")
  await page.getByRole("dialog").getByRole("button", { name: "만들기" }).click()
  await workspace.locator(".structured-topbar h1", { hasText: "출시 회고" }).waitFor()
  const newPageEditor = workspace.getByLabel("구조화 문서 편집기").last()
  const emptyParagraph = newPageEditor.locator("p").last()
  await emptyParagraph.click()
  await page.keyboard.insertText("/quote")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  const quote = newPageEditor.locator("blockquote")
  await quote.waitFor()
  await page.keyboard.insertText("회고 인용")
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()
  await page.reload({ waitUntil: "networkidle" })
  await workspace.getByRole("button", { name: "출시 회고", exact: true }).click()
  await workspace.locator("blockquote", { hasText: "회고 인용" }).waitFor()

  await second.close()

  await page.setViewportSize({ width: 375, height: 900 })
  const treeToggle = workspace.getByRole("button", { name: /페이지 탐색/ })
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
      .getByRole("button", { name: "출시 회고 즐겨찾기" })
      .evaluate((element) => element.getBoundingClientRect().height)) >= 44,
  )
  assert.ok(
    (await workspace
      .getByLabel("페이지 검색")
      .evaluate((element) => element.getBoundingClientRect().height)) >= 44,
  )
  await workspace.getByRole("button", { name: "제품 출시", exact: true }).click()
  assert.ok(
    (await workspace
      .getByRole("button", { name: "행 추가" })
      .evaluate((element) => element.getBoundingClientRect().height)) >= 44,
  )
  assert.ok(
    (await workspace
      .getByLabel("task-2 상태")
      .evaluate((element) => element.getBoundingClientRect().height)) >= 44,
  )
  await workspace.getByText("표를 좌우로 스크롤해 모든 속성을 확인하세요.").waitFor()
  await workspace.getByRole("region", { name: "출시 작업 표" }).waitFor()
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
    "PASS nested headings, paste policy, backlinks, durable database edits, synced occurrences, second-client refresh, archive/restore, favorites, page creation, and responsive screenshots",
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
