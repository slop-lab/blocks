import { afterEach, expect, it, vi } from "vitest"
import type { ChangeBatch } from "../src/core/change-delivery"
import { ChangeDelivery } from "../src/core/change-delivery"
import type { ChangeEvent } from "../src/core/types"

const event = (version: number): ChangeEvent => ({
  version,
  beforeVersion: version - 1,
  epoch: 1,
  origin: "local",
  changeId: String(version),
  historyGroup: null,
  changedBlockIds: [`b${version}`],
})
afterEach(() => vi.useRealTimers())

it("coalesces rapid typing while retaining the covered revision interval and affected targets", () => {
  vi.useFakeTimers()
  const batches: ChangeBatch[] = []
  const delivery = new ChangeDelivery((batch) => batches.push(batch), {
    mode: "debounce",
    delay: 300,
    maxWait: 1000,
  })
  for (let index = 1; index <= 10; index++) delivery.push(event(index))
  expect(batches).toHaveLength(0)
  vi.advanceTimersByTime(300)
  expect(batches).toHaveLength(1)
  expect(batches[0]).toMatchObject({ beforeVersion: 0, version: 10, count: 10 })
  expect(batches[0]?.changedBlockIds).toHaveLength(10)
})
it("publishes during continuous input at maxWait", () => {
  vi.useFakeTimers()
  const publish = vi.fn()
  const delivery = new ChangeDelivery(publish, { mode: "debounce", delay: 300, maxWait: 1000 })
  for (let index = 1; index <= 5; index++) {
    delivery.push(event(index))
    vi.advanceTimersByTime(200)
  }
  expect(publish).toHaveBeenCalledTimes(1)
})
it("throttles bursts and supports explicit manual flush without duplicate delivery", () => {
  vi.useFakeTimers()
  const publish = vi.fn()
  const delivery = new ChangeDelivery(publish, { mode: "throttle", interval: 500 })
  delivery.push(event(1))
  delivery.push(event(2))
  vi.advanceTimersByTime(500)
  expect(publish).toHaveBeenCalledTimes(1)
  delivery.configure({ mode: "manual" })
  delivery.push(event(3))
  vi.advanceTimersByTime(2000)
  expect(publish).toHaveBeenCalledTimes(1)
  delivery.flush()
  delivery.flush()
  expect(publish).toHaveBeenCalledTimes(2)
})
it("does not publish selection or disposed timers", () => {
  vi.useFakeTimers()
  const publish = vi.fn()
  const delivery = new ChangeDelivery(publish, { mode: "debounce", delay: 100, maxWait: 1000 })
  delivery.push(null)
  delivery.push(event(1))
  delivery.dispose()
  vi.runAllTimers()
  expect(publish).not.toHaveBeenCalled()
})
