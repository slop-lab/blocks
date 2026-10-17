import { decodeDocument } from "@slop-lab/blocks"
import { createProseMirrorProfile, pmToSnapshot, snapshotToPm } from "@slop-lab/blocks-prosemirror"
import { sectionBlock, sectionTitle } from "@slop-lab/blocks-prosemirror/containers"
import { paragraphBlock } from "@slop-lab/blocks-prosemirror/paragraph"
import { describe, expect, it } from "vitest"

const document = {
  format: "block-editor/v0.3" as const,
  blocks: [
    {
      id: "section",
      type: "section",
      attrs: {},
      content: [{ kind: "text" as const, text: "Semantic title", marks: [] }],
      children: [
        {
          id: "paragraph",
          type: "paragraph",
          attrs: {},
          content: [{ kind: "text" as const, text: "Nested body", marks: [] }],
          children: [],
        },
      ],
    },
  ],
}

describe("recursive block document codec", () => {
  it("Given nested blocks, When decoded, Then children and unknown fields are preserved", () => {
    const decoded = decodeDocument({
      ...document,
      blocks: [{ ...document.blocks[0], futureContainerField: { placement: "wide" } }],
    })

    expect(decoded.blocks[0]?.children?.[0]?.id).toBe("paragraph")
    expect(decoded.blocks[0]?.["futureContainerField"]).toEqual({ placement: "wide" })
  })

  it("Given duplicate IDs at different depths, When decoded, Then the document is rejected", () => {
    expect(() =>
      decodeDocument({
        ...document,
        blocks: [{ ...document.blocks[0], children: [{ ...document.blocks[0], children: [] }] }],
      }),
    ).toThrow(/Duplicate block id/u)
  })
})

it("Given an optional-title section, When converted through ProseMirror, Then recursive structure round-trips", () => {
  const profile = createProseMirrorProfile(
    [paragraphBlock, sectionTitle, sectionBlock],
    "paragraph",
  )

  expect(pmToSnapshot(snapshotToPm(document, profile), profile)).toEqual(document)
})
