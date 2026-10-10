import { describe, expect, it } from "vitest"
import { presentationSeed } from "../src/data/seeds"
import { createHostState, sanitizeHostDocument, toggleTask } from "../src/host/store"

describe("host-owned view data", () => {
  it("toggles a task without changing document content", () => {
    // Given
    const host = createHostState()
    const before = JSON.stringify(presentationSeed)

    // When
    const next = toggleTask(host, "TASK-142")

    // Then
    expect(next.tasks["TASK-142"]?.status).toBe("done")
    expect(JSON.stringify(presentationSeed)).toBe(before)
  })

  it("removes host task fields from portable content", () => {
    // Given
    const document = {
      ...presentationSeed,
      blocks: presentationSeed.blocks.map((block) =>
        block.type === "task_card"
          ? { ...block, attrs: { ...block.attrs, title: "host title", status: "done" } }
          : block,
      ),
    }

    // When
    const sanitized = sanitizeHostDocument(document)

    // Then
    expect(sanitized.blocks.find((block) => block.type === "task_card")?.attrs).toEqual({
      taskId: "TASK-142",
    })
  })
})
