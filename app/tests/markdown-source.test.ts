import { expect, it } from "vitest"
import { preserveLineEndings } from "../src/features/markdown/source-edit"

it("preserves unchanged mixed line endings through textarea normalization", () => {
  expect(preserveLineEndings("# Title\r\n\r\nRaw\n", "# Title\n\nRaw\n")).toBe(
    "# Title\r\n\r\nRaw\n",
  )
})
it("changes only the requested span rather than normalizing unrelated Markdown", () => {
  const original = "# Title\r\n\r\n<raw>opaque</raw>\n"
  expect(preserveLineEndings(original, "# Revised\n\n<raw>opaque</raw>\n")).toBe(
    "# Revised\r\n\r\n<raw>opaque</raw>\n",
  )
})
it("uses the document line ending for inserted lines", () => {
  expect(preserveLineEndings("Title\r\nBody\r\n", "Title\nAdded\nBody\n")).toBe(
    "Title\r\nAdded\r\nBody\r\n",
  )
})
