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
      const nextBytes = bytes + usage.bytes
      const nextItems = items + usage.items
      const nextDepth = Math.max(depth, usage.depth)
      if (
        !active() ||
        nextBytes > limits.bytes ||
        nextItems > limits.items ||
        nextDepth > limits.depth
      )
        return false
      bytes = nextBytes
      items = nextItems
      depth = nextDepth
      return true
    },
  }
}
