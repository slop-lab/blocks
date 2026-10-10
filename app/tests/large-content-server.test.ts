import { describe, expect, it } from "vitest"
import { createLargeContentRepository } from "../server/large-content.mjs"

describe("large content repository", () => {
  it("returns pages without materializing every block in the response", () => {
    const repository = createLargeContentRepository(1_600)
    const page = repository.page(500, 24)

    expect(page.total).toBe(1_600)
    expect(page.blocks).toHaveLength(24)
    expect(page.blocks[0]?.index).toBe(500)
    expect(page.continuation).toBe(524)
  })

  it("preserves unseen data when applying a one-block CAS patch", () => {
    const repository = createLargeContentRepository(1_600)
    const unseenBefore = repository.block("paragraph-1499")
    const updated = repository.patch("paragraph-0004", 1, "Remote target edit")

    expect(updated.kind).toBe("updated")
    expect(repository.block("paragraph-1499")).toEqual(unseenBefore)
    expect(repository.exportDocument().blocks).toHaveLength(1_600)
  })

  it("returns the current block on conflict without discarding the submitted draft", () => {
    const repository = createLargeContentRepository(1_600)
    repository.patch("paragraph-0004", 1, "First writer")
    const conflict = repository.patch("paragraph-0004", 1, "Second writer draft")

    expect(conflict.kind).toBe("conflict")
    if (conflict.kind === "conflict") {
      expect(conflict.current.text).toBe("First writer")
      expect(conflict.draft).toBe("Second writer draft")
    }
  })
})
