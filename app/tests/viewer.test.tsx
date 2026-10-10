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
  expect(html).toContain("위치 소실")
})
