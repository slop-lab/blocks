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

const paragraph = (text: string) =>
  markdownSchema.node(
    "paragraph",
    undefined,
    text.length === 0 ? undefined : markdownSchema.text(text),
  )

const semanticBlocks = (source: string) => {
  const document = parseMarkdown(source).document
  return document.content.content.map((node) => `${node.type.name}:${node.textContent}`)
}

it("keeps inserted and appended paragraphs as separate Markdown blocks", () => {
  const parsed = parseMarkdown("# Heading\n\nExisting\n")
  const [heading, existing] = parsed.document.content.content
  if (heading === undefined || existing === undefined) throw new TypeError("Fixture did not parse")
  const inserted = parsed.schema.topNodeType.create(parsed.document.attrs, [
    heading,
    paragraph("Inserted"),
    existing,
    paragraph("Appended"),
  ])

  expect(semanticBlocks(serializeMarkdown(inserted))).toEqual([
    "heading:Heading",
    "paragraph:Inserted",
    "paragraph:Existing",
    "paragraph:Appended",
  ])
})

it("keeps split, deleted, and reordered paragraphs semantically separate", () => {
  const parsed = parseMarkdown("First\n\nSecond\n\nThird\n")
  const [first, second, third] = parsed.document.content.content
  if (first === undefined || second === undefined || third === undefined)
    throw new TypeError("Fixture did not parse")
  const splitAttrs = { ...second.attrs, id: crypto.randomUUID() }
  const changed = parsed.schema.topNodeType.create(parsed.document.attrs, [
    third,
    second.type.create(second.attrs, parsed.schema.text("Second A")),
    second.type.create(splitAttrs, parsed.schema.text("Second B")),
    first,
  ])

  expect(semanticBlocks(serializeMarkdown(changed))).toEqual([
    "paragraph:Third",
    "paragraph:Second A",
    "paragraph:Second B",
    "paragraph:First",
  ])
})

it("resolves reference links in full-document context", () => {
  const parsed = parseMarkdown("Read [the guide][guide].\n\n[guide]: /docs/start\n")
  const paragraphNode = parsed.document.firstChild
  let href: unknown
  paragraphNode?.descendants((node) => {
    const link = node.marks.find((mark) => mark.type.name === "link")
    if (link !== undefined) href = link.attrs["href"]
  })
  expect(paragraphNode?.type.name).toBe("paragraph")
  expect(paragraphNode?.textContent).toBe("Read the guide.")
  expect(href).toBe("/docs/start")
  expect(serializeMarkdown(parsed.document)).toBe(
    "Read [the guide][guide].\n\n[guide]: /docs/start\n",
  )
})

it.each([
  "hello <span>world</span>\n",
  "> quoted <span>HTML</span>\n",
  "- item <span>HTML</span>\n",
  "| A | B |\n| - | - |\n| 1 | 2 |\n",
  ":::product-directive\nowned bytes\n:::\n",
])("preserves unsupported mixed syntax as one locked block: %s", (source) => {
  const parsed = parseMarkdown(source)
  expect(parsed.document.firstChild?.type.name).toBe("opaque")
  expect(parsed.document.firstChild?.attrs["locked"]).toBe(true)
  expect(serializeMarkdown(parsed.document)).toBe(source)
})

it("renders safe relative image paths and rejects ambiguous external paths", () => {
  const image = markdownSchema.nodes["image"]
  if (image === undefined || image.spec.toDOM === undefined) throw new TypeError("Image missing")
  expect(image.spec.toDOM(image.create({ src: "images/photo.png" }))).toEqual([
    "img",
    { src: "images/photo.png", alt: "" },
  ])
  expect(image.spec.toDOM(image.create({ src: "//evil.test/x.png" }))).toEqual([
    "img",
    { src: "", alt: "" },
  ])
  expect(image.spec.toDOM(image.create({ src: "..\\evil.png" }))).toEqual([
    "img",
    { src: "", alt: "" },
  ])
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
