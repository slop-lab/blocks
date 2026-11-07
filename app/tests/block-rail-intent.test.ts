// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest"
import { attachRailPointerIntent } from "../src/pm/block-rail-intent"
import { cleanupSelectionViews, createSelectionView } from "./prosemirror-selection-fixture"

const detachments: Array<() => void> = []
const hitTestDescriptor = Object.getOwnPropertyDescriptor(document, "elementFromPoint")

afterEach(() => {
  for (const detach of detachments.splice(0)) detach()
  cleanupSelectionViews()
  vi.useRealTimers()
  if (hitTestDescriptor === undefined) Reflect.deleteProperty(document, "elementFromPoint")
  else Object.defineProperty(document, "elementFromPoint", hitTestDescriptor)
})

const createRail = () => {
  vi.useFakeTimers()
  const { view } = createSelectionView()
  const first = view.dom.querySelector<HTMLElement>('[data-block-id="first"]')
  const second = view.dom.querySelector<HTMLElement>('[data-block-id="second"]')
  if (first === null || second === null) throw new TypeError("Rail fixture blocks are missing")
  const rail = document.createElement("div")
  rail.dataset["targetBlockId"] = "first"
  document.body.append(rail)
  const show = vi.fn((block: HTMLElement) => {
    rail.hidden = false
    rail.dataset["targetBlockId"] = block.dataset["blockId"]
  })
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => second,
  })
  detachments.push(
    attachRailPointerIntent(view, {
      rail,
      targetId: () => rail.dataset["targetBlockId"] ?? null,
      activeRect: () => null,
      ownsBlock: (block) => view.dom.contains(block),
      show,
    }),
  )
  return { view, rail, first, second, show }
}

it("cancels a pending hover when the pointer leaves the editing surface", () => {
  const { view, second, show } = createRail()
  second.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))

  view.dom.dispatchEvent(new MouseEvent("pointerleave"))
  vi.advanceTimersByTime(160)

  expect(show).not.toHaveBeenCalled()
})

it("invalidates an old hover when a hidden rail is shown for a new block", () => {
  const { rail, first, second, show } = createRail()
  second.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
  rail.hidden = true

  first.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
  expect(show).toHaveBeenCalledExactlyOnceWith(first)
  vi.advanceTimersByTime(160)

  expect(show).toHaveBeenCalledTimes(1)
  expect(rail.dataset["targetBlockId"]).toBe("first")
})

it("still shows a candidate after an uninterrupted hover dwell", () => {
  const { second, show } = createRail()

  second.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
  vi.advanceTimersByTime(159)
  expect(show).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)

  expect(show).toHaveBeenCalledExactlyOnceWith(second)
})
