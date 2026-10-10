import { describe, expect, it } from "vitest"
import { resolveSaveAcknowledgement } from "../src/features/large-content/editLifecycle"
import { includePinnedIndex, LargeContentCache } from "../src/features/large-content/model"
import type { LargeContentBlock } from "../src/features/large-content/types"

const block = (index: number, revision = 1): LargeContentBlock => ({
  id: `paragraph-${String(index).padStart(4, "0")}`,
  index,
  revision,
  text: `Paragraph ${index}`,
})

describe("large content cache", () => {
  it("retains unloaded positions when one remote block is edited", () => {
    const cache = new LargeContentCache(1_600)
    cache.mergePage({ blocks: [block(0), block(1)], offset: 0, total: 1_600, continuation: 2 })
    cache.mergeBlock({ ...block(1, 2), text: "edited" })

    expect(cache.count).toBe(1_600)
    expect(cache.get(0)?.text).toBe("Paragraph 0")
    expect(cache.get(1)?.text).toBe("edited")
    expect(cache.get(1_599)).toBeUndefined()
  })

  it("keeps the active virtual index mounted outside the viewport", () => {
    expect(includePinnedIndex([40, 41, 42], 900)).toEqual([40, 41, 42, 900])
    expect(includePinnedIndex([40, 41, 42], 41)).toEqual([40, 41, 42])
  })

  it("keeps a newer saved revision when an older page arrives late", () => {
    const cache = new LargeContentCache(1_600)
    cache.mergeBlock({ ...block(4, 2), text: "saved revision" })
    cache.mergePage({ blocks: [block(4, 1)], offset: 4, total: 1_600, continuation: 5 })

    expect(cache.get(4)?.revision).toBe(2)
    expect(cache.get(4)?.text).toBe("saved revision")
  })
})

describe("large content edit lifecycle", () => {
  it("keeps draft B open when save A is acknowledged", () => {
    expect(
      resolveSaveAcknowledgement({
        mounted: true,
        latestRequest: true,
        requestTargetId: "paragraph-0001",
        currentTargetId: "paragraph-0001",
        submittedDraft: "draft A",
        currentDraft: "draft B",
      }),
    ).toBe("preserve")
  })

  it("ignores an acknowledgement after the dialog changes target", () => {
    expect(
      resolveSaveAcknowledgement({
        mounted: true,
        latestRequest: true,
        requestTargetId: "paragraph-0001",
        currentTargetId: "paragraph-0002",
        submittedDraft: "draft A",
        currentDraft: "paragraph two",
      }),
    ).toBe("stale")
  })
})
