import { markdownSchema, parseMarkdown, serializeMarkdown } from "@block-editor/markdown"
import { expect, it } from "vitest"

const richSource = [
  "# Release notes",
  "",
  "A **bold** and *quiet* [link](/guide) with `code`.",
  "",
  "- parent",
  "  - nested",
  "- second",
  "",
  "> quoted text",
  "",
  "```ts",
  "const ready = true",
  "```",
  "",
  "---",
  "",
  '[link-ref]: https://example.com "kept exactly"',
  "",
  ":::product-directive",
  "owned bytes",
  ":::",
  "",
].join("\r\n")

it.each(["javascript:alert(1)", "data:text/html,x", "vbscript:msgbox(1)", "//evil.test/x"])(
  "deactivates unsafe link target %s",
  (href) => {
    const link = markdownSchema.marks["link"]
    if (link === undefined) throw new TypeError("Link mark missing")
    const toDOM = link.spec.toDOM
    if (toDOM === undefined) throw new TypeError("Link renderer missing")
    expect(toDOM(link.create({ href }), true)).toEqual(["a", { href: "", rel: "noreferrer" }, 0])
  },
)

it("keeps raw HTML inert as an opaque block", () => {
  const source = "<script>alert('x')</script>\n"
  const parsed = parseMarkdown(source)
  expect(parsed.document.firstChild?.type.name).toBe("opaque")
  expect(serializeMarkdown(parsed.document)).toBe(source)
})

it("preserves every source byte when a parsed rich document is unchanged", () => {
  const parsed = parseMarkdown(richSource)

  const output = serializeMarkdown(parsed.document)

  expect(output).toBe(richSource)
})

it("parses common Markdown into native nested ProseMirror structure", () => {
  const parsed = parseMarkdown(richSource)

  const names = parsed.document.content.content.map((node) => node.type.name)
  const list = parsed.document.content.content.find((node) => node.type.name === "bullet_list")

  expect(names).toEqual([
    "heading",
    "paragraph",
    "bullet_list",
    "blockquote",
    "code_block",
    "horizontal_rule",
    "opaque",
    "opaque",
  ])
  expect(list?.textContent).toBe("parentnestedsecond")
  expect(list?.child(0).child(1).type.name).toBe("bullet_list")
})

it("serializes an edited heading while retaining opaque and CRLF source spans", () => {
  const parsed = parseMarkdown(richSource)
  const heading = parsed.document.firstChild
  if (heading === null) throw new TypeError("Heading fixture did not parse")
  const changed = parsed.schema.topNodeType.create(
    parsed.document.attrs,
    parsed.document.content.content.map((node, index) =>
      index === 0
        ? heading.type.create(heading.attrs, parsed.schema.text("Published notes"))
        : node,
    ),
  )

  const output = serializeMarkdown(changed)

  expect(output.startsWith("# Published notes\r\n\r\n")).toBe(true)
  expect(output).toContain('[link-ref]: https://example.com "kept exactly"\r\n')
  expect(output).toContain(":::product-directive\r\nowned bytes\r\n:::\r\n")
})

it("prints fenced code as source without showing fence markers in the document text", () => {
  const parsed = parseMarkdown("```js\nconst answer = 42\n```\n")

  expect(parsed.document.textContent).toBe("const answer = 42")
  expect(serializeMarkdown(parsed.document)).toBe("```js\nconst answer = 42\n```\n")
})
