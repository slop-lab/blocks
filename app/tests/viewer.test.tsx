import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { BlockViewer } from "../src/Viewer"

it("renders a block array without model session or host services", () => {
  const html = renderToStaticMarkup(
    <BlockViewer
      content={[
        {
          id: "p",
          type: "paragraph",
          attrs: {},
          content: [{ kind: "text", text: "본문", marks: [{ type: "strong" }] }],
        },
      ]}
      overlays={[{ id: "comment", blockId: "gone", message: "검토 필요" }]}
    />,
  )
  expect(html).toContain("<strong>본문</strong>")
  expect(html).toContain("Position unavailable")
})

it("renders safe link marks as escaped semantic anchors", () => {
  // Given
  const content = [
    {
      id: "linked",
      type: "paragraph",
      attrs: {},
      content: [
        {
          kind: "text" as const,
          text: "<Guide>",
          marks: [{ type: "link", attrs: { href: "/docs?topic=a&mode=b" } }],
        },
      ],
    },
  ]

  // When
  const html = renderToStaticMarkup(<BlockViewer content={content} />)

  // Then
  expect(html).toContain('<a href="/docs?topic=a&amp;mode=b">&lt;Guide&gt;</a>')
})

it("leaves unsafe link marks inert", () => {
  // Given
  const content = [
    {
      id: "unsafe-link",
      type: "paragraph",
      attrs: {},
      content: [
        {
          kind: "text" as const,
          text: "Unsafe link",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        },
      ],
    },
  ]

  // When
  const html = renderToStaticMarkup(<BlockViewer content={content} />)

  // Then
  expect(html).toContain("Unsafe link")
  expect(html).not.toContain("<a ")
  expect(html).not.toContain("javascript:")
})
