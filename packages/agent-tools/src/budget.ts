import type { BudgetLimits, ToolBudget, ToolUsage } from "./contracts.js"

export const createBudget = (limits: BudgetLimits): ToolBudget => {
  const startedAt = Date.now()
  let calls = 0
  let bytes = 0
  let items = 0
  let depth = 0
  const active = () => Date.now() - startedAt <= limits.durationMs
  return {
    consumeCall() {
      calls += 1
      return active() && calls <= limits.calls
    },
    consume(usage: ToolUsage) {
      bytes += usage.bytes
      items += usage.items
      depth = Math.max(depth, usage.depth)
      return active() && bytes <= limits.bytes && items <= limits.items && depth <= limits.depth
    },
  }
}
