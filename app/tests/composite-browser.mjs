import { chromium } from "playwright"

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome",
  headless: true,
  args: ["--no-sandbox"],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text())
})
page.on("pageerror", (error) => errors.push(error.message))

await page.goto(
  `${process.env.QA_BASE_URL ?? "http://127.0.0.1:5192"}/tests/composite-harness.html`,
)
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.getByRole("heading", { name: "여행 워크숍 계획" }).waitFor({ state: "attached" })

const cells = page.locator(".composite-prose td")
await cells.first().click()
await page.getByRole("button", { name: "아래 행 추가" }).click()
if ((await page.locator(".composite-prose tr").count()) !== 3)
  throw new TypeError("Table row command did not add a native row")

const code = page.getByRole("textbox", { name: "여행 준비 코드 편집기" })
await code.click()
await page.keyboard.press("ControlOrMeta+A")
await page.keyboard.insertText("const scoped = true")
await page.keyboard.press("Tab")
if (!(await page.getByRole("button", { name: "문서와 코드 저장" }).isEnabled()))
  throw new TypeError("Independent code draft did not become dirty")
await page.reload()
await page.getByRole("heading", { name: "여행 워크숍 계획" }).waitFor({ state: "attached" })
if ((await page.locator(".composite-prose tr").count()) !== 3)
  throw new TypeError("Table draft did not survive reload")
if (
  !(await page.getByRole("textbox", { name: "여행 준비 코드 편집기" }).textContent()).includes(
    "scoped",
  )
)
  throw new TypeError("Code draft did not survive reload")
await page.getByRole("button", { name: "문서와 코드 저장" }).click()
await page.reload()
if (await page.getByRole("button", { name: "문서와 코드 저장" }).isEnabled())
  throw new TypeError("Saved workspace reloaded as dirty")

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 768, height: 900 },
  { width: 375, height: 812 },
]) {
  await page.setViewportSize(viewport)
  await page.getByRole("heading", { name: "여행 워크숍 계획" }).waitFor({ state: "attached" })
  if (await page.locator("body").evaluate((body) => body.scrollWidth > body.clientWidth))
    throw new TypeError(`Composite workspace overflows at ${viewport.width}px`)
}
if (errors.length > 0) throw new TypeError(`Browser console errors: ${errors.join(" | ")}`)

await browser.close()
