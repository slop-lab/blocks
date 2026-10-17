import {
  ActionRequests,
  ChangeDelivery,
  PersistenceBaseline,
  revisionedDocumentSchema,
} from "@slop-lab/blocks-bindings"
import { describe, expect, it, vi } from "vitest"

describe("bindings package", () => {
  it("publishes a merged manual change batch when flushed", () => {
    const publish = vi.fn()
    const delivery = new ChangeDelivery(publish, { mode: "manual" })
    delivery.push({
      epoch: 1,
      version: 2,
      beforeVersion: 1,
      changedBlockIds: ["a"],
      origin: "local",
    })
    delivery.push({
      epoch: 1,
      version: 3,
      beforeVersion: 2,
      changedBlockIds: ["b"],
      origin: "history",
    })

    delivery.flush()

    expect(publish).toHaveBeenCalledWith({
      epoch: 1,
      beforeVersion: 1,
      version: 3,
      changedBlockIds: ["a", "b"],
      origins: ["local", "history"],
      count: 2,
    })
  })

  it("keeps a newer acknowledgement as the persistence baseline", () => {
    const baseline = new PersistenceBaseline({ title: "initial" })
    const first = baseline.begin({ title: "first" })
    const second = baseline.begin({ title: "second" })

    expect(baseline.acknowledge(second)).toBe(true)
    expect(baseline.acknowledge(first)).toBe(false)
    expect(baseline.isDirty({ title: "second" })).toBe(false)
  })

  it("marks an asynchronous action stale after its target changes", async () => {
    let currentVersion = 1
    const requests = new ActionRequests((target) => target.dependencyVersion === currentVersion)
    const request = requests.request(
      {
        actionHandle: "approve",
        target: { modelId: "minutes", epoch: 1, blockId: "summary", dependencyVersion: 1 },
        input: {},
      },
      async () => {
        currentVersion = 2
        return { status: "completed" }
      },
    )

    await expect(request.settled).resolves.toEqual({ status: "stale" })
  })

  it("rejects unknown fields at the persistence boundary", () => {
    expect(() =>
      revisionedDocumentSchema.parse({
        documentId: "minutes",
        revision: 1,
        content: { blocks: [] },
        metadata: {},
        unexpected: true,
      }),
    ).toThrow()
  })
})
