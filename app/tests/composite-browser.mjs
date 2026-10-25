import { chromium } from "playwright"

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
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
await page.getByRole("heading", { name: "Travel workshop plan" }).waitFor({ state: "attached" })

const cells = page.locator(".composite-prose td")
await cells.first().click()
await page.getByRole("button", { name: "Add row below" }).click()
if ((await page.locator(".composite-prose tr").count()) !== 3)
  throw new TypeError("Table row command did not add a native row")

const code = page.getByRole("textbox", { name: "Travel preparation code editor" })
await code.click()
await page.keyboard.press("ControlOrMeta+A")
await page.keyboard.insertText("const scoped = true")
await page.keyboard.press("Tab")
if (!(await page.getByRole("button", { name: "Save document and code" }).isEnabled()))
  throw new TypeError("Independent code draft did not become dirty")
await page.reload()
await page.getByRole("heading", { name: "Travel workshop plan" }).waitFor({ state: "attached" })
if ((await page.locator(".composite-prose tr").count()) !== 3)
  throw new TypeError("Table draft did not survive reload")
if (
  !(
    await page.getByRole("textbox", { name: "Travel preparation code editor" }).textContent()
  ).includes("scoped")
)
  throw new TypeError("Code draft did not survive reload")
await page.getByRole("button", { name: "Save document and code" }).click()
await page.reload()
if (await page.getByRole("button", { name: "Save document and code" }).isEnabled())
  throw new TypeError("Saved workspace reloaded as dirty")

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 768, height: 900 },
  { width: 375, height: 812 },
]) {
  await page.setViewportSize(viewport)
  await page.getByRole("heading", { name: "Travel workshop plan" }).waitFor({ state: "attached" })
  if (await page.locator("body").evaluate((body) => body.scrollWidth > body.clientWidth))
    throw new TypeError(`Composite workspace overflows at ${viewport.width}px`)
}
if (errors.length > 0) throw new TypeError(`Browser console errors: ${errors.join(" | ")}`)

await browser.close()
