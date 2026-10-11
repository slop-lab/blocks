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
  const nestedHeading = workspace.locator("h4 input")
  await nestedHeading.waitFor()
  assert.equal(await nestedHeading.getAttribute("data-authored-level"), null)
  assert.equal(await nestedHeading.inputValue(), "조사 메모")

  await workspace.getByRole("button", { name: "제품 출시", exact: true }).click()
  const occurrences = workspace.locator(".structured-sync")
  assert.equal(await occurrences.count(), 2)
  const second = await browser.newPage({ viewport: { width: 768, height: 900 } })
  await second.goto(`${base}/?workspace=structured-workspace`, { waitUntil: "networkidle" })
  await second
    .getByLabel("문서와 데이터베이스")
    .getByRole("button", { name: "제품 출시", exact: true })
    .click()
  await occurrences.first().getByRole("button", { name: "공유 원본 편집" }).click()
  const shared = page.getByRole("dialog").getByLabel("공유 블록 내용")
  assert.equal(await shared.evaluate((element) => element === document.activeElement), true)
  await shared.fill("두 위치에 자동으로 반영된 출시 메모")
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()
  assert.deepEqual(await occurrences.locator("p").allTextContents(), [
    "두 위치에 자동으로 반영된 출시 메모",
    "두 위치에 자동으로 반영된 출시 메모",
  ])
  await second.getByText("두 위치에 자동으로 반영된 출시 메모").first().waitFor()
  await page.keyboard.press("Escape")
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  assert.equal(
    await occurrences
      .first()
      .getByRole("button", { name: "공유 원본 편집" })
      .evaluate((element) => element === document.activeElement),
    true,
  )

  await workspace.getByLabel("task-2 상태").selectOption("진행")
  await page.getByRole("status").filter({ hasText: "모든 변경을 저장했습니다" }).waitFor()
  await page.reload({ waitUntil: "networkidle" })
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
  await workspace.getByRole("heading", { name: "출시 회고" }).waitFor()

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
    "PASS nested headings, durable database edits, synced occurrences, second-client refresh, archive/restore, favorites, page creation, and responsive screenshots",
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
